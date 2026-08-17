import { Router } from 'express';
import { authRequired } from '../middleware.js';
import { getFeaturePrices, getPointsPackages, getAvailableChannels, getCourses } from '../config-store.js';
import { getPointsStatus } from '../services/billing.js';

const router = Router();

// 公开：功能定价列表（无需登录）
router.get('/features', (_req, res) => {
  res.json({ features: getFeaturePrices({ onlyActive: true }) });
});

// 公开：积分充值套餐列表
router.get('/points-packages', (_req, res) => {
  res.json({ packages: getPointsPackages({ onlyActive: true }) });
});

// 公开：可用支付通道
router.get('/channels', (_req, res) => {
  res.json({ channels: getAvailableChannels() });
});

// 公开：课程列表（论文 1 对 1 指导，无需登录）
router.get('/courses', (_req, res) => {
  res.json({ courses: getCourses({ onlyActive: true }) });
});

// 兼容旧路径 /membership/plans → 返回空（已废弃）
router.get('/plans', (_req, res) => {
  res.json({ plans: [], deprecated: true });
});

// 当前用户积分状态
router.get('/status', authRequired, (req, res) => {
  const status = getPointsStatus(req.user.id);
  res.json(status);
});

export default router;
