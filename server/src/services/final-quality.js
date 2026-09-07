import { createHash } from 'node:crypto';
import { isForeignReference } from './reference-policy.js';

const AUTO_FIXABLE = new Set([
  'outline_consistency',
  'duplicate_paragraphs',
  'citation_range',
  'citation_present',
  'bibliography_owned',
  'unresolved_placeholders',
  'word_count',
  'section_structure',
  'logic_coherence',
  'references_present',
  'foreign_references',
]);

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function excerpt(value, max = 180) {
  const text = normalizeText(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function chapterLocation(chapter, chapterIndex, extra = {}) {
  return {
    scope: 'chapter',
    chapterIndex,
    chapterId: chapter?.id || null,
    chapter: chapter?.chapter || `第 ${chapterIndex + 1} 章`,
    ...extra,
  };
}

function check(key, status, detail, locations = [], suggestion = '') {
  return {
    key,
    status,
    detail,
    locations,
    suggestion,
    autoFixable: status !== 'pass' && AUTO_FIXABLE.has(key),
  };
}

export function countAcademicWords(content) {
  const text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[(?:\d[\d\s,，\-–—]*|CITE:[^\]]+)\]/g, ' ')
    .replace(/[|*_`>#]/g, ' ');
  const chineseCharacters = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latinWords = (text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  return chineseCharacters + latinWords;
}

export function resolveTargetWordCount(project) {
  const requirements = String(project?.writing_requirements || '');
  const matches = [...requirements.matchAll(/(?:不少于|不低于|至少|约|目标|总字数)?\s*(\d+(?:\.\d+)?)\s*(万|千)?\s*字/gi)];
  if (matches.length) {
    const values = matches.map((match) => {
      const multiplier = match[2] === '万' ? 10000 : match[2] === '千' ? 1000 : 1;
      return Math.round(Number(match[1]) * multiplier);
    }).filter((value) => Number.isFinite(value) && value > 0);
    if (values.length) return Math.max(...values);
  }
  const degree = String(project?.degree || '');
  if (/博士/.test(degree)) return 50000;
  if (/硕士/.test(degree)) return 20000;
  if (/本科/.test(degree)) return 8000;
  return 0;
}

function normalizeHeading(value) {
  return String(value || '').replace(/^\s*(?:第?[一二三四五六七八九十百\d]+[章节篇、.．]?|\d+(?:\.\d+)*[、.．]?)\s*/, '').replace(/\s+/g, '').toLowerCase();
}

export function contentVersion(project) {
  const payload = JSON.stringify({
    title: project?.title || '',
    field: project?.field || '',
    degree: project?.degree || '',
    writingRequirements: project?.writing_requirements || '',
    outline: project?.outline || [],
    chapters: project?.chapters || [],
    sources: project?.sources || {},
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function inspectPaper(project) {
  const outline = Array.isArray(project?.outline) ? project.outline : [];
  const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
  const references = Array.isArray(project?.sources?.references) ? project.sources.references : [];
  const bodies = chapters.map((item) => String(item?.content || ''));
  const allText = bodies.join('\n\n');
  const checks = [];

  const incomplete = chapters
    .map((chapter, index) => ({ chapter, index }))
    .filter(({ chapter }) => chapter?.status !== 'done' || !String(chapter?.content || '').trim());
  checks.push(check(
    'chapter_complete',
    chapters.length > 0 && incomplete.length === 0 ? 'pass' : 'fail',
    chapters.length > 0 && incomplete.length === 0 ? '全部章节均已生成。' : `有 ${Math.max(incomplete.length, outline.length - chapters.length)} 个章节尚未生成正文。`,
    incomplete.map(({ chapter, index }) => chapterLocation(chapter, index)),
    '请返回章节生成步骤补齐缺失章节。',
  ));

  const unconfirmed = chapters
    .map((chapter, index) => ({ chapter, index }))
    .filter(({ chapter }) => !chapter?.confirmed && !chapter?.confirmed_at);
  checks.push(check(
    'chapter_confirmed',
    chapters.length > 0 && unconfirmed.length === 0 ? 'pass' : 'fail',
    chapters.length > 0 && unconfirmed.length === 0 ? '全部章节均已确认。' : `有 ${unconfirmed.length} 个章节尚未由用户确认。`,
    unconfirmed.map(({ chapter, index }) => chapterLocation(chapter, index)),
    '请逐章审阅并确认；系统不会代替用户确认。',
  ));

  const outlineMismatches = chapters
    .map((chapter, index) => ({ chapter, index, expected: outline[index]?.chapter || '' }))
    .filter(({ chapter, expected }) => expected && chapter?.chapter !== expected);
  const outlineLocations = outlineMismatches.map(({ chapter, index, expected }) => chapterLocation(chapter, index, {
    excerpt: `当前标题：${chapter?.chapter || '未命名'}`,
    expected,
  }));
  if (chapters.length !== outline.length) {
    outlineLocations.unshift({
      scope: 'outline',
      excerpt: `大纲 ${outline.length} 章，正文 ${chapters.length} 章`,
    });
  }
  const outlineMatches = outline.length > 0
    && chapters.length === outline.length
    && outlineMismatches.length === 0;
  const outlineCheck = check(
    'outline_consistency',
    outlineMatches ? 'pass' : 'fail',
    outlineMatches ? '章节数量与标题均和已确认大纲一致。' : '正文的章节数量或标题与已确认大纲不一致。',
    outlineLocations,
    chapters.length === outline.length ? '可一键将正文标题对齐到已确认大纲。' : '请先补齐或删除多余章节，再重新检查。',
  );
  outlineCheck.autoFixable = !outlineMatches && chapters.length === outline.length;
  checks.push(outlineCheck);

  checks.push(check(
    'references_present',
    references.length >= 10 ? 'pass' : 'fail',
    references.length >= 10 ? `已绑定 ${references.length} 篇真实来源。` : `仅绑定 ${references.length} 篇真实来源，交付要求不少于 10 篇。`,
    references.length >= 10 ? [] : [{ scope: 'references', excerpt: `当前 ${references.length} 篇，还需 ${10 - references.length} 篇。` }],
    '一键纠错会按论文主题从公开学术数据库自动检索并补足，不会由模型编造。',
  ));

  const foreignReferences = references.filter(isForeignReference);
  checks.push(check(
    'foreign_references',
    foreignReferences.length >= 3 ? 'pass' : 'fail',
    foreignReferences.length >= 3 ? `已包含 ${foreignReferences.length} 篇外文文献。` : `当前仅有 ${foreignReferences.length} 篇外文文献，交付要求至少 3 篇。`,
    foreignReferences.length >= 3 ? [] : [{ scope: 'references', excerpt: `还需补充 ${3 - foreignReferences.length} 篇与主题相关的外文文献。` }],
    '系统会优先从公开学术数据库补充可核验的外文文献。',
  ));

  const targetWords = resolveTargetWordCount(project);
  const actualWords = countAcademicWords(allText);
  const wordLocations = [];
  if (targetWords > 0 && actualWords < targetWords) {
    const expectedPerChapter = Math.ceil(targetWords / Math.max(1, chapters.length));
    chapters.forEach((chapter, chapterIndex) => {
      const count = countAcademicWords(chapter?.content);
      if (count < expectedPerChapter * 0.75) {
        wordLocations.push(chapterLocation(chapter, chapterIndex, {
          excerpt: `当前约 ${count} 字，建议补充至约 ${expectedPerChapter} 字。`,
          targetWords: expectedPerChapter,
          actualWords: count,
        }));
      }
    });
  }
  checks.push(check(
    'word_count',
    targetWords === 0 || actualWords >= targetWords ? 'pass' : 'fail',
    targetWords === 0 ? `未设置明确字数要求，当前正文约 ${actualWords} 字。` : actualWords >= targetWords ? `正文约 ${actualWords} 字，达到 ${targetWords} 字要求。` : `正文约 ${actualWords} 字，距离 ${targetWords} 字要求还差约 ${targetWords - actualWords} 字。`,
    wordLocations.length ? wordLocations : (targetWords > actualWords ? [{ scope: 'paper', excerpt: `当前约 ${actualWords} 字，目标 ${targetWords} 字。`, targetWords, actualWords }] : []),
    targetWords > actualWords ? '可一键按现有大纲和真实文献补充论证，不会用重复段落机械凑字数。' : '',
  ));

  const missingSections = [];
  chapters.forEach((chapter, chapterIndex) => {
    const structuralLines = String(chapter?.content || '').split('\n')
      .map((line) => line.replace(/^\s*#{1,6}\s*/, '').trim())
      .filter((line) => line && line.length <= 160)
      .map(normalizeHeading);
    for (const section of outline[chapterIndex]?.sections || []) {
      const title = normalizeHeading(section?.title || section);
      if (title && !structuralLines.some((line) => line === title || line.startsWith(title))) {
        missingSections.push(chapterLocation(chapter, chapterIndex, {
          expected: section?.title || section,
          excerpt: `正文中未识别到大纲小节“${section?.title || section}”。`,
        }));
      }
    }
  });
  checks.push(check(
    'section_structure',
    missingSections.length === 0 ? 'pass' : 'fail',
    missingSections.length === 0 ? '正文已覆盖已确认大纲中的全部小节。' : `正文缺少或未明确呈现 ${missingSections.length} 个已确认大纲小节。`,
    missingSections,
    '可一键按已确认大纲补齐缺失小节，并保持现有章节内容。',
  ));

  const paragraphs = [];
  chapters.forEach((chapter, chapterIndex) => {
    String(chapter?.content || '').split(/\n\s*\n/).forEach((paragraph, paragraphIndex) => {
      const normalized = normalizeText(paragraph);
      if (normalized.length > 200) {
        paragraphs.push({ normalized, paragraph, paragraphIndex, chapter, chapterIndex });
      }
    });
  });
  const seen = new Map();
  const duplicateLocations = [];
  for (const item of paragraphs) {
    const first = seen.get(item.normalized);
    if (!first) {
      seen.set(item.normalized, item);
      continue;
    }
    duplicateLocations.push(chapterLocation(item.chapter, item.chapterIndex, {
      paragraphIndex: item.paragraphIndex,
      excerpt: excerpt(item.paragraph),
      duplicateOf: {
        chapterIndex: first.chapterIndex,
        chapter: first.chapter?.chapter || `第 ${first.chapterIndex + 1} 章`,
        paragraphIndex: first.paragraphIndex,
      },
    }));
  }
  checks.push(check(
    'duplicate_paragraphs',
    duplicateLocations.length === 0 ? 'pass' : 'fail',
    duplicateLocations.length === 0 ? '未发现跨章节大段重复。' : `发现 ${duplicateLocations.length} 处跨章节大段重复。`,
    duplicateLocations,
    '可一键保留首次出现的段落并移除后续完全重复内容。',
  ));

  const citationPattern = /\[(\d[\d\s,，\-–—]*)\]/g;
  const invalidCitations = [];
  const cited = new Set();
  chapters.forEach((chapter, chapterIndex) => {
    const body = String(chapter?.content || '');
    for (const match of body.matchAll(citationPattern)) {
      let validMarker = true;
      for (const part of match[1].split(/[,，]/)) {
        const range = part.trim().match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
        const start = Number(range?.[1]);
        const end = Number(range?.[2] || range?.[1]);
        if (!range || start < 1 || end < start || end > references.length) {
          validMarker = false;
          continue;
        }
        for (let number = start; number <= end; number += 1) cited.add(number);
      }
      if (!validMarker) {
        invalidCitations.push(chapterLocation(chapter, chapterIndex, {
          marker: match[0],
          excerpt: excerpt(body.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80)),
        }));
      }
    }
  });
  checks.push(check(
    'citation_range',
    invalidCitations.length === 0 ? 'pass' : 'fail',
    invalidCitations.length === 0 ? '正文引用编号均在真实来源范围内。' : `发现 ${invalidCitations.length} 个超出来源范围的引用编号。`,
    invalidCitations,
    '可一键根据已有真实来源改写相关论述并修正引用编号。',
  ));

  checks.push(check(
    'citation_present',
    cited.size > 0 ? 'pass' : 'fail',
    cited.size > 0 ? `正文已使用 ${cited.size} 个来源编号。` : '正文没有发现形如 [1] 的来源引用。',
    cited.size > 0 ? [] : [{ scope: 'paper', excerpt: '全文未发现数字型引文标记。' }],
    '可一键基于已绑定真实来源补充必要引用；不会创建不存在的文献。',
  ));

  const bibliographyPattern = /(?:^|\n)\s{0,3}#{0,6}\s*(?:(?:主要)?参考文献|references|bibliography)\s*[:：]?\s*(?:\n|$)/i;
  const bibliographyLocations = chapters.flatMap((chapter, chapterIndex) => {
    const body = String(chapter?.content || '');
    const match = bibliographyPattern.exec(body);
    return match ? [chapterLocation(chapter, chapterIndex, {
      excerpt: excerpt(body.slice(match.index, match.index + 240)),
    })] : [];
  });
  checks.push(check(
    'bibliography_owned',
    bibliographyLocations.length === 0 ? 'pass' : 'fail',
    bibliographyLocations.length === 0 ? '章节中未发现模型自行编造的参考文献列表。' : `有 ${bibliographyLocations.length} 个章节包含自行生成的参考文献列表。`,
    bibliographyLocations,
    '可一键删除章节内的参考文献列表，最终文献表将仅由真实来源库生成。',
  ));

  const placeholderPattern = /(\[(?:CITE|CHART|EVIDENCE):[^\]]+\]|本章内容待生成|示例数据[，,]?请替换|（?数据待补充）?|待补充数据|待填入|TODO|TBD|待核实)/gi;
  const placeholderLocations = [];
  chapters.forEach((chapter, chapterIndex) => {
    const body = String(chapter?.content || '');
    for (const match of body.matchAll(placeholderPattern)) {
      placeholderLocations.push(chapterLocation(chapter, chapterIndex, {
        marker: match[0],
        excerpt: excerpt(body.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80)),
      }));
    }
  });
  checks.push(check(
    'unresolved_placeholders',
    placeholderLocations.length === 0 ? 'pass' : 'fail',
    placeholderLocations.length === 0 ? '未发现待补充占位符。' : `发现 ${placeholderLocations.length} 个尚未解决的占位符。`,
    placeholderLocations,
    '可一键删除无证据的断言，或用已有真实来源支持的内容改写。',
  ));

  const unusedReferences = references
    .map((reference, index) => ({ reference, number: index + 1 }))
    .filter(({ number }) => !cited.has(number));
  checks.push(check(
    'uncited_references',
    unusedReferences.length === 0 ? 'pass' : 'warn',
    unusedReferences.length === 0 ? '全部来源均在正文中被引用。' : `有 ${unusedReferences.length} 篇来源未在正文中引用。`,
    unusedReferences.slice(0, 20).map(({ reference, number }) => ({
      scope: 'reference',
      referenceNumber: number,
      excerpt: excerpt(reference?.title || reference?.doi || reference?.url || `来源 ${number}`),
    })),
    '建议删除无关来源，或在确有论据对应时补充引用。',
  ));

  const failed = checks.filter((item) => item.status === 'fail').length;
  const warnings = checks.filter((item) => item.status === 'warn').length;
  return {
    passed: failed === 0,
    checks,
    summary: {
      failed,
      warnings,
      autoFixable: checks.filter((item) => item.status === 'fail' && item.autoFixable).length,
    },
    checkedAt: new Date().toISOString(),
    generatedAt: Math.floor(Date.now() / 1000),
    contentVersion: contentVersion(project),
  };
}
