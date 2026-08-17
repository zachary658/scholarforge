// 课程路由：论文 1 对 1 指导等服务型商品 + 积分日志（兼容旧路径）
import { Router } from 'express';
import { authRequired } from '../middleware.js';
import db from '../db.js';
import { getPointsBalance } from '../services/billing.js';
import { getCourses, getCourse } from '../config-store.js';
import { computeCourseQuote } from '../services/course-quote.js';

const router = Router();

// 可购买课程列表（论文 1 对 1 指导，仅上架）
router.get('/', authRequired, (req, res) => {
  const courses = getCourses({ onlyActive: true });
  const purchased = new Set(
    db.prepare('SELECT course_id FROM user_courses WHERE user_id = ?').all(req.user.id).map((r) => r.course_id)
  );
  res.json({ courses: courses.map((c) => ({ ...c, purchased: purchased.has(c.id) })) });
});

// 课程定制报价：根据学历课程 + 需求（专业/字数/图表/图纸/公式/加急）计算价格
// 仅计算不落库，供前端实时展示；下单时后端会再次以相同规则权威计算
router.post('/quote', authRequired, (req, res) => {
  const { course_id, requirements } = req.body || {};
  const course = getCourse(parseInt(course_id, 10));
  if (!course || !course.is_active) return res.status(400).json({ error: '课程不存在或已下架' });
  try {
    const quote = computeCourseQuote(course, requirements);
    res.json({ course_id: course.id, title: course.title, degree: course.degree, ...quote });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// 我的已购课程
router.get('/my', authRequired, (req, res) => {
  const rows = db.prepare(
    `SELECT uc.id AS user_course_id, uc.purchased_at, uc.expires_at, uc.requirements, uc.contact_status,
            c.id, c.title, c.description, c.price, c.duration_text, c.validity_days, c.degree
     FROM user_courses uc
     JOIN courses c ON c.id = uc.course_id
     WHERE uc.user_id = ?
     ORDER BY uc.id DESC`
  ).all(req.user.id);
  const now = Math.floor(Date.now() / 1000);
  const courses = rows.map((r) => {
    let requirements = null;
    try { requirements = r.requirements ? JSON.parse(r.requirements) : null; } catch { requirements = null; }
    return {
      ...r,
      requirements,
      expired: r.expires_at != null && r.expires_at < now,
    };
  });
  res.json({ courses });
});

// 积分变动日志（供积分充值页面使用）
router.get('/log', authRequired, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const size = Math.min(100, Math.max(10, parseInt(req.query.size) || 20));
  const offset = (page - 1) * size;
  const total = db.prepare('SELECT COUNT(*) as c FROM points_log WHERE user_id = ?').get(req.user.id).c;
  const logs = db.prepare(
    'SELECT * FROM points_log WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
  ).all(req.user.id, size, offset);
  res.json({ logs, total, page, size, pages: Math.ceil(total / size) });
});

// 积分余额汇总（兼容旧 /courses/quota 路径）
router.get('/quota', authRequired, (req, res) => {
  const balance = getPointsBalance(req.user.id);
  res.json({ balance, points: balance, deprecated: true });
});

export default router;
