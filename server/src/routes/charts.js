// 数据图表（阶段三 3.4）
// - 上传 Excel/CSV 解析字段
// - 选择 X/Y/图表类型 → 调用 chart-renderer 渲染学术风格 PNG
// - 下载图表 / 一键插入到正在撰写的论文章节
import { Router } from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { parse as parseCsv } from 'csv-parse/sync';
import { authRequired } from '../middleware.js';
import db from '../db.js';
import { renderChart } from '../services/chart-renderer.js';
import { editChapter } from '../services/chapter-service.js';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const chartsDir = join(__dirname, '..', '..', 'uploads', 'charts');
if (!fs.existsSync(chartsDir)) fs.mkdirSync(chartsDir, { recursive: true });

const router = Router();
router.use(authRequired);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// 图表类型 → vega-lite mark
const MARK_MAP = {
  bar: 'bar',
  line: 'line',
  pie: 'arc',
  scatter: 'point',
};

// 从文件解析字段与数据
function parseFile(buffer, originalname) {
  const ext = (originalname || '').split('.').pop().toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return { columns, rows };
  }
  if (ext === 'csv') {
    const text = buffer.toString('utf8');
    const rows = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true });
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return { columns, rows };
  }
  throw new Error('仅支持 .xlsx / .xls / .csv 文件');
}

// 上传并解析
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  try {
    const { columns, rows } = parseFile(req.file.buffer, req.file.originalname);
    if (columns.length === 0) return res.status(400).json({ error: '文件为空或缺少表头' });
    res.json({ columns, rows: rows.slice(0, 100), total: rows.length });
  } catch (err) {
    res.status(400).json({ error: '解析失败：' + err.message });
  }
});

// 渲染图表并保存 PNG
router.post('/render', async (req, res) => {
  const { title, chart_type, x, y, rows } = req.body || {};
  if (!['bar', 'line', 'pie', 'scatter'].includes(chart_type)) return res.status(400).json({ error: '不支持的图表类型' });
  if (!x || !y) return res.status(400).json({ error: '请选择 X 轴和 Y 轴字段' });
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: '缺少图表数据' });
  // 行数/字段数上限：防客户端 POST 超大 rows 拖垮 vega 渲染并膨胀 spec_json 落库
  if (rows.length > 500) return res.status(400).json({ error: '图表数据最多 500 行' });
  if (x.length > 100 || y.length > 100) return res.status(400).json({ error: '字段名过长' });
  for (const r of rows.slice(0, 5)) {
    if (r && typeof r === 'object' && Object.keys(r).length > 50) {
      return res.status(400).json({ error: '数据字段过多，请精简后重试' });
    }
  }

  try {
    const numericRows = rows.map((r) => ({ ...r, [y]: Number(r[y]) })).filter((r) => Number.isFinite(r[y]));
    if (numericRows.length === 0) return res.status(400).json({ error: 'Y 轴字段必须为数值' });

    const spec = buildSpec(chart_type, x, y, numericRows, title);

    const { png, width, height } = await renderChart(spec);
    const info = db.prepare(
      `INSERT INTO charts (user_id, title, chart_type, file_path, spec_json) VALUES (?, ?, ?, ?, ?)`
    ).run(req.user.id, title || '图表', chart_type, '', JSON.stringify(spec));
    const id = info.lastInsertRowid;
    const fileName = `${id}.png`;
    fs.writeFileSync(join(chartsDir, fileName), png);
    db.prepare('UPDATE charts SET file_path = ? WHERE id = ?').run(fileName, id);

    res.json({
      chart: {
        id,
        title: title || '图表',
        chart_type,
        width,
        height,
        file_url: `/api/charts/${id}/file`,
        spec,
      },
    });
  } catch (err) {
    logger.error('charts', `渲染失败: ${err.message}`);
    res.status(500).json({ error: '图表生成失败：' + err.message });
  }
});

// 构建 vega-lite 规范
function buildSpec(chart_type, x, y, rows, title) {
  const base = {
    data: { values: rows },
    mark: MARK_MAP[chart_type],
    title: title || `${x} 与 ${y} 关系图`,
    encoding: {},
  };
  if (chart_type === 'pie') {
    base.encoding = {
      theta: { field: y, type: 'quantitative' },
      color: { field: x, type: 'nominal' },
    };
  } else if (chart_type === 'scatter') {
    base.encoding = {
      x: { field: x, type: 'quantitative', title: x },
      y: { field: y, type: 'quantitative', title: y },
    };
  } else {
    base.encoding = {
      x: { field: x, type: 'nominal', title: x, axis: { labelAngle: -30 } },
      y: { field: y, type: 'quantitative', title: y },
    };
  }
  return base;
}

// 我的图表列表
router.get('/', (req, res) => {
  const charts = db.prepare('SELECT id, title, chart_type, file_path, created_at FROM charts WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json({ charts: charts.map((c) => ({ ...c, file_url: `/api/charts/${c.id}/file` })) });
});

// 下载 PNG
router.get('/:id/file', (req, res) => {
  const chart = db.prepare('SELECT * FROM charts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!chart || !chart.file_path) return res.status(404).json({ error: '图表不存在' });
  // 纵深防御：file_path 由服务端生成（<id>.png），此处仍校验防路径遍历（与 docs.js 的 safeFilePath 一致）
  const fp = String(chart.file_path);
  if (fp.includes('..') || fp.includes('\0') || fp.includes('/') || fp.includes('\\') || !/^[\w.-]+$/.test(fp)) {
    return res.status(400).json({ error: '文件路径非法' });
  }
  res.sendFile(join(chartsDir, fp));
});

// 一键插入到正在撰写的论文章节
router.post('/:id/insert', (req, res) => {
  const { projectId, chapterId } = req.body || {};
  if (!projectId || !chapterId) return res.status(400).json({ error: '请指定目标论文章节' });
  const chart = db.prepare('SELECT * FROM charts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!chart) return res.status(404).json({ error: '图表不存在' });
  try {
    const proj = db.prepare('SELECT chapters_json FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
    let chapters = [];
    try { chapters = JSON.parse(proj?.chapters_json || '[]'); } catch {}
    const chapter = chapters.find((c) => c.id === chapterId);
    // 以 vega 代码块形式插入，docx-generator 会渲染为高清图片
    const block = `\n\n图：${chart.title || '数据图表'}\n\n\`\`\`vega\n${chart.spec_json || '{}'}\n\`\`\`\n`;
    const result = editChapter(req.user.id, Number(projectId), chapterId, (chapter?.content || '') + block);
    res.json({ ok: true, chapter: result.chapter });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
