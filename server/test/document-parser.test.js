// 学术文档统一解析层单元测试
// 全部离线可跑：不依赖真实网络、真实 Docling/GROBID/MinerU 服务。
// 外部通道通过打桩 globalThis.fetch + env 注入来模拟（打桩均在 t.after() 中还原）。
//
// 说明：import 链会经由 paper-distillation → db.js 打开 SQLite，
// 因此必须在 import 业务模块前设置 DB_PATH 指向临时目录（与 paper-distillation.test.js 一致）
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-docparser-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const {
  detectLanguage,
  parseDocument,
  blocksToEvidenceSources,
  estimateParseQuality,
  resolveParserOrder,
  isMinerUEnabled,
  isDoclingEnabled,
  isGrobidEnabled,
} = await import('../src/services/document-parser.js');
const { parseGrobidTei } = await import('../src/services/grobid-client.js');
const { parseDoclingDocument } = await import('../src/services/docling-client.js');

// ===== 测试夹具与工具 =====

// 会被打桩/还原的环境变量清单
const ENV_KEYS = [
  'MINERU_API_URL', 'MINERU_TIMEOUT',
  'DOCLING_API_URL', 'DOCLING_TIMEOUT_MS', 'DOCLING_API_KEY',
  'GROBID_URL', 'GROBID_TIMEOUT_MS', 'GROBID_CONSOLIDATE',
  'DOC_PARSER_PREFER',
];

// 在测试内临时设置 env，t.after 中完整还原（含"原本不存在"的情况）
function withEnv(t, values = {}) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, values);
  t.after(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

// 构造一个最小可用的单页/多页 PDF（标准 14 号字体 Helvetica，pdfjs 可直接取到文本）。
// 手写 PDF 而非引入二进制 fixture：保证测试零外部资源、可自解释。
function buildPdf(pageTexts) {
  const n = pageTexts.length;
  const pageIds = Array.from({ length: n }, (_, i) => 3 + i);
  const contentIds = Array.from({ length: n }, (_, i) => 3 + n + i);
  const fontId = 3 + 2 * n;
  const escape = (s) => String(s).replace(/([\\()])/g, '\\$1');

  const objs = new Map();
  objs.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objs.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`);
  pageIds.forEach((pid, i) => {
    objs.set(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[i]} 0 R `
      + `/Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
  });
  contentIds.forEach((cid, i) => {
    const stream = `BT /F1 12 Tf 72 700 Td (${escape(pageTexts[i])}) Tj ET`;
    objs.set(cid, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objs.set(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id <= fontId; id++) {
    offsets.push(pdf.length);
    pdf += `${id} 0 obj\n${objs.get(id)}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const PDF_2PAGES = buildPdf(['Hello ScholarForge parser', 'Second page content here']);

function makeResponse(body, { status = 200 } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => text,
  };
}

// 打桩 globalThis.fetch，并记录所有请求 URL；t.after 中还原
// router(url, init) → 返回 response，或返回 null 表示拒绝该请求（视为未预期请求）
function stubFetch(t, router) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    const resp = router(String(url), init);
    if (!resp) throw new Error(`未预期的出站请求: ${url}`);
    return resp;
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

// ===== GROBID 夹具：手写最小 TEI XML（结构与 GROBID 实际输出一致） =====
const GROBID_TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>A Study of Document Parsing</title></titleStmt>
      <sourceDesc>
        <biblStruct>
          <analytic>
            <title type="main">A Study of Document Parsing</title>
            <author><persName><forename type="first">Jane</forename><surname>Doe</surname></persName></author>
            <author><persName><forename type="first">Bo</forename><surname>Li</surname></persName></author>
            <idno type="DOI">10.1000/main</idno>
          </analytic>
          <monogr>
            <title level="j">Journal of Parsing</title>
            <imprint><date type="published" when="2021-03-04"/></imprint>
          </monogr>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
    <profileDesc><abstract><p>We study document parsing.</p></abstract></profileDesc>
  </teiHeader>
  <text xml:lang="en">
    <body>
      <div>
        <head coords="1,10,20,30,5">Introduction</head>
        <p coords="1,10,40,300,10">Prior work built a baseline <ref type="bibr" target="#b0" coords="1,50,40,8,8">[1]</ref>.</p>
        <div>
          <head coords="2,10,20,30,5">Sub Topic</head>
          <p coords="2,10,40,300,10">Deeper discussion follows.</p>
        </div>
      </div>
      <div>
        <head coords="3,10,20,30,5">Methods</head>
        <p coords="3,10,40,300,10">We reused a model from <ref type="bibr" target="#b1" coords="3,50,40,8,8">[2]</ref>.</p>
      </div>
    </body>
    <back>
      <div type="references">
        <listBibl>
          <biblStruct xml:id="b0" coords="9,10,20,300,10">
            <analytic>
              <title type="main">Baseline Paper</title>
              <author><persName><forename type="first">Ann</forename><surname>Lee</surname></persName></author>
              <editor><persName><forename type="first">Ed</forename><surname>Itor</surname></persName></editor>
            </analytic>
            <monogr><title level="j">Old Journal</title><imprint><date type="published" when="2015-01-02"/></imprint></monogr>
            <idno type="DOI">10.5555/baseline</idno>
            <note type="raw_reference">Lee A. Baseline Paper. Old Journal. 2015.</note>
          </biblStruct>
          <biblStruct xml:id="b1">
            <analytic><title type="main">Model Paper</title></analytic>
            <monogr><title level="j">NeurIPS</title><imprint><date type="published" when="2019"/></imprint></monogr>
            <idno type="DOI">10.5555/model</idno>
          </biblStruct>
        </listBibl>
      </div>
    </back>
  </text>
</TEI>`;

// ===== Docling 夹具：按已核实的 DoclingDocument schema 构造 =====
function buildDoclingJson() {
  return {
    schema_name: 'DoclingDocument',
    version: '1.3.0',
    name: 'Docling Test Paper',
    body: {
      children: [
        { $ref: '#/texts/0' },
        { $ref: '#/texts/1' },
        { $ref: '#/texts/2' },
        { $ref: '#/texts/3' },
        { $ref: '#/texts/4' },
        { $ref: '#/tables/0' },
        { $ref: '#/texts/5' },
      ],
    },
    texts: [
      { self_ref: '#/texts/0', label: 'title', text: 'Docling Test Paper', prov: [{ page_no: 1 }] },
      { self_ref: '#/texts/1', label: 'section_header', text: 'Introduction', level: 1, prov: [{ page_no: 1 }] },
      { self_ref: '#/texts/2', label: 'text', text: 'We present a parsing method.', prov: [{ page_no: 1 }] },
      { self_ref: '#/texts/3', label: 'section_header', text: 'Results', level: 1, prov: [{ page_no: 2 }] },
      { self_ref: '#/texts/4', label: 'text', text: 'Our results are strong.', prov: [{ page_no: 2 }] },
      { self_ref: '#/texts/5', label: 'page_footer', text: '1', prov: [{ page_no: 1 }] },
    ],
    tables: [
      {
        self_ref: '#/tables/0',
        label: 'table',
        prov: [{ page_no: 2 }],
        data: {
          num_rows: 3,
          num_cols: 2,
          table_cells: [
            { text: 'Model', start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 0, end_col_offset_idx: 1, column_header: true },
            { text: 'Acc', start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 1, end_col_offset_idx: 2, column_header: true },
            { text: 'Ours', start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 0, end_col_offset_idx: 1 },
            { text: '92.3', start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 1, end_col_offset_idx: 2 },
            { text: 'Base', start_row_offset_idx: 2, end_row_offset_idx: 3, start_col_offset_idx: 0, end_col_offset_idx: 1 },
            { text: '85.1', start_row_offset_idx: 2, end_row_offset_idx: 3, start_col_offset_idx: 1, end_col_offset_idx: 2 },
          ],
        },
      },
    ],
  };
}

function doclingEnvelope() {
  return {
    document: {
      md_content: '# Docling Test Paper\n\n## Introduction\n\nWe present a parsing method.',
      json_content: buildDoclingJson(),
    },
    status: 'success',
    processing_time: 1.2,
    timings: {},
    errors: [],
  };
}

// ===== 1. detectLanguage =====

test('detectLanguage：中文占比高判为 zh，英文判为 en', () => {
  assert.equal(detectLanguage('本文提出了一种基于深度学习的学术文档解析方法，用于还原章节结构。'), 'zh');
  assert.equal(detectLanguage('This paper proposes a deep learning method for parsing academic documents.'), 'en');
});

test('detectLanguage：边界与空输入', () => {
  assert.equal(detectLanguage(''), 'en', '空文本按英文处理');
  assert.equal(detectLanguage('   \n\t '), 'en', '纯空白按英文处理');
  // 20 个非空白字符里 5 个汉字 = 25% > 20% → zh
  assert.equal(detectLanguage('abcde12345中文字符一二三'), 'zh');
  // 20 个非空白字符里 2 个汉字 = 10% < 20% → en
  assert.equal(detectLanguage('abcdefgh12345678中文'), 'en');
});

// ===== 2. 通道开关与优先级 =====

test('未配置任何外部服务时三个插件通道均为 disabled', (t) => {
  withEnv(t, {});
  assert.equal(isMinerUEnabled(), false);
  assert.equal(isDoclingEnabled(), false);
  assert.equal(isGrobidEnabled(), false);
});

test('resolveParserOrder：英文优先 Docling，中文优先 MinerU', () => {
  assert.deepEqual(resolveParserOrder('en', ''), ['docling', 'mineru', 'grobid', 'pdfjs']);
  assert.deepEqual(resolveParserOrder('zh', ''), ['mineru', 'docling', 'grobid', 'pdfjs']);
});

test('resolveParserOrder：DOC_PARSER_PREFER 覆盖首选通道', () => {
  assert.deepEqual(resolveParserOrder('zh', 'docling'), ['docling', 'mineru', 'grobid', 'pdfjs']);
  assert.deepEqual(resolveParserOrder('en', 'mineru'), ['mineru', 'docling', 'grobid', 'pdfjs']);
  // 非法值不应破坏默认顺序
  assert.deepEqual(resolveParserOrder('en', 'not-a-parser'), ['docling', 'mineru', 'grobid', 'pdfjs']);
});

// ===== 3. pdfjs 兜底 =====

test('未配置外部服务：走 pdfjs 兜底，attempts 记录跳过原因，degraded=true', async (t) => {
  withEnv(t, {});
  // 兜底通道完全本地，不该发出任何网络请求；一旦发出说明路由出错
  const calls = stubFetch(t, () => null);

  const result = await parseDocument(PDF_2PAGES, { filename: 'a.pdf' });
  assert.equal(result.parser, 'pdfjs');
  assert.equal(result.degraded, true, '只剩兜底通道应标记为降级');
  assert.ok(result.blocks.length >= 2, '应解析出 2 页内容');
  assert.equal(result.blocks[0].page_number, 1, 'pdfjs 兜底也要带页码');
  assert.equal(result.blocks[0].section_title, '', 'pdfjs 兜底无章节信息');
  assert.deepEqual(calls, [], '不应发出任何出站请求');

  const skipped = result.attempts.filter((a) => a.skipped);
  assert.equal(skipped.length, 3, '三个插件通道都应被记录为跳过');
  for (const name of ['mineru', 'docling', 'grobid']) {
    const hit = skipped.find((a) => a.parser === name);
    assert.ok(hit, `attempts 应包含 ${name}`);
    assert.match(hit.error, /未配置/, `${name} 的跳过原因应说明未配置`);
    assert.equal(hit.ok, false);
  }
  assert.equal(result.attempts.at(-1).parser, 'pdfjs');
  assert.equal(result.attempts.at(-1).ok, true);
});

// ===== 4. Docling 响应解析（纯函数） =====

test('parseDoclingDocument：提取页码、章节标题与表格，忽略页脚', () => {
  const { blocks, tables, metadata } = parseDoclingDocument(buildDoclingJson(), '# Docling Test Paper');

  assert.equal(blocks.length, 5, '页脚属版式家具应被丢弃，表格本体不进 blocks');
  assert.equal(metadata.title, 'Docling Test Paper');

  const intro = blocks.find((b) => b.text === 'We present a parsing method.');
  assert.equal(intro.section_title, 'Introduction');
  assert.equal(intro.page_number, 1, '页码取自 prov[].page_no');

  const results = blocks.find((b) => b.text === 'Our results are strong.');
  assert.equal(results.section_title, 'Results');
  assert.equal(results.page_number, 2);

  assert.equal(blocks.find((b) => b.block_type === 'heading').text, 'Introduction');

  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0], [
    ['Model', 'Acc'],
    ['Ours', '92.3'],
    ['Base', '85.1'],
  ]);
});

test('parseDoclingDocument：无 json_content 时从 markdown 兜底出块与表格', () => {
  const md = [
    '# Fallback Paper',
    '## Methods',
    'We did something.',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
  ].join('\n');
  const { blocks, tables } = parseDoclingDocument(null, md);
  assert.ok(blocks.some((b) => b.section_title === 'Methods' && b.text === 'We did something.'));
  assert.deepEqual(tables, [['A', 'B'], ['1', '2']]);
});

// ===== 5. GROBID TEI 解析（纯函数） =====

test('parseGrobidTei：解析标题/作者/DOI/章节/参考文献/文内引用', () => {
  const r = parseGrobidTei(GROBID_TEI);

  assert.equal(r.metadata.title, 'A Study of Document Parsing');
  assert.deepEqual(r.metadata.authors, ['Jane Doe', 'Bo Li']);
  assert.equal(r.metadata.doi, '10.1000/main');
  assert.equal(r.metadata.year, '2021');
  assert.equal(r.metadata.journal, 'Journal of Parsing');
  assert.equal(r.metadata.abstract, 'We study document parsing.');

  assert.deepEqual(r.sections.map((s) => s.title), ['Introduction', 'Sub Topic', 'Methods']);
  assert.equal(r.sections[1].page_number, 2, '嵌套 div 也能取到 head 的页码');

  assert.equal(r.references.length, 2);
  assert.equal(r.references[0].ref_id, 'b0');
  assert.equal(r.references[0].title, 'Baseline Paper');
  // editor 不应被误当成作者
  assert.deepEqual(r.references[0].authors, ['Ann Lee']);
  assert.equal(r.references[0].year, '2015');
  assert.equal(r.references[0].journal, 'Old Journal');
  assert.equal(r.references[0].doi, '10.5555/baseline');
  assert.match(r.references[0].raw, /Baseline Paper/);

  assert.equal(r.citations.length, 2);
  const cite = r.citations.find((c) => c.ref_id === 'b0');
  assert.equal(cite.marker, '[1]');
  assert.equal(cite.page_number, 1, '引用页码来自 ref 的 @coords 第一个值');
  assert.match(cite.context, /Prior work built a baseline/);
});

test('parseGrobidTei：空输入与非法 XML 应抛错', () => {
  assert.throws(() => parseGrobidTei(''), /空 XML/);
  assert.throws(() => parseGrobidTei('   '), /空 XML/);
});

// ===== 6. 端到端路由（打桩 fetch + env） =====

test('配置 Docling 后英文文档走 Docling 通道，且不降级', async (t) => {
  withEnv(t, { DOCLING_API_URL: 'http://docling.internal:5001' });
  const calls = stubFetch(t, (url) => (url.includes('/v1/convert/file') ? makeResponse(doclingEnvelope()) : null));

  const result = await parseDocument(PDF_2PAGES, { filename: 'a.pdf', languageHint: 'en' });
  assert.equal(result.parser, 'docling');
  assert.equal(result.degraded, false, '首选通道成功不应标记降级');
  assert.equal(result.blocks.length, 5);
  assert.ok(result.blocks.some((b) => b.page_number === 2 && b.section_title === 'Results'));
  assert.equal(result.tables.length, 1);
  assert.ok(calls.some((u) => u.includes('/v1/convert/file')));
});

test('DOC_PARSER_PREFER 可强制改首选通道（中文文档也能指定 Docling）', async (t) => {
  withEnv(t, {
    DOCLING_API_URL: 'http://docling.internal:5001',
    MINERU_API_URL: 'http://mineru.internal:8000',
    DOC_PARSER_PREFER: 'docling',
  });
  // MinerU 若被调用说明优先级没生效——用 500 让它在被误调时立刻暴露
  stubFetch(t, (url) => {
    if (url.includes('/v1/convert/file')) return makeResponse(doclingEnvelope());
    return null;
  });

  const result = await parseDocument(PDF_2PAGES, { languageHint: 'zh' });
  assert.equal(result.parser, 'docling', 'DOC_PARSER_PREFER 应覆盖语言的默认优先级');
});

test('降级链：主通道报错后自动落到下一个已配置通道', async (t) => {
  withEnv(t, {
    DOCLING_API_URL: 'http://docling.internal:5001',
    MINERU_API_URL: 'http://mineru.internal:8000',
  });
  const calls = stubFetch(t, (url) => {
    if (url.includes('/v1/convert/file')) return makeResponse('boom', { status: 500 });
    if (url.includes('/file_parse')) {
      return makeResponse({
        markdown: '# MinerU Paper\n\n## 方法\n\n我们提出了一种方法。',
        content_list: [
          { type: 'title', text: 'MinerU Paper', page_idx: 0, text_level: 1 },
          { type: 'text', text: '我们提出了一种方法。', page_idx: 0 },
          { type: 'page_footer', text: '1', page_idx: 0 },
        ],
      });
    }
    return null;
  });

  const result = await parseDocument(PDF_2PAGES, { languageHint: 'en' });
  assert.equal(result.parser, 'mineru');
  assert.equal(result.degraded, true, '发生过降级');
  assert.equal(result.attempts[0].parser, 'docling');
  assert.equal(result.attempts[0].ok, false);
  assert.match(result.attempts[0].error, /HTTP 500/);
  assert.equal(result.attempts[1].parser, 'mineru');
  assert.equal(result.attempts[1].ok, true);
  assert.ok(calls.length >= 2, '应依次请求过两个通道');

  const body = result.blocks.find((b) => b.text === '我们提出了一种方法。');
  assert.equal(body.page_number, 1, 'MinerU 的 page_idx 是 0 基，应转成 1 基页码');
  assert.equal(body.section_title, 'MinerU Paper');
});

test('Docling 与 MinerU 都失败时降级到 pdfjs', async (t) => {
  withEnv(t, {
    DOCLING_API_URL: 'http://docling.internal:5001',
    MINERU_API_URL: 'http://mineru.internal:8000',
  });
  stubFetch(t, () => makeResponse('down', { status: 503 }));

  const result = await parseDocument(PDF_2PAGES, { languageHint: 'en' });
  assert.equal(result.parser, 'pdfjs');
  assert.equal(result.degraded, true);
  assert.ok(result.blocks.length >= 2);
  assert.equal(result.attempts.filter((a) => !a.ok).length, 3, 'docling/mineru/grobid 均失败');
});

test('全部通道失败时抛错并带上 attempts', async (t) => {
  withEnv(t, {
    DOCLING_API_URL: 'http://docling.internal:5001',
    MINERU_API_URL: 'http://mineru.internal:8000',
    GROBID_URL: 'http://grobid.internal:8070',
  });
  stubFetch(t, () => makeResponse('down', { status: 500 }));

  // 传非 PDF 字节，让 pdfjs 兜底也失败
  await assert.rejects(
    () => parseDocument(Buffer.from('% not a real pdf at all %'), { languageHint: 'en' }),
    (err) => {
      assert.match(err.message, /全部解析通道均失败/);
      assert.ok(Array.isArray(err.attempts), '错误对象应携带 attempts');
      assert.equal(err.attempts.at(-1).parser, 'pdfjs');
      assert.equal(err.attempts.at(-1).ok, false);
      return true;
    },
  );
});

test('wantReferences：主通道成功时额外跑 GROBID 补齐参考文献与引用', async (t) => {
  withEnv(t, {
    DOCLING_API_URL: 'http://docling.internal:5001',
    GROBID_URL: 'http://grobid.internal:8070',
  });
  stubFetch(t, (url) => {
    if (url.includes('/v1/convert/file')) return makeResponse(doclingEnvelope());
    if (url.includes('/api/processFulltextDocument')) return makeResponse(GROBID_TEI);
    return null;
  });

  // Docling 夹具本身不带 references，参考文献应完全来自 GROBID 补充通道
  const result = await parseDocument(PDF_2PAGES, { languageHint: 'en', wantReferences: true });
  assert.equal(result.parser, 'docling', '主通道仍是 Docling');
  assert.equal(result.references.length, 2, '参考文献应由 GROBID 补齐');
  assert.equal(result.references[0].title, 'Baseline Paper');
  assert.equal(result.citations.length, 2);

  const enrich = result.attempts.filter((a) => a.role === 'references');
  assert.equal(enrich.length, 1);
  assert.equal(enrich[0].parser, 'grobid');
  assert.equal(enrich[0].ok, true);
  // 主通道标题已存在，不应被补充通道覆盖
  assert.equal(result.metadata.title, 'Docling Test Paper');
});

test('GROBID 补充失败不影响主结果', async (t) => {
  withEnv(t, {
    DOCLING_API_URL: 'http://docling.internal:5001',
    GROBID_URL: 'http://grobid.internal:8070',
  });
  stubFetch(t, (url) => {
    if (url.includes('/v1/convert/file')) return makeResponse(doclingEnvelope());
    if (url.includes('/api/processFulltextDocument')) return makeResponse('nope', { status: 500 });
    return null;
  });

  const result = await parseDocument(PDF_2PAGES, { languageHint: 'en', wantReferences: true });
  assert.equal(result.parser, 'docling');
  assert.equal(result.blocks.length, 5);
  assert.deepEqual(result.references, []);
  const enrich = result.attempts.find((a) => a.role === 'references');
  assert.equal(enrich.ok, false);
  assert.match(enrich.error, /HTTP 500/);
});

test('GROBID 作为主通道成功时不重复合并补充结果', async (t) => {
  withEnv(t, { GROBID_URL: 'http://grobid.internal:8070' });
  const calls = stubFetch(t, (url) => (
    url.includes('/api/processFulltextDocument') ? makeResponse(GROBID_TEI) : null
  ));

  const result = await parseDocument(PDF_2PAGES, { wantReferences: true });
  assert.equal(result.parser, 'grobid');
  assert.equal(result.references.length, 2);
  // 主通道就是 GROBID，不应再产生一条 role=references 的补充记录
  assert.equal(result.attempts.filter((a) => a.role === 'references').length, 0);
  // 且 GROBID 只被调用一次（共享同一个 promise，不重复跑）
  const grobidCalls = calls.filter((u) => u.includes('/api/processFulltextDocument'));
  assert.equal(grobidCalls.length, 1, 'GROBID 应只被调用一次');
});

// ===== 7. blocksToEvidenceSources =====

test('blocksToEvidenceSources：字段对齐证据库，空块被剔除，无章节时回落文档标题', () => {
  const sources = blocksToEvidenceSources([
    { page_number: 3, section_title: '方法', text: '  我们的方法  ' },
    { page_number: null, section_title: '', text: '无章节段落' },
    { page_number: 4, section_title: '实验', text: '   ' },
  ], { title: '某论文' });

  assert.equal(sources.length, 2, '纯空白块应被剔除');
  assert.deepEqual(sources[0], { page_number: 3, section_title: '方法', text: '我们的方法' });
  assert.deepEqual(sources[1], { page_number: null, section_title: '某论文', text: '无章节段落' });
});

test('blocksToEvidenceSources：空输入返回空数组', () => {
  assert.deepEqual(blocksToEvidenceSources(null, null), []);
  assert.deepEqual(blocksToEvidenceSources([], {}), []);
});

// ===== 8. estimateParseQuality =====

test('estimateParseQuality：满分与零分边界', () => {
  const full = {
    blocks: [
      { page_number: 1, section_title: 'Introduction', text: 'a' },
      { page_number: 2, section_title: 'Methods', text: 'b' },
    ],
    tables: [['x']],
    references: [{ title: 'r' }],
    citations: [{ ref_id: 'b0' }],
    metadata: { title: 'T' },
    degraded: false,
  };
  assert.equal(estimateParseQuality(full), 100);

  assert.equal(estimateParseQuality(null), 0);
  assert.equal(estimateParseQuality({}), 0);
  assert.equal(estimateParseQuality({ blocks: [], degraded: true }), 0, '分数不会被扣成负数');
});

test('estimateParseQuality：降级减分，结构缺失按比例扣分', () => {
  const half = {
    blocks: [
      { page_number: 1, section_title: '', text: 'a' },
      { page_number: null, section_title: '', text: 'b' },
    ],
    tables: [],
    references: [],
    citations: [],
    metadata: {},
    degraded: true,
  };
  // 页码覆盖 1/2 → 15；章节 0 → 0；表格/参考/引用/标题 → 0；降级 -20 → max(0, -5) = 0
  assert.equal(estimateParseQuality(half), 0);

  const withRefs = {
    blocks: [{ page_number: 1, section_title: 'Intro', text: 'a' }],
    tables: [],
    references: [{ title: 'r' }],
    citations: [],
    metadata: { title: 'T' },
    degraded: true,
  };
  // 30 + 20 + 0 + 15 + 0 + 10 = 75，降级 -20 → 55
  assert.equal(estimateParseQuality(withRefs), 55);

  const noDegrade = { ...withRefs, degraded: false };
  assert.equal(estimateParseQuality(noDegrade), 75);
});

test('estimateParseQuality：分数始终落在 0-100', () => {
  const weird = {
    blocks: Array.from({ length: 10 }, (_, i) => ({ page_number: i + 1, section_title: `S${i}`, text: 'x' })),
    tables: [['a']],
    references: [{ title: 'r' }],
    citations: [{ ref_id: 'b0' }],
    metadata: { title: 'T' },
    degraded: false,
  };
  const score = estimateParseQuality(weird);
  assert.ok(score >= 0 && score <= 100, `分数应落在 0-100，实际 ${score}`);
  assert.equal(score, 100);
});
