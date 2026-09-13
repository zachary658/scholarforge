import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateDownloadRisk } from '../src/services/download-risk.js';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'sf-download-risk-')), 'test.db');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'download-risk-test-secret-more-than-thirty-two-characters';
const db = (await import('../src/db.js')).default;
const { default: express } = await import('express');
const router = (await import('../src/routes/docs.js')).default;
const { signAccessToken } = await import('../src/auth.js');
const app = express();
app.use(express.json());
app.use('/docs', router);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
after(() => new Promise(resolve => server.close(resolve)));
const base = `http://127.0.0.1:${server.address().port}/docs`;

test('paragraph overlap is bounded and does not pretend insufficient text is low risk', () => {
  const paragraph = '这是用于验证内部重复统计的独立完整段落，具有足够的字符可以计算重叠。';
  assert.equal(estimateDownloadRisk('').level, 'unknown');
  assert.equal(estimateDownloadRisk(paragraph).level, 'unknown');
  assert.equal(estimateDownloadRisk(`${paragraph}\n${paragraph}`).level, 'high');
  assert.equal(estimateDownloadRisk('a'.repeat(30) + '\n' + 'b'.repeat(30)).level, 'low');
});

test('full-paper generation persists the estimate before any download or acknowledgment', async () => {
  const { generateDocx } = await import('../src/services/docx-generator.js');
  const uid = db.prepare('INSERT INTO users(email,password_hash,name) VALUES (?,?,?)').run('risk-generated@test.invalid', 'unused', 'generated').lastInsertRowid;
  const paragraph = '这是一个用于检查生成后风险统计是否已经保存的测试段落，内容不涉及任何真实文献检索。';
  const doc = await generateDocx({ userId: uid, title: 'Risk fixture', feature: 'writing_fulltext', content: `${paragraph}\n\n${paragraph}` });
  try {
    const row = db.prepare('SELECT * FROM generated_docs WHERE id=?').get(doc.id);
    assert.equal(doc.risk.level, 'high');
    assert.deepEqual(JSON.parse(row.download_risk), doc.risk);
    assert.equal(row.risk_acknowledged_at, null);
  } finally { unlinkSync(doc.filePath); }
});

test('download requires owner acknowledgment and records user/project/artifact/time without authorizing other artifacts', async () => {
  const uid = db.prepare('INSERT INTO users(email,password_hash,name) VALUES (?,?,?)').run('risk@test.invalid', 'unused', 'risk').lastInsertRowid;
  const other = db.prepare('INSERT INTO users(email,password_hash,name) VALUES (?,?,?)').run('risk-other@test.invalid', 'unused', 'other').lastInsertRowid;
  const project = db.prepare('INSERT INTO projects(user_id,title) VALUES (?,?)').run(uid, 'risk project').lastInsertRowid;
  const filename = `risk-test-${process.pid}.docx`;
  const directory = fileURLToPath(new URL('../uploads/docs/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, filename), 'fixture bytes');
  const insert = db.prepare('INSERT INTO generated_docs(user_id,project_id,title,feature,file_path,download_risk) VALUES (?,?,?,?,?,?)');
  const id = insert.run(uid, project, 'paper', 'writing_fulltext', filename, JSON.stringify({ level: 'high' })).lastInsertRowid;
  const next = insert.run(uid, project, 'new paper version', 'chapters', filename, null).lastInsertRowid;
  const token = await signAccessToken({ id: uid });
  const otherToken = await signAccessToken({ id: other });
  const call = (path, body, access = token) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await call(`/download/${id}`)).status, 403);
    assert.equal((await call(`/${id}/download-risk/acknowledge`, { acknowledged: false })).status, 400);
    assert.equal((await call(`/${id}/download-risk/acknowledge`, { acknowledged: true }, otherToken)).status, 404);
    assert.equal((await call(`/${id}/download-risk`, undefined, otherToken)).status, 404);
    const before = Math.floor(Date.now() / 1000);
    assert.equal((await call(`/${id}/download-risk/acknowledge`, { acknowledged: true })).status, 200);
    const row = db.prepare('SELECT * FROM generated_docs WHERE id=?').get(id);
    assert.equal(row.user_id, uid);
    assert.equal(row.project_id, project);
    assert.ok(row.risk_acknowledged_at >= before);
    assert.ok(row.risk_acknowledged_at <= Math.floor(Date.now() / 1000));
    assert.equal(JSON.parse(row.download_risk).level, 'high');
    assert.equal((await call(`/download/${id}`)).status, 200);
    assert.equal((await call(`/download/${next}`)).status, 403);
    await call(`/${id}/download-risk/acknowledge`, { acknowledged: true });
    assert.equal(db.prepare('SELECT risk_acknowledged_at FROM generated_docs WHERE id=?').get(id).risk_acknowledged_at, row.risk_acknowledged_at);
  } finally { unlinkSync(join(directory, filename)); }
});
