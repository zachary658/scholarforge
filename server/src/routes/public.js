import { Router } from 'express';
import { getPublicSiteInfo } from '../config-store.js';

const router = Router();

// 公开：站点信息 + 功能定价（无需登录）
router.get('/site', (_req, res) => {
  res.json(getPublicSiteInfo());
});

export default router;
