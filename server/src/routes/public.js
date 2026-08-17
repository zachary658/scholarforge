import { Router } from 'express';
import { authRequired } from '../middleware.js';
import { getPublicSiteInfo } from '../config-store.js';
import { getPointsStatus } from '../services/billing.js';

const router = Router();

// 公开：站点信息 + 功能定价 + 积分套餐（无需登录）
router.get('/site', (_req, res) => {
  res.json(getPublicSiteInfo());
});

// 当前用户积分状态（需登录）
router.get('/status', authRequired, (req, res) => {
  const status = getPointsStatus(req.user.id);
  res.json(status);
});

export default router;
