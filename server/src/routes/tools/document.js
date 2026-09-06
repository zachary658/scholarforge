// 整篇文档改写路由：上传 .docx → 仅改写正文段落（保留格式/标题/图表/公式/表格）→ 返回新 docx 下载。
// 挂载于 tools.js（/api/tools 前缀）；文件上传走 multer 内存存储，计费复用 core 的 resolveBilling。
import { Router } from 'express';
import { authRequired } from '../../middleware.js';
import { aiToolLimiter } from '../../middleware/rateLimit.js';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import db from '../../db.js';
import { logUsage } from '../../usage.js';
import logger from '../../logger.js';
import { getFeaturePrice } from '../../config-store.js';
import { claimOrderExecution } from '../../services/order-claim.js';
import { transitionServiceToFailed, transitionServiceToCompleted } from '../../services/order-state.js';
import { hasAgreedAcademicIntegrity, resolveBilling } from './core.js';

const router = Router();

// ========== 整篇文档改写（降重 / 降AI率）==========
// 上传 .docx → 仅改写正文段落（保留格式/标题/图表/图片/公式/表格）→ 返回新 docx 下载
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function handleDocRewrite(req, res, tool) {
  const featureKey = tool; // rewrite / ai_reduce
  if (!req.file) return res.status(400).json({ error: '请上传 .docx 文档' });
  if (!String(req.file.originalname || '').toLowerCase().endsWith('.docx')) {
    return res.status(400).json({ error: '仅支持 .docx 格式文档' });
  }
  if (!hasAgreedAcademicIntegrity(req.user.id)) {
    return res.status(403).json({ error: '请先阅读并同意《学术诚信承诺书》', needAcademicIntegrity: true });
  }

  const orderNo = (req.body && req.body.orderNo) || null;
  const bill = resolveBilling(req.user.id, featureKey, orderNo);
  if (!bill.ok) return res.status(400).json({ error: bill.error });
  if (bill.mode === 'need_order') {
    const fp = getFeaturePrice(featureKey);
    return res.json({ needOrder: true, featureKey, itemType: featureKey, amount: fp ? fp.price : 0, materialFee: 0, materialTokens: 0, materialIds: [] });
  }
  const order = bill.order || null;
  if (order && !claimOrderExecution(order)) {
    return res.status(400).json({ error: '订单正在处理中，请勿重复提交' });
  }

  try {
    const { rewriteDocxBuffer } = await import('../../services/docx-rewrite.js');
    const { buffer, stats } = await rewriteDocxBuffer(req.file.buffer, tool);

    // 保存生成文档（docs 下载接口按用户鉴权，30 天保留）
    const prefix = tool === 'rewrite' ? '重复表达优化' : '表达自然度优化';
    const safeName = String(req.file.originalname || '文档').replace(/\.docx$/i, '').replace(/[^\w\u4e00-\u9fa5.-]/g, '_').slice(0, 80);
    const fileName = `${req.user.id}_${Date.now()}_${featureKey}_${safeName}.docx`;
    const docsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'uploads', 'docs');
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(join(docsDir, fileName), buffer);

    const info = db.prepare(
      'INSERT INTO generated_docs (user_id, title, feature, file_path, order_id) VALUES (?, ?, ?, ?, ?)'
    ).run(req.user.id, `${prefix}_${safeName}`, featureKey, fileName, order?.id || null);

    // 记录使用日志（财务核对）
    logUsage({
      userId: req.user.id,
      toolType: tool,
      action: tool + '_doc',
      model: { name: 'multi-batch' },
      inputChars: stats.totalChars,
      outputChars: stats.totalChars,
      tokens: 0,
      status: 'success',
      orderId: order?.id,
      chargeType: order ? 'paid' : 'unlimited',
      amount: order ? order.amount : 0,
    });

    if (order) {
      transitionServiceToCompleted(order.id);
    }

    res.json({
      ok: true,
      doc: { id: info.lastInsertRowid, download_url: `/api/docs/download/${info.lastInsertRowid}` },
      stats,
      // 引擎透明度：真实反映本次整篇改写使用的引擎（builtin=内置规则改写未调 AI，ai=大模型），
      // 由 docx-rewrite 按 runAI 同一口径判定后经 stats 回报
      engine: stats.usedRealAI ? 'ai' : 'builtin',
    });
  } catch (err) {
    if (order) {
      transitionServiceToFailed(order.id);
    }
    logger.error('tools', `文档改写失败: ${err.message}`);
    res.status(err.statusCode || 500).json({ error: '文档处理失败：' + err.message });
  }
}

// 整篇文档降重
router.post('/rewrite-doc', authRequired, aiToolLimiter, docUpload.single('file'), (req, res) => handleDocRewrite(req, res, 'rewrite'));
// 整篇文档降AI率
router.post('/ai-reduce-doc', authRequired, aiToolLimiter, docUpload.single('file'), (req, res) => handleDocRewrite(req, res, 'ai_reduce'));

export default router;
