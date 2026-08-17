// 答辩 PPT 生成服务（基于 PptxGenJS）
// 生成可下载的 .pptx 文件，保存到 uploads/docs 目录，并在 generated_docs 表登记
import pptxgen from 'pptxgenjs';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', '..', 'uploads', 'docs');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

// 主题配色
const THEME = {
  primary: '1A3C5E',   // 深蓝
  accent: '2E86AB',    // 中蓝
  light: 'F5F7FA',     // 浅灰底
  textDark: '333333',
  textLight: 'FFFFFF',
  textMuted: 'CCCCCC',
  textNote: '888888',
};

// 将 AI 生成的答辩大纲文本解析为幻灯片数组
// 每页结构：{ title, bullets: string[], content: string[] }
// 支持「## 第N页 标题」「# N. 标题」「Slide N」「---」等分隔方式
export function parseOutlineToSlides(text) {
  if (!text || !text.trim()) return [];

  const lines = text.split(/\r?\n/);
  // 识别幻灯片起始标记：## 第N页 / # N. / Slide N / 幻灯片N 等
  const slideStartRe = /^(?:#{1,3}\s*)?(?:第\s*\d+\s*[页张]|幻灯片\s*\d+|Slide\s*\d+|slides?\s*\d+|#{1,3}\s*\d+[.、)]\s)/i;

  const blocks = [];
  let current = null;

  const pushBullet = (line) => {
    const m = line.match(/^[-•*]\s+(.*)$/);
    if (m) {
      current.bullets.push(stripMd(m[1]).trim());
    } else {
      current.content.push(stripMd(line));
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (slideStartRe.test(trimmed)) {
      if (current) blocks.push(current);
      const title = trimmed
        .replace(/^#{1,6}\s*/, '')
        .replace(/^(?:第\s*\d+\s*[页张]|幻灯片\s*\d+|Slide\s*\d+|slides?\s*\d+)\s*[:：\-—.]?\s*/i, '')
        .replace(/^\d+[.、)]\s*/, '')
        .trim();
      current = { title: stripMd(title) || '未命名幻灯片', bullets: [], content: [] };
    } else if (current) {
      if (!trimmed) { current.content.push(''); continue; }
      pushBullet(trimmed);
    }
  }
  if (current) blocks.push(current);

  // 兜底：未识别到分页标记时，按 "---" 或 ## 标题分割
  if (blocks.length === 0) {
    const chunks = text.split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean);
    for (const chunk of chunks) {
      const cl = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!cl.length) continue;
      const title = cl[0].replace(/^#{1,6}\s*/, '').replace(/^\d+[.、)]\s*/, '').trim();
      const bullets = [];
      const content = [];
      for (let i = 1; i < cl.length; i++) {
        const m = cl[i].match(/^[-•*]\s+(.*)$/);
        if (m) bullets.push(stripMd(m[1]).trim());
        else content.push(stripMd(cl[i]));
      }
      blocks.push({ title: stripMd(title) || '未命名幻灯片', bullets, content });
    }
  }

  // 过滤完全空的页
  return blocks.filter((b) => b.title || b.bullets.length || b.content.join('').trim().length);
}

// 去掉 markdown 加粗/斜体标记
function stripMd(s) {
  return String(s || '').replace(/\*\*/g, '').replace(/(?<!\*)\*(?!\*)/g, '');
}

// 生成 .pptx 并落盘，返回 { id, title, filePath, fileName, file_path, downloadUrl }
// 与 generateDocx 返回格式保持一致，前端可直接复用 doc.downloadUrl
export async function generatePptx({ title, slides, userId, orderId = null, feature = 'defense' }) {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE'; // 16:9
  pres.author = 'ScholarForge';
  pres.title = title || '答辩PPT';

  const slideList = Array.isArray(slides) ? slides : [];
  const safeTitle = stripMd(title || '答辩PPT');

  // 封面页
  const cover = pres.addSlide();
  cover.background = { color: THEME.primary };
  cover.addText(safeTitle, {
    x: 0.5, y: 1.9, w: 9, h: 1.5,
    fontSize: 36, color: THEME.textLight, bold: true, align: 'center',
  });
  cover.addText('答辩人 / 指导教师 / 院校', {
    x: 0.5, y: 3.5, w: 9, h: 0.8,
    fontSize: 18, color: THEME.textMuted, align: 'center',
  });

  // 内容页
  for (const s of slideList) {
    const slide = pres.addSlide();
    slide.background = { color: THEME.light };
    // 标题
    slide.addText(s.title || '未命名幻灯片', {
      x: 0.5, y: 0.3, w: 9, h: 0.8,
      fontSize: 28, color: THEME.primary, bold: true,
    });
    // 标题下分隔线
    slide.addShape(pres.ShapeType.line, {
      x: 0.5, y: 1.15, w: 9, h: 0,
      line: { color: THEME.accent, width: 2 },
    });

    const bullets = Array.isArray(s.bullets) ? s.bullets.filter(Boolean) : [];
    const contentLines = Array.isArray(s.content) ? s.content.filter(Boolean) : [];

    let yPos = 1.45;
    if (bullets.length) {
      const textArr = bullets.map((b, i) => ({
        text: b,
        options: { bullet: true, breakLine: i < bullets.length - 1 },
      }));
      const bulletHeight = Math.min(4, 0.4 * bullets.length + 0.5);
      slide.addText(textArr, {
        x: 0.7, y: yPos, w: 8.6, h: bulletHeight,
        fontSize: 18, color: THEME.textDark, lineSpacingMultiple: 1.25,
      });
      yPos += bulletHeight + 0.1;
    }

    // 补充正文（如演讲稿摘要）作为底部小字
    if (contentLines.length && yPos < 5) {
      const noteText = contentLines.join('\n').slice(0, 220);
      slide.addText(noteText, {
        x: 0.7, y: yPos, w: 8.6, h: Math.max(0.6, 5 - yPos),
        fontSize: 12, color: THEME.textNote, italic: true, valign: 'top',
      });
    }

    // 演讲稿作为演讲者备注
    if (contentLines.length) {
      slide.addNotes(contentLines.join('\n'));
    }
  }

  // 末页致谢
  const thanks = pres.addSlide();
  thanks.background = { color: THEME.primary };
  thanks.addText('谢谢聆听', {
    x: 0.5, y: 2.2, w: 9, h: 1.2,
    fontSize: 44, color: THEME.textLight, bold: true, align: 'center',
  });
  thanks.addText('恳请各位老师批评指正', {
    x: 0.5, y: 3.4, w: 9, h: 0.8,
    fontSize: 20, color: THEME.textMuted, align: 'center',
  });

  const ts = Date.now();
  const safeName = safeTitle.replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 30);
  const fileName = `${userId}_${ts}_${feature}_${safeName}.pptx`;
  const filePath = join(docsDir, fileName);
  await pres.writeFile({ fileName: filePath });

  // 落库
  const info = db.prepare(
    `INSERT INTO generated_docs (user_id, title, feature, file_path, order_id) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, safeTitle, feature, fileName, orderId || null);

  return {
    id: info.lastInsertRowid,
    title: safeTitle,
    filePath,
    fileName,
    file_path: fileName,
    downloadUrl: `/api/docs/download/${info.lastInsertRowid}`,
  };
}
