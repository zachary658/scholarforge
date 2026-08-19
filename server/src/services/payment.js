// 支付服务
// 通道：mock（演示）/ alipay / wechat / manual（后台手动标记）
// 商户号/密钥/证书路径均从管理后台 settings 读取（getPaymentConfig），不硬编码
import crypto from 'crypto';
import fs from 'fs';
import logger from '../logger.js';
import db from '../db.js';
import { getPaymentConfig, getAvailableChannels, getCourse, getFeaturePrice } from '../config-store.js';
import { getFeatureCashPrice } from './billing.js';
import { computeCourseQuote } from './course-quote.js';
import { now, datePrefix } from '../utils.js';
import { AlipaySdk } from 'alipay-sdk';
import { Wechatpay, Aes, Rsa } from 'wechatpay-axios-plugin';

// 生成订单号：SF + YYYYMMDD + 8位十六进制随机
export function genOrderNo() {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `SF${datePrefix()}${rand}`;
}

// 读取密钥内容：优先用内容字段，为空则从证书路径读取文件内容
function readKeyContent(content, path) {
  if (content) return content;
  if (path) {
    try { return fs.readFileSync(path, 'utf8'); } catch (err) {
      logger.error('payment', `读取证书文件失败 ${path}: ${err.message}`);
      return '';
    }
  }
  return '';
}

// 发放课程权益：记录用户已购课程（论文 1 对 1 指导，保留独立流程）
function grantCourse(userId, courseId, validityDays, orderId, requirements = null) {
  const expiresAt = validityDays ? now() + validityDays * 86400 : null;
  db.prepare(
    `INSERT INTO user_courses (user_id, course_id, quota_remaining, order_id, expires_at, purchased_at, requirements)
     VALUES (?, ?, 0, ?, ?, ?, ?)`
  ).run(userId, courseId, orderId, expiresAt, now(), requirements);
}

// 解析支付通道：优先用户指定 → 管理员配置 mode → mock 兜底（生产环境禁 mock）
function resolveChannel(channel) {
  const cfg = getPaymentConfig();
  const channels = getAvailableChannels();
  const isProd = process.env.NODE_ENV === 'production';
  if (channel === 'mock' && (cfg.mode !== 'mock' || isProd)) {
    throw new Error('模拟支付通道未开放');
  }
  let useChannel = channel;
  if (!useChannel || !channels.includes(useChannel)) {
    const real = channels.find((c) => c !== 'mock');
    if (cfg.mode === 'alipay' && channels.includes('alipay')) useChannel = 'alipay';
    else if (cfg.mode === 'wechat' && channels.includes('wechat')) useChannel = 'wechat';
    else if (real) useChannel = real;
    else if (isProd) throw new Error('未配置可用的支付通道，请联系管理员');
    else useChannel = 'mock';
  }
  return useChannel;
}

// 创建订单（课程 / 毕业作品，保留独立流程）
export function createOrder({ userId, type, target, channel = null, courseRequirements = null }) {
  const cfg = getPaymentConfig();
  const useChannel = resolveChannel(channel);

  let amount = 0;
  let targetName = '';
  let metadata = {};
  if (type === 'course') {
    const course = getCourse(parseInt(target, 10));
    if (!course || !course.is_active) throw new Error('课程不存在或已下架');
    if (courseRequirements) {
      const quote = computeCourseQuote(course, courseRequirements);
      amount = quote.amount;
      metadata = { course_id: course.id, validity_days: course.validity_days, degree: course.degree, requirements: quote.requirements, breakdown: quote.breakdown };
    } else {
      amount = course.price;
      metadata = { course_id: course.id, validity_days: course.validity_days, degree: course.degree };
    }
    targetName = course.title;
  } else if (type === 'graduation') {
    const gpOrder = db.prepare(
      `SELECT gpo.id, gpo.quoted_price, gpo.quote_status, gpo.status, gpo.user_id, gp.title
       FROM graduation_project_orders gpo
       JOIN graduation_projects gp ON gp.id = gpo.project_id
       WHERE gpo.id = ?`
    ).get(parseInt(target, 10));
    if (!gpOrder) throw new Error('毕业作品订单不存在');
    if (gpOrder.user_id !== userId) throw new Error('无权操作该订单');
    if (gpOrder.status !== 'pending') throw new Error(`订单状态 ${gpOrder.status}，不能支付`);
    if (gpOrder.quote_status === 'pending') throw new Error('报价待管理员审批，请稍后再试');
    if (gpOrder.quote_status === 'rejected') throw new Error('报价已被驳回，请联系客服重新报价');
    if (gpOrder.quote_status !== 'approved' || gpOrder.quoted_price == null || gpOrder.quoted_price <= 0) {
      throw new Error('订单尚未报价，请联系客服报价后再支付');
    }
    amount = gpOrder.quoted_price;
    targetName = `毕业作品：${gpOrder.title}`;
    metadata = { gp_order_id: gpOrder.id, project_title: gpOrder.title };
  } else {
    throw new Error('未知的订单类型');
  }

  if (amount < 0) throw new Error('订单金额异常（负值），请检查定价配置');

  const orderNo = genOrderNo();
  const expiresAt = now() + cfg.orderExpireSeconds;
  db.prepare(
    `INSERT INTO orders (order_no, user_id, type, target, target_name, amount, status, payment_method, payment_channel, metadata, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(orderNo, userId, type, String(target), targetName, amount, useChannel, useChannel, JSON.stringify(metadata), expiresAt);

  const order = getOrder(orderNo);
  const payParams = buildPaymentParams(order, useChannel);
  return { order, payParams };
}

// 创建固定价格功能订单（现金直付）
export function createFeatureOrder({ userId, itemType, quantity = 1, paymentMethod = null, params = null }) {
  const feature = getFeaturePrice(itemType);
  if (!feature || !feature.is_active) throw new Error('功能不存在或已下架');
  if (feature.is_unlimited) throw new Error('该功能免费，无需下单');
  if (feature.pricing_mode === 'quote') throw new Error('该功能需人工报价，请提交报价申请');

  const unitPrice = getFeatureCashPrice(itemType);
  if (unitPrice <= 0) throw new Error('该功能暂未定价，请联系管理员');

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const amount = Math.round(unitPrice * qty * 100) / 100;
  const useChannel = resolveChannel(paymentMethod);

  const orderNo = genOrderNo();
  const expiresAt = now() + getPaymentConfig().orderExpireSeconds;
  db.prepare(
    `INSERT INTO orders (order_no, user_id, type, target, target_name, amount, status, payment_method, payment_channel, item_type, item_name, quantity, params_json, expires_at)
     VALUES (?, ?, 'feature', ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
  ).run(orderNo, userId, itemType, feature.name, amount, useChannel, useChannel, itemType, feature.name, qty, params ? JSON.stringify(params) : null, expiresAt);

  const order = getOrder(orderNo);
  const payParams = buildPaymentParams(order, useChannel);
  return { order, payParams };
}

// 创建人工报价订单
export function requestQuoteOrder({ userId, itemType, customRequirements, expectedDeadline }) {
  const feature = getFeaturePrice(itemType);
  if (!feature || !feature.is_active) throw new Error('功能不存在或已下架');

  const orderNo = genOrderNo();
  db.prepare(
    `INSERT INTO orders (order_no, user_id, type, target, target_name, status, item_type, item_name, quantity, custom_requirements, params_json)
     VALUES (?, ?, 'feature', ?, ?, 'awaiting_quote', ?, ?, 1, ?, ?)`
  ).run(orderNo, userId, itemType, feature.name, itemType, feature.name, customRequirements || null,
    JSON.stringify({ expected_deadline: expectedDeadline || null }));

  return { order: getOrder(orderNo) };
}

// 管理员报价：更新 quoted_price / quote_note，状态变为 quoted
export function adminQuoteOrder(orderId, quotedPrice, quoteNote = '') {
  const price = Number(quotedPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error('报价金额无效');
  if (price > 1000000) throw new Error('报价金额超出上限（100万元）');
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('订单不存在');
  if (order.type !== 'feature') throw new Error('仅功能订单支持报价');
  if (!['awaiting_quote', 'quoted'].includes(order.status)) throw new Error(`订单状态 ${order.status}，不能报价`);
  db.prepare('UPDATE orders SET quoted_price = ?, quote_note = ?, amount = ?, status = ? WHERE id = ?')
    .run(price, quoteNote, price, 'quoted', orderId);
  return getOrderByNo(order.order_no);
}

// 已报价订单发起支付：用户「接受并支付」
export function initiateOrderPayment(orderNo, paymentMethod) {
  const order = getOrder(orderNo);
  if (!order) throw new Error('订单不存在');
  if (order.type !== 'feature') throw new Error('仅功能订单支持支付');
  if (order.status !== 'quoted') throw new Error(`订单状态 ${order.status}，不能支付`);
  if (order.quoted_price == null || order.quoted_price <= 0) throw new Error('订单尚未报价');

  const useChannel = resolveChannel(paymentMethod);
  db.prepare('UPDATE orders SET amount = ?, payment_method = ?, payment_channel = ?, status = ? WHERE order_no = ?')
    .run(order.quoted_price, useChannel, useChannel, 'quoted', orderNo);

  const updated = getOrder(orderNo);
  const payParams = buildPaymentParams(updated, useChannel);
  return { order: updated, payParams };
}

function getOrder(orderNo) {
  return db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
}

function getOrderByNo(orderNo) {
  return getOrder(orderNo);
}

// 构造前端展示用的支付参数（二维码 / 跳转链接）
function buildPaymentParams(order, channel) {
  if (channel === 'mock') {
    return {
      channel: 'mock',
      qr_code: `mock://${order.order_no}`,
      mock_pay_url: `/api/payment/mock/${order.order_no}`,
      amount: order.amount,
      order_no: order.order_no,
    };
  }
  if (channel === 'alipay') {
    return {
      channel: 'alipay',
      qrcode_url: `/api/payment/alipay/qrcode/${order.order_no}`,
      amount: order.amount,
      order_no: order.order_no,
    };
  }
  if (channel === 'wechat') {
    return {
      channel: 'wechat',
      qrcode_url: `/api/payment/wechat/qrcode/${order.order_no}`,
      amount: order.amount,
      order_no: order.order_no,
    };
  }
  return { channel: 'unknown', amount: order.amount, order_no: order.order_no };
}

// ========== 支付成功后的统一回调（订单状态机 + 业务触发） ==========
export async function markOrderPaid({ orderNo, transactionId = null, channel = null }) {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!order) throw new Error('订单不存在');
  if (order.status === 'paid') {
    // 幂等：已支付则直接返回（记录额外交易号到 metadata，不重复发放）
    if (transactionId && transactionId !== order.transaction_id) {
      let meta = {};
      try { meta = JSON.parse(order.metadata || '{}'); } catch {}
      if (!meta.extra_transaction_ids) meta.extra_transaction_ids = [];
      meta.extra_transaction_ids.push(transactionId);
      db.prepare('UPDATE orders SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), order.id);
    }
    return { alreadyPaid: true, order };
  }
  if (order.status === 'cancelled') throw new Error('订单已取消，不能改为已支付');
  if (order.status === 'completed') throw new Error('订单已完成');

  // transaction_id 唯一性检查：防止同一笔交易被绑定到多个订单
  if (transactionId) {
    const dup = db.prepare('SELECT id, order_no FROM orders WHERE transaction_id = ? AND order_no != ?').get(transactionId, orderNo);
    if (dup) throw new Error(`交易号 ${transactionId} 已绑定订单 ${dup.order_no}，疑似重复回调`);
  }

  const tx = db.transaction(() => {
    const r = db.prepare(
      `UPDATE orders SET status = 'paid', paid_at = ?, transaction_id = COALESCE(?, transaction_id),
       payment_channel = COALESCE(?, payment_channel), service_status = ? WHERE order_no = ? AND status NOT IN ('paid', 'completed', 'cancelled')`
    ).run(now(), transactionId, channel, order.type === 'feature' ? 'processing' : 'pending', orderNo);
    if (r.changes === 0) {
      throw new Error(`订单状态已变更，当前状态：${getOrder(orderNo).status}`);
    }

    // 功能订单：固定价订单进入服务队列（service_status=processing，生成由工具调用触发）
    if (order.type === 'feature') {
      // 无需额外发放权益，服务在 tools 路由依据订单执行
    }
    // 课程订单 → 记录已购课程
    if (order.type === 'course') {
      const meta = JSON.parse(order.metadata || '{}');
      if (meta.course_id) {
        grantCourse(order.user_id, meta.course_id, meta.validity_days, order.id, meta.requirements ? JSON.stringify(meta.requirements) : null);
      }
    }
    // 毕业作品订单 → 标记已支付并关联支付订单
    if (order.type === 'graduation') {
      const meta = JSON.parse(order.metadata || '{}');
      if (meta.gp_order_id) {
        const gp = db.prepare('SELECT user_id, status, quote_status, quoted_price FROM graduation_project_orders WHERE id = ?').get(meta.gp_order_id);
        if (!gp) throw new Error('毕业作品订单不存在，支付已取消');
        if (gp.user_id !== order.user_id) throw new Error('订单归属异常，支付已取消');
        if (gp.status !== 'pending') throw new Error(`毕业作品订单状态 ${gp.status}，不能支付`);
        if (gp.quote_status !== 'approved') throw new Error('报价未通过审批，支付已取消');
        if (gp.quoted_price == null || Number(gp.quoted_price) !== Number(order.amount)) {
          throw new Error('报价已变更，请重新发起支付');
        }
        db.prepare('UPDATE graduation_project_orders SET status = ?, order_id = ? WHERE id = ?').run('paid', order.id, meta.gp_order_id);
      }
    }
  });
  tx();

  return { order: getOrder(orderNo) };
}

// 关闭超时未支付订单
export function closeExpiredOrders() {
  const r = db.prepare(
    `UPDATE orders SET status = 'cancelled' WHERE status IN ('pending', 'awaiting_quote', 'quoted') AND expires_at IS NOT NULL AND expires_at < ?`
  ).run(now());
  return r.changes;
}

// 报价变更/审批状态变化时，作废该毕业作品订单关联的所有待支付 orders
export function closePendingGraduationOrders(gpOrderId) {
  if (!gpOrderId) return 0;
  return db.prepare(
    "UPDATE orders SET status = 'cancelled' WHERE status IN ('pending', 'awaiting_quote', 'quoted') AND type = 'graduation' AND target = ?"
  ).run(String(gpOrderId)).changes;
}

// ========== 支付宝：使用官方 alipay-sdk（电脑网站支付/当面付） ==========
function getAlipaySdk(cfg) {
  return new AlipaySdk({
    appId: cfg.appid,
    privateKey: readKeyContent(cfg.privateKey, cfg.privateKeyPath),
    alipayPublicKey: readKeyContent(cfg.publicKey, cfg.publicKeyPath),
    gateway: cfg.gateway,
    signType: 'RSA2',
  });
}

// 当面付预下单：调用 alipay.trade.precreate 返回二维码链接
export async function createAlipayQrcode(order) {
  const cfg = getPaymentConfig().alipay;
  if (!cfg.appid || !(cfg.privateKey || cfg.privateKeyPath) || !(cfg.publicKey || cfg.publicKeyPath)) {
    throw new Error('支付宝配置不完整，请在管理后台填写 AppID / 私钥 / 公钥');
  }
  const sdk = getAlipaySdk(cfg);
  const result = await sdk.exec('alipay.trade.precreate', {
    bizContent: {
      out_trade_no: order.order_no,
      total_amount: order.amount.toFixed(2),
      subject: order.item_name || order.target_name || 'ScholarForge 服务',
      timeout_express: '15m',
    },
  });
  const qrCode = result.qr_code || result.qrCode;
  if (!qrCode) {
    logger.error('payment', `支付宝下单失败 order=${order.order_no}: ${JSON.stringify(result).slice(0, 500)}`);
    throw new Error('支付宝下单失败，请稍后重试');
  }
  return qrCode;
}

// 支付宝异步回调验签
export function verifyAlipayNotify(params, cfg) {
  if (!params || !params.sign) return false;
  try {
    const sdk = getAlipaySdk(cfg);
    return sdk.checkNotifySign(params);
  } catch (err) {
    logger.error('payment', `支付宝回调验签失败: ${err.message}`);
    return false;
  }
}

// ========== 微信 Native 扫码支付：wechatpay-axios-plugin ==========
function getWechatpaySdk(cfg) {
  const opts = {
    mchid: cfg.mchId,
    serial: cfg.serialNo,
    privateKey: readKeyContent(cfg.privateKey, cfg.privateKeyPath),
    apiKeys: { v3: cfg.apiV3Key },
  };
  const pubKey = readKeyContent(cfg.platformPublicKey, cfg.platformPublicKeyPath);
  if (pubKey) opts.publicKey = pubKey;
  return new Wechatpay(opts);
}

// Native 下单：返回 code_url（微信支付二维码链接）
export async function createWechatQrcode(order) {
  const cfg = getPaymentConfig().wechat;
  if (!cfg.appid || !cfg.mchId || !cfg.apiV3Key || !(cfg.privateKey || cfg.privateKeyPath) || !cfg.notifyUrl) {
    throw new Error('微信支付配置不完整，请在管理后台填写 AppID / 商户号 / V3密钥 / 商户证书私钥 / 回调URL');
  }
  const wxpay = getWechatpaySdk(cfg);
  const { status, data } = await wxpay.v3.pay.transactions.native.post({
    appid: cfg.appid,
    mchid: cfg.mchId,
    description: (order.item_name || order.target_name || 'ScholarForge 服务').slice(0, 127),
    out_trade_no: order.order_no,
    notify_url: cfg.notifyUrl,
    amount: { total: Math.round(order.amount * 100), currency: 'CNY' },
  });
  if (status !== 200 || !data?.code_url) {
    logger.error('payment', `微信下单失败 order=${order.order_no}: ${JSON.stringify({ status, data }).slice(0, 500)}`);
    throw new Error('微信下单失败，请稍后重试');
  }
  return data.code_url;
}

// 微信回调验签
export function verifyWechatNotify(headers, rawBody, cfg) {
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const sig = headers['wechatpay-signature'];
  const serial = headers['wechatpay-serial'];
  if (!timestamp || !nonce || !sig || !serial) return false;
  const ts = parseInt(timestamp, 10);
  if (Math.abs(now() - ts) > 300) return false;
  if (!cfg.platformSerialNo) {
    logger.error('payment', '微信平台证书序列号未配置，拒绝回调');
    return false;
  }
  if (serial !== cfg.platformSerialNo) {
    logger.error('payment', `微信回调证书序列号不匹配: 回调=${serial}, 配置=${cfg.platformSerialNo}`);
    return false;
  }
  const pubKey = readKeyContent(cfg.platformPublicKey, cfg.platformPublicKeyPath);
  if (!pubKey) {
    logger.error('payment', '微信平台证书未配置，拒绝回调');
    return false;
  }
  try {
    const signStr = `${timestamp}\n${nonce}\n${rawBody}\n`;
    return Rsa.verify(signStr, sig, pubKey);
  } catch (err) {
    logger.error('payment', `微信回调验签失败: ${err.message}`);
    return false;
  }
}

// 微信回调 resource 解密
export function decryptWechatResource(resource, apiV3Key) {
  if (!resource?.ciphertext || !apiV3Key) {
    throw new Error('缺少密文或 APIv3 密钥');
  }
  try {
    const decrypted = Aes.AEAD.decrypt(
      resource.ciphertext,
      apiV3Key,
      resource.nonce || '',
      resource.associated_data || ''
    );
    return JSON.parse(decrypted.toString('utf8'));
  } catch (err) {
    throw new Error('微信回调解密失败：' + err.message);
  }
}
