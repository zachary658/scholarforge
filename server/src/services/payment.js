// 支付服务
// 三种通道：mock（演示，立即生效）/ alipay（当面付扫码）/ wechat（Native 扫码）
// 管理员配置真实密钥后自动启用真实通道；未配置时回落 mock
// 使用官方/社区 SDK 处理签名验签，避免手写 RSA2/AES-256-GCM 的安全风险
import crypto from 'crypto';
import logger from '../logger.js';
import db from '../db.js';
import { getPaymentConfig, getAvailableChannels, getPointsPackage, getCourse } from '../config-store.js';
import { grantPoints } from './billing.js';
import { computeCourseQuote } from './course-quote.js';
import { now, datePrefix } from '../utils.js';
import { AlipaySdk } from 'alipay-sdk';
import { Wechatpay, Aes, Rsa } from 'wechatpay-axios-plugin';

// 生成订单号：SF + YYYYMMDD + 8位十六进制随机（crypto.randomBytes，避免 Math.random 可预测）
export function genOrderNo() {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `SF${datePrefix()}${rand}`;
}

function genRefundNo() {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `RF${datePrefix()}${rand}`;
}

// 发放课程权益：记录用户已购课程（论文 1 对 1 指导）
// validityDays 为 null 表示长期有效；requirements 为用户填写的定制需求（JSON 字符串或 null）
function grantCourse(userId, courseId, validityDays, orderId, requirements = null) {
  const expiresAt = validityDays ? now() + validityDays * 86400 : null;
  db.prepare(
    `INSERT INTO user_courses (user_id, course_id, quota_remaining, order_id, expires_at, purchased_at, requirements)
     VALUES (?, ?, 0, ?, ?, ?, ?)`
  ).run(userId, courseId, orderId, expiresAt, now(), requirements);
}

// 创建订单（积分充值 / 课程购买）
// type: 'points_package' | 'course'
// target: points_package_id 或 course_id
// courseRequirements: 课程定制需求（专业/字数/图表/图纸/公式/加急），服务端据此权威计算金额
export function createOrder({ userId, type, target, channel = null, courseRequirements = null }) {
  const cfg = getPaymentConfig();
  const channels = getAvailableChannels();

  // 选择通道：优先用户指定 → 管理员配置 mode → mock 兜底
  // 安全：非 mock 模式下，拒绝用户主动指定 mock 通道（防止支付绕过）
  if (channel === 'mock' && cfg.mode !== 'mock') {
    throw new Error('模拟支付通道未开放');
  }
  let useChannel = channel;
  if (!useChannel || !channels.includes(useChannel)) {
    if (cfg.mode === 'alipay' && channels.includes('alipay')) useChannel = 'alipay';
    else if (cfg.mode === 'wechat' && channels.includes('wechat')) useChannel = 'wechat';
    else if (cfg.mode === 'mixed') useChannel = channels.find((c) => c !== 'mock') || 'mock';
    else useChannel = 'mock';
  }

  let amount = 0;
  let targetName = '';
  let metadata = {};
  if (type === 'points_package') {
    const pkg = getPointsPackage(parseInt(target, 10));
    if (!pkg || !pkg.is_active) throw new Error('充值套餐不存在或已下架');
    amount = pkg.price;
    targetName = pkg.name;
    metadata = { package_id: pkg.id, points: pkg.points, bonus_points: pkg.bonus_points };
  } else if (type === 'course') {
    const course = getCourse(parseInt(target, 10));
    if (!course || !course.is_active) throw new Error('课程不存在或已下架');
    // 定制报价：填了需求则按需求动态计价；未填则退回课程基础"起"价（简单购买场景）
    if (courseRequirements) {
      const quote = computeCourseQuote(course, courseRequirements);
      amount = quote.amount;
      metadata = {
        course_id: course.id,
        validity_days: course.validity_days,
        degree: course.degree,
        requirements: quote.requirements,
        breakdown: quote.breakdown,
      };
    } else {
      amount = course.price;
      metadata = { course_id: course.id, validity_days: course.validity_days, degree: course.degree };
    }
    targetName = course.title;
  } else if (type === 'graduation') {
    // 毕业作品定制订单：target = graduation_project_orders.id，金额 = 客服已报价的 quoted_price
    const gpOrder = db.prepare(
      `SELECT gpo.id, gpo.quoted_price, gpo.status, gpo.user_id, gp.title
       FROM graduation_project_orders gpo
       JOIN graduation_projects gp ON gp.id = gpo.project_id
       WHERE gpo.id = ?`
    ).get(parseInt(target, 10));
    if (!gpOrder) throw new Error('毕业作品订单不存在');
    if (gpOrder.user_id !== userId) throw new Error('无权操作该订单');
    if (gpOrder.status !== 'pending') throw new Error(`订单状态 ${gpOrder.status}，不能支付`);
    if (gpOrder.quoted_price == null || gpOrder.quoted_price <= 0) throw new Error('订单尚未报价，请联系客服报价后再支付');
    amount = gpOrder.quoted_price;
    targetName = `毕业作品：${gpOrder.title}`;
    metadata = { gp_order_id: gpOrder.id, project_title: gpOrder.title };
  } else {
    throw new Error('未知的订单类型');
  }

  if (amount === 0) {
    // 0 元订单：仅在 mock 模式允许，生产环境拒绝（防止支付绕过）
    if (cfg.mode !== 'mock') {
      throw new Error('不支持0元订单，请联系管理员');
    }
    // 直接标记为 paid，并立即发放权益（包裹在事务内，保证一致性）
    // 注意：amount < 0 视为配置错误，直接抛错（避免负值绕过支付）
    const orderNo = genOrderNo();
    const tx = db.transaction(() => {
      const info = db.prepare(
        `INSERT INTO orders (order_no, user_id, type, target, target_name, amount, status, payment_method, payment_channel, paid_at, metadata, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?)`
      ).run(orderNo, userId, type, String(target), targetName, 0, useChannel, useChannel, now(), JSON.stringify(metadata), null);
      const orderId = info.lastInsertRowid;
      // 积分充值订单立即发放积分
      if (type === 'points_package' && metadata.package_id) {
        grantPoints(userId, metadata.points + (metadata.bonus_points || 0), 'topup', `充值套餐：${targetName}`, orderId);
      }
      // 课程订单立即发放课程权益
      if (type === 'course' && metadata.course_id) {
        grantCourse(userId, metadata.course_id, metadata.validity_days, orderId, metadata.requirements ? JSON.stringify(metadata.requirements) : null);
      }
    });
    tx();
    return { order: getOrder(orderNo) };
  }
  if (amount < 0) {
    throw new Error('订单金额异常（负值），请检查功能定价配置');
  }

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

function getOrder(orderNo) {
  return db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
}

// 构造前端展示用的支付参数（二维码 / 跳转链接）
function buildPaymentParams(order, channel) {
  if (channel === 'mock') {
    return {
      channel: 'mock',
      qr_code: `mock://${order.order_no}`,
      // 前端可调 /api/payment/mock/pay/:orderNo 立即触发模拟支付
      mock_pay_url: `/api/payment/mock/${order.order_no}`,
      amount: order.amount,
      order_no: order.order_no,
    };
  }
  if (channel === 'alipay') {
    // 实际应调用 alipay.trade.precreate 返回二维码链接
    // 此处返回预生成参数；真实调用在 payment 路由里发起
    return {
      channel: 'alipay',
      // 前端调 /api/payment/alipay/qrcode/:orderNo 拿真实二维码
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
  return { channel: 'unknown' };
}

// ========== 支付成功后的统一回调（订单状态机 + 业务发放） ==========
export async function markOrderPaid({ orderNo, transactionId = null, channel = null }) {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!order) throw new Error('订单不存在');
  if (order.status === 'paid') {
    // 订单已支付，但收到新的 transaction_id：记录到 metadata 并自动退款
    if (transactionId && transactionId !== order.transaction_id) {
      let meta = {};
      try { meta = JSON.parse(order.metadata || '{}'); } catch {}
      if (!meta.extra_transaction_ids) meta.extra_transaction_ids = [];
      meta.extra_transaction_ids.push(transactionId);
      db.prepare('UPDATE orders SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), order.id);
      // 异步发起退款，不阻塞返回
      refundOrder(orderNo, `重复支付自动退款：${transactionId}`).catch((refundErr) => {
        logger.error('payment', `重复支付自动退款失败 order=${orderNo}: ${refundErr.message}`);
      });
    }
    return { alreadyPaid: true, order };
  }
  if (order.status === 'refunded') throw new Error('订单已退款，不能改为已支付');
  // 已关闭的订单收到支付回调：重新打开并处理（用户已实际付款）
  if (order.status === 'closed') {
    logger.warn('payment', `已关闭订单 ${orderNo} 收到支付回调，重新打开`);
  }

  // transaction_id 唯一性检查：防止同一笔交易被绑定到多个订单
  if (transactionId) {
    const dup = db.prepare('SELECT id, order_no FROM orders WHERE transaction_id = ? AND order_no != ?').get(transactionId, orderNo);
    if (dup) throw new Error(`交易号 ${transactionId} 已绑定订单 ${dup.order_no}，疑似重复回调`);
  }

  const tx = db.transaction(() => {
    // 带状态守卫的 UPDATE：仅当当前状态非 paid/refunded 时才更新（防御纵深，防 TOCTOU）
    const r = db.prepare(
      `UPDATE orders SET status = 'paid', paid_at = ?, transaction_id = COALESCE(?, transaction_id),
       payment_channel = COALESCE(?, payment_channel) WHERE order_no = ? AND status NOT IN ('paid', 'refunded')`
    ).run(now(), transactionId, channel, orderNo);
    if (r.changes === 0) {
      // 状态已被并发修改（可能是退款或已支付），抛出让上层处理
      throw new Error(`订单状态已变更，当前状态：${getOrder(orderNo).status}`);
    }

    // 业务发放：积分充值订单 → 发放积分
    if (order.type === 'points_package') {
      const meta = JSON.parse(order.metadata || '{}');
      if (meta.package_id) {
        grantPoints(order.user_id, meta.points + (meta.bonus_points || 0), 'topup', `充值套餐：${order.target_name}`, order.id);
      }
    }
    // 业务发放：课程订单 → 记录已购课程
    if (order.type === 'course') {
      const meta = JSON.parse(order.metadata || '{}');
      if (meta.course_id) {
        grantCourse(order.user_id, meta.course_id, meta.validity_days, order.id, meta.requirements ? JSON.stringify(meta.requirements) : null);
      }
    }
    // 业务发放：毕业作品订单 → 标记已支付并关联支付订单（进入客服对接流程）
    if (order.type === 'graduation') {
      const meta = JSON.parse(order.metadata || '{}');
      if (meta.gp_order_id) {
        db.prepare('UPDATE graduation_project_orders SET status = ?, order_id = ? WHERE id = ?')
          .run('paid', order.id, meta.gp_order_id);
      }
    }
  });
  tx();

  return { order: getOrder(orderNo) };
}

// 关闭超时未支付订单
export function closeExpiredOrders() {
  const r = db.prepare(
    `UPDATE orders SET status = 'closed' WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`
  ).run(now());
  return r.changes;
}

// 退款（管理员手动 / 自动退款）
export async function refundOrder(orderNo, reason = '') {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!order) throw new Error('订单不存在');
  if (order.status !== 'paid') throw new Error(`订单状态 ${order.status}，不能退款`);

  let meta = {};
  try { meta = JSON.parse(order.metadata || '{}'); } catch {}

  // 调用支付渠道退款 API
  let refundTransactionId = null;
  const cfg = getPaymentConfig();
  if (order.payment_channel === 'alipay') {
    try {
      const alipaySdk = getAlipaySdk(cfg.alipay);
      const refundResult = await alipaySdk.exec('alipay.trade.refund', {
        bizContent: {
          out_trade_no: order.order_no,
          refund_amount: order.amount.toFixed(2),
          refund_reason: reason || '退款',
        },
      });
      if (refundResult.code === '10000') {
        refundTransactionId = refundResult.tradeNo || '';
      } else {
        logger.error('payment', `支付宝退款失败 order=${order.order_no}: ${JSON.stringify(refundResult).slice(0, 500)}`);
        throw new Error('支付宝退款失败，请稍后重试');
      }
    } catch (err) {
      if (err.message.includes('支付宝退款失败')) throw err;
      logger.error('payment', `支付宝退款异常 order=${order.order_no}: ${err.message}`);
      throw new Error('支付宝退款失败，请稍后重试');
    }
  } else if (order.payment_channel === 'wechat') {
    try {
      const wxpay = getWechatpaySdk(cfg.wechat);
      const refundNo = genRefundNo();
      const { status, data } = await wxpay.v3.refund.domestic.refunds.post({
        out_trade_no: order.order_no,
        out_refund_no: refundNo,
        amount: { refund: Math.round(order.amount * 100), total: Math.round(order.amount * 100), currency: 'CNY' },
        reason: reason || '退款',
      });
      if (status === 200 && data?.refund_id) {
        refundTransactionId = data.refund_id;
      } else {
        logger.error('payment', `微信退款失败 order=${order.order_no}: ${JSON.stringify({ status, data }).slice(0, 500)}`);
        throw new Error('微信退款失败，请稍后重试');
      }
    } catch (err) {
      if (err.message.includes('微信退款失败')) throw err;
      logger.error('payment', `微信退款异常 order=${order.order_no}: ${err.message}`);
      throw new Error('微信退款失败，请稍后重试');
    }
  }

  // 记录退款交易号到 metadata
  if (refundTransactionId) {
    meta.refund_transaction_id = refundTransactionId;
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE orders SET status = 'refunded', refunded_at = ?, refund_reason = ?, metadata = ? WHERE order_no = ?`
    ).run(now(), reason, JSON.stringify(meta), orderNo);
    // 积分充值退款：扣回积分（如果用户还没花完）
    if (order.type === 'points_package') {
      const pkgMeta = JSON.parse(order.metadata || '{}');
      const totalPoints = (pkgMeta.points || 0) + (pkgMeta.bonus_points || 0);
      if (totalPoints > 0) {
        const current = db.prepare('SELECT points FROM users WHERE id = ?').get(order.user_id);
        if (current && current.points >= totalPoints) {
          // 积分充足，全额扣回
          db.prepare('UPDATE users SET points = points - ? WHERE id = ?').run(totalPoints, order.user_id);
          const newBalance = db.prepare('SELECT points FROM users WHERE id = ?').get(order.user_id).points;
          db.prepare(
            'INSERT INTO points_log (user_id, type, points, balance_after, order_id, description) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(order.user_id, 'refund', -totalPoints, newBalance, order.id, `退款扣回积分：${reason || '退款'}`);
        } else {
          // 积分不足（已消费部分），扣回剩余
          const remaining = current ? current.points : 0;
          if (remaining > 0) {
            db.prepare('UPDATE users SET points = 0 WHERE id = ?').run(order.user_id);
            db.prepare(
              'INSERT INTO points_log (user_id, type, points, balance_after, order_id, description) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(order.user_id, 'refund', -remaining, 0, order.id, `退款扣回剩余积分：${reason || '退款'}`);
          }
        }
      }
    }
    // 课程退款：删除用户课程记录（权益回收）
    if (order.type === 'course') {
      db.prepare('DELETE FROM user_courses WHERE order_id = ?').run(order.id);
    }
    // 毕业作品退款：回退订单状态（回到待支付，权益回收）
    if (order.type === 'graduation') {
      const meta = JSON.parse(order.metadata || '{}');
      if (meta.gp_order_id) {
        db.prepare("UPDATE graduation_project_orders SET status = 'refunded', order_id = NULL WHERE id = ?")
          .run(meta.gp_order_id);
      }
    }
  });
  tx();
  return { order: getOrder(orderNo) };
}

// ========== 支付宝当面付：使用官方 alipay-sdk ==========
// 官方 SDK 自动处理 RSA2 签名/验签/证书，避免手写拼接排序的安全风险
function getAlipaySdk(cfg) {
  return new AlipaySdk({
    appId: cfg.appid,
    privateKey: cfg.privateKey,
    alipayPublicKey: cfg.publicKey,
    gateway: cfg.gateway,
    signType: 'RSA2',
  });
}

// 当面付预下单：调用 alipay.trade.precreate 返回二维码链接
export async function createAlipayQrcode(order) {
  const cfg = getPaymentConfig().alipay;
  if (!cfg.appid || !cfg.privateKey || !cfg.publicKey) {
    throw new Error('支付宝配置不完整，请在管理后台填写 AppID / 私钥 / 公钥');
  }
  const sdk = getAlipaySdk(cfg);
  const result = await sdk.exec('alipay.trade.precreate', {
    bizContent: {
      out_trade_no: order.order_no,
      total_amount: order.amount.toFixed(2),
      subject: order.target_name,
      timeout_express: '15m',
    },
  });
  // exec 返回 { qr_code } 或抛异常
  const qrCode = result.qr_code || result.qrCode;
  if (!qrCode) {
    logger.error('payment', `支付宝下单失败 order=${order.order_no}: ${JSON.stringify(result).slice(0, 500)}`);
    throw new Error('支付宝下单失败，请稍后重试');
  }
  return qrCode;
}

// 支付宝异步回调验签（使用官方 SDK，自动处理签名验证）
export function verifyAlipayNotify(params, cfg) {
  if (!params || !params.sign) return false;
  try {
    const sdk = getAlipaySdk(cfg);
    // checkNotifySign 返回 true/false
    return sdk.checkNotifySign(params);
  } catch (err) {
    logger.error('payment', `支付宝回调验签失败: ${err.message}`);
    return false;
  }
}

// ========== 微信 Native 扫码支付：使用 wechatpay-axios-plugin ==========
// 社区 SDK 自动处理 RSA2048 签名/验签/平台证书/AES-256-GCM 解密
function getWechatpaySdk(cfg) {
  const opts = {
    mchid: cfg.mchId,
    serial: cfg.serialNo,
    privateKey: cfg.privateKey,
    apiKeys: { v3: cfg.apiV3Key },
  };
  if (cfg.platformPublicKey) opts.publicKey = cfg.platformPublicKey;
  return new Wechatpay(opts);
}

// Native 下单：返回 code_url（微信支付二维码链接）
export async function createWechatQrcode(order) {
  const cfg = getPaymentConfig().wechat;
  if (!cfg.appid || !cfg.mchId || !cfg.apiV3Key || !cfg.privateKey || !cfg.notifyUrl) {
    throw new Error('微信支付配置不完整，请在管理后台填写 AppID / 商户号 / V3密钥 / 商户证书私钥 / 回调URL');
  }
  const wxpay = getWechatpaySdk(cfg);
  const { status, data } = await wxpay.v3.pay.transactions.native.post({
    appid: cfg.appid,
    mchid: cfg.mchId,
    description: order.target_name,
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

// 微信回调验签：使用 SDK 的 Rsa.verify 验证平台签名
// 需配置平台证书公钥（cfg.platformPublicKey），未配置时拒绝回调（安全优先）
export function verifyWechatNotify(headers, rawBody, cfg) {
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const sig = headers['wechatpay-signature'];
  const serial = headers['wechatpay-serial'];
  if (!timestamp || !nonce || !sig || !serial) return false;
  const ts = parseInt(timestamp, 10);
  if (Math.abs(now() - ts) > 300) return false;

  // 校验证书序列号：确保回调来自微信平台证书而非伪造
  if (!cfg.platformSerialNo) {
    logger.error('payment', '微信平台证书序列号未配置，拒绝回调。生产环境必须配置 wechat_platform_serial_no');
    return false;
  }
  if (serial !== cfg.platformSerialNo) {
    logger.error('payment', `微信回调证书序列号不匹配: 回调=${serial}, 配置=${cfg.platformSerialNo}`);
    return false;
  }

  // 未配置平台证书时拒绝回调（不再静默放行）
  if (!cfg.platformPublicKey) {
    logger.error('payment', '微信平台证书未配置，拒绝回调。生产环境必须配置 wechat_platform_public_key');
    return false;
  }
  try {
    const signStr = `${timestamp}\n${nonce}\n${rawBody}\n`;
    return Rsa.verify(signStr, sig, cfg.platformPublicKey);
  } catch (err) {
    logger.error('payment', `微信回调验签失败: ${err.message}`);
    return false;
  }
}

// 微信回调 resource 解密：使用 SDK 的 Aes.AEAD.decrypt
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
