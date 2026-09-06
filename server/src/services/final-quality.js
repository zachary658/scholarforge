import { createHash } from 'node:crypto';

export function contentVersion(project) {
  return createHash('sha256').update(JSON.stringify([
    project.title, project.field, project.degree, project.writing_requirements, project.outline,
    project.sources, project.chapters,
  ])).digest('hex');
}

export function inspectPaper(project) {
  const chapters = project.chapters || [];
  const outline = project.outline || [];
  const refs = project.sources?.references || [];
  const checks = [];
  const add = (key, pass, detail) => checks.push({ key, status: pass ? 'pass' : 'fail', detail });
  add('chapter_complete', outline.length > 0 && chapters.length === outline.length
    && chapters.every(c => c.status === 'done' && String(c.content || '').trim()), '所有大纲章节须有完整正文');
  add('chapter_confirmed', chapters.length > 0 && chapters.every(c => c.confirmed === true), '所有章节须经用户确认');
  add('outline_consistency', chapters.length === outline.length && chapters.every((c, i) =>
    c.chapter === (outline[i]?.chapter || outline[i]?.title)), '章名及顺序须与已确认大纲一致');
  add('references_present', refs.length >= 3, '至少需要 3 篇已确认文献');
  const bodies = chapters.map(c => String(c.content || '').trim());
  const paragraphs = bodies.flatMap(b => b.split(/\n\s*\n/)).map(p => p.trim()).filter(p => p.length > 200);
  add('duplicate_paragraphs', new Set(paragraphs).size === paragraphs.length, '长段落不得完全重复');
  const cited = new Set();
  const invalid = [];
  for (const body of bodies) {
    for (const m of body.matchAll(/\[(\d[\d\s,，\-–]*)\]/g)) {
      for (const part of m[1].split(/[,，]/)) {
        const match = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
        const start = Number(match?.[1]);
        const end = Number(match?.[2] || match?.[1]);
        if (!match || start < 1 || end < start || end > refs.length) { invalid.push(m[0]); continue; }
        for (let n = start; n <= end; n++) cited.add(n);
      }
    }
  }
  add('citation_range', invalid.length === 0, invalid.length ? `无效引文：${[...new Set(invalid)].join('、')}` : '引文编号及范围有效');
  add('citation_present', cited.size > 0, '正文须实际引用已确认文献');
  add('bibliography_owned', !bodies.some(b => /^\s*#{0,6}\s*(?:(?:主要)?参考文献|references|bibliography)\s*$/im.test(b)), '参考文献列表由系统从核验记录统一编排，不接受模型自写列表');
  add('unresolved_placeholders', !/\[(?:CITE|CHART|EVIDENCE):|本章内容待生成|示例数据[，,]?请替换|数据待补充|待填入/.test(bodies.join('\n')), '不得残留未解析引文、图表或正文占位符');
  checks.push({ key: 'uncited_references', status: cited.size === refs.length ? 'pass' : 'warn', detail: `未引用文献 ${Math.max(0, refs.length - cited.size)} 篇` });
  return { passed: checks.every(c => c.status !== 'fail'), checks, contentVersion: contentVersion(project), generatedAt: Math.floor(Date.now() / 1000) };
}
