import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-evidence-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';

const db = (await import('../src/db.js')).default;
const {
  replaceEvidenceBlocks,
  replaceDistilledEvidence,
  rebuildProjectEvidence,
  searchProjectEvidence,
  searchProjectEvidenceHybrid,
  buildEvidenceContext,
  evidenceQuality,
  vectorEvidenceConfigured,
} = await import('../src/services/evidence-engine.js');

const user = db.prepare("INSERT INTO users (email,password_hash,name) VALUES ('evidence@example.com','x','证据测试')").run();
const project = db.prepare("INSERT INTO projects (user_id,title,field) VALUES (?, '医学影像分割', '计算机科学')").run(user.lastInsertRowid);
const userId = Number(user.lastInsertRowid);
const projectId = Number(project.lastInsertRowid);

test('结构化证据写入保留页码、章节与块序号', () => {
  const rows = replaceEvidenceBlocks({
    userId,
    projectId,
    sourceType: 'material',
    sourceId: 101,
    sourceTitle: '实验论文.pdf',
    blocks: [
      { page_number: 2, section_title: '研究方法', text: '本文使用 U-Net 对医学影像进行分割，并采用交叉验证评估模型。' },
      { page_number: 5, section_title: '实验结果', text: '实验结果显示改进模型在公开数据集上的 Dice 指标有所提升。' },
    ],
    traceable: true,
    syncVector: false,
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.page_number), [2, 5]);
  assert.deepEqual(rows.map((row) => row.section_title), ['研究方法', '实验结果']);
  assert.deepEqual(rows.map((row) => row.chunk_index), [0, 1]);
});

test('本地混合检索优先返回与查询相关的证据', () => {
  const rows = searchProjectEvidence({ userId, projectId, query: 'Dice 实验结果', limit: 5 });
  assert.ok(rows.length > 0);
  assert.equal(rows[0].page_number, 5);
  assert.match(rows[0].content, /Dice/);
});

test('刷新蒸馏证据不会破坏用户资料页码块', () => {
  replaceDistilledEvidence(userId, projectId, {
    references: [{ title: 'Deep segmentation study', abstract: 'A deep model for medical image segmentation.', doi: '10.1/test' }],
    tables: [{ source: 'Deep segmentation study', rows: [['Method', 'Dice'], ['Ours', '0.91']] }],
  });
  const materialRows = db.prepare("SELECT * FROM evidence_chunks WHERE project_id = ? AND source_type = 'material'").all(projectId);
  assert.equal(materialRows.length, 2);
  assert.deepEqual(materialRows.map((row) => row.page_number), [2, 5]);
  const quality = evidenceQuality(userId, projectId);
  assert.ok(quality.sources >= 3);
});

test('重建项目索引保留已解析材料的页码与章节', () => {
  db.prepare(
    "INSERT INTO materials (id,user_id,project_id,name,file_type,text_content,tokens) VALUES (101,?,?,?,?,?,?)"
  ).run(userId, projectId, '实验论文.pdf', 'pdf', '兼容用的扁平全文', 10);
  rebuildProjectEvidence(userId, projectId);
  const rows = db.prepare(
    "SELECT page_number, section_title FROM evidence_chunks WHERE project_id = ? AND source_type = 'material' ORDER BY chunk_index"
  ).all(projectId);
  assert.deepEqual(rows.map((row) => row.page_number), [2, 5]);
  assert.deepEqual(rows.map((row) => row.section_title), ['研究方法', '实验结果']);
});

test('文档中的 BGE_M3_API_URL 配置名可以启用向量模式', (t) => {
  const oldQdrant = process.env.QDRANT_URL;
  const oldBge = process.env.BGE_M3_API_URL;
  process.env.QDRANT_URL = 'http://10.20.0.20:6333';
  process.env.BGE_M3_API_URL = 'http://10.20.0.21:8080/v1';
  t.after(() => {
    if (oldQdrant === undefined) delete process.env.QDRANT_URL; else process.env.QDRANT_URL = oldQdrant;
    if (oldBge === undefined) delete process.env.BGE_M3_API_URL; else process.env.BGE_M3_API_URL = oldBge;
  });
  assert.equal(vectorEvidenceConfigured(), true);
});

test('向量结果必须回查 SQLite，已删除或伪造的 Qdrant point 不会进入上下文', async (t) => {
  const oldFetch = global.fetch;
  const oldQdrant = process.env.QDRANT_URL;
  const oldBge = process.env.BGE_M3_API_URL;
  process.env.QDRANT_URL = 'http://10.20.0.20:6333';
  process.env.BGE_M3_API_URL = 'http://10.20.0.21:8080/v1';
  const validId = db.prepare("SELECT id FROM evidence_chunks WHERE project_id = ? AND source_type = 'material' LIMIT 1").get(projectId).id;
  global.fetch = async (url) => {
    if (String(url).endsWith('/embeddings')) {
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.2, 0.4] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      result: { points: [
        { id: validId, score: 0.95, payload: { content: '合法向量内容' } },
        { id: 999999, score: 1, payload: { content: '已经删除但仍残留的敏感内容' } },
      ] },
    }), { status: 200 });
  };
  t.after(() => {
    global.fetch = oldFetch;
    if (oldQdrant === undefined) delete process.env.QDRANT_URL; else process.env.QDRANT_URL = oldQdrant;
    if (oldBge === undefined) delete process.env.BGE_M3_API_URL; else process.env.BGE_M3_API_URL = oldBge;
  });

  const result = await searchProjectEvidenceHybrid({ userId, projectId, query: '医学影像', limit: 10 });
  assert.ok(result.results.some((row) => row.id === validId));
  assert.ok(!result.results.some((row) => row.id === 999999));
  assert.ok(!result.results.some((row) => row.content.includes('敏感内容')));
});

test('配置 PaperQA2 后会参与章节证据筛选，并保留本地证据编号', async (t) => {
  const oldFetch = global.fetch;
  const oldPaperqa = process.env.PAPERQA_API_URL;
  process.env.PAPERQA_API_URL = 'http://10.20.0.30:8100';
  global.fetch = async (url) => {
    assert.ok(String(url).endsWith('/api/v1/answer'));
    return new Response(JSON.stringify({
      mode: 'paperqa',
      answer: '',
      evidence: [{ title: '实验论文.pdf', page_number: 5, quote: '实验结果显示改进模型在公开数据集上的 Dice 指标有所提升。' }],
    }), { status: 200 });
  };
  t.after(() => {
    global.fetch = oldFetch;
    if (oldPaperqa === undefined) delete process.env.PAPERQA_API_URL; else process.env.PAPERQA_API_URL = oldPaperqa;
  });

  const result = await buildEvidenceContext(userId, projectId, '实验论文', { limit: 8 });
  assert.match(result.mode, /paperqa/);
  assert.equal(result.evidence[0].page_number, 5);
  assert.ok(result.ids.includes(result.evidence[0].id));
  assert.match(result.context, new RegExp(`\\[EVIDENCE:${result.evidence[0].id} `));
});
