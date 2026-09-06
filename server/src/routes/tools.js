// AI 工具路由聚合：按领域拆分为 writing / research / document / utility 子路由（./tools/ 目录），
// 共享内核（计费执行、材料注入、统一文档生成器）在 ./tools/core.js。
// 统一 POST 限流在此挂载，覆盖全部子路由的写操作。
import { Router } from 'express';
import { aiToolLimiter } from '../middleware/rateLimit.js';
import writingRoutes from './tools/writing.js';
import researchRoutes from './tools/research.js';
import documentRoutes from './tools/document.js';
import utilityRoutes from './tools/utility.js';

const router = Router();

// AI 工具统一限流：每用户每分钟最多 60 次（覆盖全部 /tools 写操作，防大模型成本被批量刷，M-2）
router.use((req, res, next) => {
  if (req.method === 'POST') return aiToolLimiter(req, res, next);
  next();
});

router.use(writingRoutes);
router.use(researchRoutes);
router.use(documentRoutes);
router.use(utilityRoutes);

// 兼容既有引用：tasks.js 复用计费执行内核
export { executeWithBilling } from './tools/core.js';

export default router;
