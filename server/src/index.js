import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

import { ensureAdminAccount, cleanupExpiredTokens } from './auth.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import membershipRoutes from './routes/membership.js';
import toolsRoutes from './routes/tools.js';
import documentsRoutes from './routes/documents.js';
import referencesRoutes from './routes/references.js';
import adminRoutes from './routes/admin.js';
import supportRoutes from './routes/support.js';
import paymentRoutes from './routes/payment.js';
import ordersRoutes from './routes/orders.js';
import coursesRoutes from './routes/courses.js';
import templatesRoutes from './routes/templates.js';
import docsRoutes from './routes/docs.js';
import projectsRoutes from './routes/projects.js';
import tasksRoutes from './routes/tasks.js';
import graduationRoutes from './routes/graduation.js';
import chartsRoutes from './routes/charts.js';
import { closeExpiredOrders } from './services/payment.js';
import { cleanupOldTasks, cleanupOldDocs } from './services/task-store.js';
import { cleanupStaleData } from './db.js';
import { getPaymentConfig, getAvailableChannels } from './config-store.js';
import logger from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 初始化管理员账号（异步：bcrypt hash 不阻塞事件循环）
await ensureAdminAccount();

// 生产环境安全自检：默认支付模式为 mock 且未配置任何真实通道时拒绝启动。
// 防止"上线即免费支付"的配置事故（NODE_ENV=production 但 payment_mode 仍是默认 mock，用户可零成本绕过支付）
if (process.env.NODE_ENV === 'production') {
  const payCfg = getPaymentConfig();
  const channels = getAvailableChannels();
  const hasRealChannel = channels.some((c) => c !== 'mock');
  if (payCfg.mode === 'mock' || !hasRealChannel) {
    logger.error(
      'config',
      '生产环境必须配置真实支付通道：请在管理后台将支付模式设置为 alipay/wechat/mixed 并填写完整密钥。' +
      '当前 payment_mode=mock 且无可用真实通道，拒绝启动以防止模拟支付绕过。'
    );
    process.exit(1);
  }
}

const app = express();

// trust proxy：正确获取反向代理后的客户端真实 IP（用于注册风控 / 速率限制）
// 生产部署在 Nginx/网关后时设置 TRUST_PROXY=1（信任一层代理）；直接暴露则保持默认
if (process.env.TRUST_PROXY) {
  const n = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isInteger(n) ? n : process.env.TRUST_PROXY === 'true');
}

// 安全头：CSP / X-Content-Type-Options / X-Frame-Options / HSTS 等
// CSP：限制脚本/样式/图片来源，防 XSS 注入执行（connect-src 允许同源 + https 以兼容 API 网关）
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https:'],
      // 前端 SPA 无需 frame/object，禁用增强安全
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS：限定白名单 origin，避免任意跨域读取
// 未配置时默认仅允许 localhost:5173（开发环境），而非允许所有源
const allowOrigins = (process.env.CORS_ALLOW_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // 仅允许白名单 origin；无 Origin 头的请求（同源/curl）也放行
    if (!origin || allowOrigins.includes(origin)) return cb(null, true);
    // 非白名单 origin：不放行 CORS（不返回 Access-Control-Allow-Origin），由浏览器拦截；
    // 不使用 cb(new Error(...))，避免落入全局错误处理器返回 500
    return cb(null, false);
  },
  // 允许携带 Cookie（refresh token 经 HttpOnly Cookie 下发），开发环境跨域时 refresh 请求需带凭据
  credentials: true,
}));

// 全局速率限制：每个 IP 每分钟最多 120 次请求（防暴力扫描/DoS）
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
  // 仅跳过支付异步回调（网关重试不应被限流）和健康检查；用户端点（下单/扫码）仍受限流保护
  skip: (req) =>
    req.path === '/api/payment/alipay/notify' ||
    req.path === '/api/payment/wechat/notify' ||
    req.path === '/api/health',
}));

// 支付宝异步回调使用 urlencoded 表单
app.use('/api/payment/alipay/notify', express.urlencoded({ extended: true, limit: '1mb' }));

// 全局 JSON 解析：通过 verify 钩子保留原始 body 字节流到 req.rawBody
// 微信支付回调验签需要原始字节流，JSON.stringify(req.body) 会因键序/转义不一致导致验签失败
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => {
    // 仅对 POST/PUT 请求保留 rawBody，避免 GET 也存一份浪费内存
    if (req.method === 'POST' || req.method === 'PUT') {
      req.rawBody = buf.toString('utf8');
    }
  },
}));

// 健康检查（不暴露服务名，防指纹识别）
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// 公开静态资源：客服微信二维码等前台需要展示的图片（仅公开 public 子目录，不含文档/模板等敏感文件）
const publicUploadsDir = join(__dirname, '..', 'uploads', 'public');
if (!fs.existsSync(publicUploadsDir)) fs.mkdirSync(publicUploadsDir, { recursive: true });
app.use('/uploads', express.static(publicUploadsDir));

app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/membership', membershipRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/references', referencesRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/docs', docsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/graduation', graduationRoutes);
app.use('/api/charts', chartsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);

// 全局错误处理中间件：统一错误格式，避免泄露堆栈
app.use((err, _req, res, _next) => {
  logger.error('unhandled', err.message);
  if (res.headersSent) return;
  const status = err.statusCode || 500;
  res.status(status).json({ error: status >= 500 ? '服务器内部错误' : err.message });
});

// 生产环境下托管前端静态文件
const clientDist = join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  logger.info('server', `ScholarForge server running at http://localhost:${PORT}`);
});

// 定时清理过期订单（每 5 分钟）
const intervalOrders = setInterval(() => {
  try {
    const n = closeExpiredOrders();
    if (n > 0) logger.info('cleanup', `closed ${n} expired orders`);
  } catch (err) {
    logger.error('cleanup', err.message);
  }
}, 5 * 60 * 1000);

// 定时清理过期任务（每 24 小时，清理 90 天前的任务记录）
const intervalTasks = setInterval(() => {
  try {
    const n = cleanupOldTasks();
    if (n > 0) logger.info('cleanup-tasks', `deleted ${n} expired tasks (>90d)`);
  } catch (err) {
    logger.error('cleanup-tasks', err.message);
  }
}, 24 * 60 * 60 * 1000);

// 定时清理过期文档（每 24 小时，按 doc_retention_days 配置清理磁盘文件+DB记录）
const intervalDocs = setInterval(() => {
  try {
    const n = cleanupOldDocs();
    if (n > 0) logger.info('cleanup-docs', `deleted ${n} expired docs`);
  } catch (err) {
    logger.error('cleanup-docs', err.message);
  }
}, 24 * 60 * 60 * 1000);

// 定时清理过期 token、文档、订单（每 6 小时综合清理）
const intervalCleanup = setInterval(() => {
  try {
    const r = cleanupStaleData(30);
    if (Object.values(r).some((v) => v > 0)) {
      logger.info('cleanup', '综合清理完成', r);
    }
  } catch (err) {
    logger.error('cleanup', '综合清理失败', err.message);
  }
}, 6 * 60 * 60 * 1000);

// 优雅关闭：收到终止信号时停止接受新连接，清理定时器，等待进行中请求完成
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown', `received ${signal}, closing gracefully...`);
  clearInterval(intervalOrders);
  clearInterval(intervalTasks);
  clearInterval(intervalDocs);
  clearInterval(intervalCleanup);
  server.close((err) => {
    if (err) {
      logger.error('shutdown', `server close error: ${err.message}`);
      process.exit(1);
    }
    logger.info('shutdown', 'server closed, exiting.');
    process.exit(0);
  });
  // 兜底：10 秒后强制退出，避免卡死
  setTimeout(() => {
    logger.error('shutdown', 'force exit after 10s timeout');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
