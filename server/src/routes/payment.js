// 支付路由
// - POST /payment/create-order：通用创建订单（功能 / 课程）
// - POST /payment/mock/:orderNo：模拟支付（演示用，立即标记 paid 并执行）
// - GET  /payment/alipay/qrcode/:orderNo：获取支付宝当面付二维码
// - GET  /payment/wechat/qrcode/:orderNo：获取微信 Native 二维码
import logger from '../logger.js';
// - POST /payment/alipay/notify：支付宝异步回调
// - POST /payment/wechat/notify：微信异步回调
// - GET  /payment/order/:orderNo/status：轮询订单状态
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import { paymentLimiter } from '../middleware/rateLimit.js';
import db from '../db.js';
import {
  createOrder,
  markOrderPaid,
  createAlipayQrcode,
  createWechatQrcode,
  verifyAlipayNotify,
  verifyWechatNotify,
  decryptWechatResource,
} from '../services/payment.js';
import { getPaymentConfig, getSetting, getAvailableChannels } from '../config-store.js';

const router = Router();

// 支付动作限流：每用户每分钟最多 30 次（防订单 / 支付接口被刷，M-2）
router.use((req, res, next) => {
  if (req.method === 'POST') return paymentLimiter(req, res, next);
  next();
});

// 创建订单（通用：用户端直接调，比如"购买课程"）
router.post('/create-order', authRequired, (req, res) => {
  const { type, target, channel, courseRequirements } = req.body || {};
  if (!type || !target) return res.status(400).json({ error: '请指定订单类型和目标' });
  try {
    const result = createOrder({
      userId: req.user.id,
      type,
      target,
      channel: channel || null,
      courseRequirements: courseRequirements || null,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 模拟支付：直接标记为 paid 并执行功能订单
// 安全限制（多层防御）：
//   1. 生产环境 → 无条件完全禁用（无论 payment_mode 如何配置，防默认 mock 绕过）
//   2. 非生产环境但已配置真实支付通道且未显式 mock 模式 → 禁用（防演示/预发环境误用 mock 绕过支付）
//   3. 订单 payment_channel 必须为 mock（创建订单时已校验，此处再核一次）
router.post('/mock/:orderNo', authRequired, async (req, res) => {
  // 生产环境一律禁用模拟支付端点（无论 payment_mode 如何配置），
  // 防止默认 mock 模式下被用于零成本绕过支付
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: '模拟支付已禁用' });
  }
  const paymentMode = getSetting('payment_mode', 'mock');
  // 收紧：已配置真实支付通道但未显式 mock 模式时，禁用模拟支付（即便非生产环境）
  if (paymentMode !== 'mock') {
    const channels = getAvailableChannels();
    if (!channels.includes('mock')) {
      return res.status(403).json({ error: '模拟支付已禁用（已配置真实支付通道）' });
    }
  }
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.user_id !== req.user.id) return res.status(403).json({ error: '无权操作此订单' });
  if (order.payment_channel !== 'mock') {
    return res.status(403).json({ error: '该订单需通过' + (order.payment_channel === 'alipay' ? '支付宝' : '微信') + '支付，不能使用模拟支付' });
  }
  if (order.status === 'paid') {
    // 已支付，幂等返回
    return res.json({ ok: true, order, alreadyPaid: true });
  }
  if (!['pending', 'quoted'].includes(order.status)) return res.status(400).json({ error: `订单状态 ${order.status}，不能支付` });

  try {
    await markOrderPaid({ orderNo: order.order_no, transactionId: `mock_${Date.now()}`, channel: 'mock' });
    const updated = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(order.order_no);
    res.json({ ok: true, order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 支付宝二维码
router.get('/alipay/qrcode/:orderNo', authRequired, async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.user_id !== req.user.id) return res.status(403).json({ error: '无权操作' });
  if (!['pending', 'quoted'].includes(order.status)) return res.status(400).json({ error: '订单状态不允许支付' });
  try {
    const qrCode = await createAlipayQrcode(order);
    res.json({ qr_code: qrCode, order_no: order.order_no, amount: order.amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 微信二维码
router.get('/wechat/qrcode/:orderNo', authRequired, async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.user_id !== req.user.id) return res.status(403).json({ error: '无权操作' });
  if (!['pending', 'quoted'].includes(order.status)) return res.status(400).json({ error: '订单状态不允许支付' });
  try {
    const codeUrl = await createWechatQrcode(order);
    res.json({ code_url: codeUrl, order_no: order.order_no, amount: order.amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 支付宝异步回调（无需 auth）
router.post('/alipay/notify', async (req, res) => {
  const cfg = getPaymentConfig().alipay;
  const params = req.body || {};
  let verified = false;
  try {
    verified = verifyAlipayNotify(params, cfg);
  } catch (err) {
    logger.error('payment', `支付宝验签异常: ${err.message}`);
    return res.send('fail');
  }
  if (!verified) {
    return res.send('fail');
  }
  // 商户归属校验：回调 app_id 必须等于本平台配置的 appid。
  // 防跨商户通知重放攻击：攻击者用自己的支付宝商户号对相同订单号发起支付（钱付给自己，
  // 零成本），再把支付宝发给自己的合法通知重放到本平台，验签可过但 app_id 必不匹配。
  if (!cfg.appid || params.app_id !== cfg.appid) {
    logger.error('payment', `支付宝回调 app_id 不匹配: 回调=${params.app_id || '(空)'} 配置=${cfg.appid || '(空)'}，已拒绝`);
    return res.send('fail');
  }
  if (params.trade_status !== 'TRADE_SUCCESS' && params.trade_status !== 'TRADE_FINISHED') {
    return res.send('success');
  }
  try {
    // 金额一致性校验：转为整数分精确比较，避免浮点容差问题
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(params.out_trade_no);
    if (!order) return res.send('fail');
    const callbackCents = Math.round(parseFloat(params.total_amount) * 100);
    const orderCents = Math.round(order.amount * 100);
    if (!Number.isFinite(callbackCents) || callbackCents !== orderCents) {
      logger.error('payment', `支付宝回调金额不一致: 订单 ${orderCents}分 vs 回调 ${callbackCents}分`);
      return res.send('fail');
    }
    await markOrderPaid({
      orderNo: params.out_trade_no,
      transactionId: params.trade_no,
      channel: 'alipay',
    });
    res.send('success');
  } catch (err) {
    logger.error('payment', `支付宝回调处理失败: ${err.message}`);
    res.send('fail');
  }
});

// 微信异步回调（无需 auth）
router.post('/wechat/notify', async (req, res) => {
  const cfg = getPaymentConfig().wechat;
  const headers = req.headers;
  // 必须使用原始字节流验签，JSON.stringify(req.body) 会因键序/转义不一致导致验签失败
  const rawBody = req.rawBody || '';
  let verified = false;
  try {
    verified = verifyWechatNotify(headers, rawBody, cfg);
  } catch (err) {
    logger.error('payment', `微信验签异常: ${err.message}`);
    return res.status(401).json({ code: 'FAIL', message: '验签异常' });
  }
  if (!verified) {
    return res.status(401).json({ code: 'FAIL', message: '验签失败' });
  }
  const evt = req.body || {};
  if (evt.event_type !== 'TRANSACTION.SUCCESS') {
    return res.json({ code: 'SUCCESS', message: 'OK' });
  }
  // 微信 v3 回调的 resource 是 AEAD_AES_256_GCM 加密的，需用 apiV3Key 解密
  let resource = evt.resource || {};
  if (resource.ciphertext) {
    try {
      resource = decryptWechatResource(resource, cfg.apiV3Key);
    } catch (err) {
      logger.error('payment', `微信回调解密失败: ${err.message}`);
      return res.status(500).json({ code: 'FAIL', message: '解密失败' });
    }
  }
  if (resource.trade_state !== 'SUCCESS') {
    return res.json({ code: 'SUCCESS', message: 'OK' });
  }
  // 商户归属校验：解密后的 resource 必须属于本平台商户（mchid / appid 双校验）。
  // resource 用本商户 APIv3Key 加密，正常情况必然匹配；显式校验可防配置漂移与历史密钥泄露。
  if (!cfg.mchId || resource.mchid !== cfg.mchId) {
    logger.error('payment', `微信回调商户号不匹配: 回调=${resource.mchid || '(空)'} 配置=${cfg.mchId || '(空)'}，已拒绝`);
    return res.json({ code: 'FAIL', message: '商户号不匹配' });
  }
  if (resource.appid && cfg.appid && resource.appid !== cfg.appid) {
    logger.error('payment', `微信回调 appid 不匹配: 回调=${resource.appid} 配置=${cfg.appid}，已拒绝`);
    return res.json({ code: 'FAIL', message: 'appid 不匹配' });
  }
  try {
    // 金额一致性校验（微信金额单位为分）：强制转数字并严格比较，避免 typeof 跳过校验
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(resource.out_trade_no);
    if (!order) return res.json({ code: 'FAIL', message: '订单不存在' });
    const callbackCents = Number(resource?.amount?.total);
    const orderCents = Math.round(order.amount * 100);
    if (!Number.isFinite(callbackCents) || callbackCents !== orderCents) {
      logger.error('payment', `微信回调金额不一致: 订单 ${orderCents}分 vs 回调 ${callbackCents}分`);
      return res.json({ code: 'FAIL', message: '金额不一致' });
    }
    await markOrderPaid({
      orderNo: resource.out_trade_no,
      transactionId: resource.transaction_id,
      channel: 'wechat',
    });
    res.json({ code: 'SUCCESS', message: 'OK' });
  } catch (err) {
    logger.error('payment', `微信回调处理失败: ${err.message}`);
    // 不向回调方返回内部错误详情（可能含订单号/交易号），统一返回固定消息
    res.status(500).json({ code: 'FAIL', message: '处理失败' });
  }
});

// 轮询订单状态（前端支付后用）
router.get('/order/:orderNo/status', authRequired, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.user_id !== req.user.id) return res.status(403).json({ error: '无权查看' });

  let meta = {};
  try { meta = JSON.parse(order.metadata || '{}'); } catch { meta = {}; }

  res.json({
    order_no: order.order_no,
    status: order.status,
    amount: order.amount,
    payment_channel: order.payment_channel,
    paid_at: order.paid_at,
    executed: !!meta.executed,
    doc_id: meta.doc_id || null,
    result_preview: meta.result_preview || null,
  });
});

export default router;
