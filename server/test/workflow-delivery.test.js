import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'sf-workflow-test-')), 'test.db');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'workflow-test-only-secret-with-more-than-32-characters';
const db = (await import('../src/db.js')).default;
const store = await import('../src/services/task-store.js');
const workflow = await import('../src/services/workflow-service.js');
const { inspectPaper, contentVersion } = await import('../src/services/final-quality.js');
const { attestReference, hasReferenceProof } = await import('../src/services/reference-proof.js');
const { createFeatureOrder, markOrderPaid } = await import('../src/services/payment.js');
const { regenerateChapter } = await import('../src/services/chapter-service.js');
const uid = db.prepare('INSERT INTO users (email,password_hash,name) VALUES (?,?,?)').run('workflow@example.test', 'unused', 'Workflow tester').lastInsertRowid;
const refs = [1,2,3].map(i => attestReference({ title: `Fixture reference ${i}`, doi: `10.1000/fixture-${i}`, source_db: 'CrossRef', year: 2024 }));
const outline = [{ chapter: '第一章 绪论', sections: [] }, { chapter: '第二章 结论', sections: [] }];

test('签名核验不能被手填来源、篡改元数据或更换 DOI 绕过', () => {
  assert.equal(hasReferenceProof(refs[0]), true);
  assert.equal(hasReferenceProof({ ...refs[0], title: 'Forged title' }), false);
  assert.equal(hasReferenceProof({ title: 'Fake', source_db: 'CrossRef', doi: '10.1/fake' }), false);
});

test('全文检查拒绝空文、未确认、缺章、越界范围和遗留占位符', () => {
  const p = { outline, sources: { references: refs }, chapters: outline.map((c,i) => ({ ...c, status:'done', confirmed:true, content:`正文 ${i} [1-3]` })) };
  assert.equal(inspectPaper(p).passed, true);
  for (const content of ['', '正文 [1-999]', '正文 [0]', '正文 [3-1]', '正文 [CITE:9]', '正文 [1]（数据待补充）', '正文 [1]\n参考文献\n伪造记录', '正文 [1]\nReferences\nFake']) {
    assert.equal(inspectPaper({ ...p, chapters: [{ ...p.chapters[0], content }, p.chapters[1]] }).passed, false, content);
  }
  assert.equal(inspectPaper({ ...p, chapters: [] }).passed, false);
  assert.equal(inspectPaper({ ...p, chapters: p.chapters.map(c => ({...c,confirmed:false})) }).passed, false);
  assert.notEqual(contentVersion(p), contentVersion({ ...p, title:'Changed title' }));
});

test('项目更新不能伪造工作流状态、章节索引或交付检查', () => {
  const p = store.createProject({ userId:uid, title:'State ownership' });
  store.updateProject(p.id, uid, { workflow_state:'completed', current_chapter_index:10, final_check_json:'{"passed":true}' });
  assert.notEqual(store.getProject(p.id,uid).workflow_state, 'completed');
  assert.notEqual(store.getProject(p.id,uid).current_chapter_index, 10);
});

test('完整流程：文献保存→大纲→一次付费→两章确认→导出→复用下载与重写', async () => {
  const p = store.createProject({ userId:uid, title:'Test workflow project', field:'计算机' });
  workflow.createFullPaperWorkflow(p.id,uid);
  await workflow.confirmLiterature(p.id,uid,refs);
  assert.equal(store.getProject(p.id,uid).sources.references.length,3);
  assert.throws(() => workflow.saveOutlineValidated(p.id,uid,[null]), /大纲/);
  assert.throws(() => workflow.saveOutlineValidated(p.id,uid,{chapter:'invalid'}), /大纲/);
  workflow.saveOutlineValidated(p.id,uid,[...outline, {chapter:'参考文献', sections:[]}]);
  assert.equal(store.getProject(p.id,uid).outline.length, 2);
  workflow.confirmOutlineValidated(p.id,uid);
  const { order } = createFeatureOrder({ userId:uid, itemType:'writing_fulltext', paymentMethod:'mock' });
  await markOrderPaid({ orderNo:order.order_no, transactionId:'workflow-mock', channel:'mock' });
  await workflow.generateCurrentChapter(uid,p.id,order.order_no);
  assert.equal(workflow.getWorkflowState(p.id,uid).state,'chapter_review');
  workflow.confirmChapter(uid,p.id,{ chapterId:'ch_1',content:'## 第一章 绪论\n\n第一章经过编辑的内容 [1-3]。' });
  await workflow.generateCurrentChapter(uid,p.id);
  workflow.confirmChapter(uid,p.id,{ chapterId:'ch_2',content:'## 第二章 结论\n\n第二章经过编辑的内容 [2]。' });
  assert.equal(workflow.runFinalCheck(p.id,uid).passed,true);
  const [exported, simultaneous] = await Promise.all([workflow.generateFinalDocument(p.id,uid), workflow.generateFinalDocument(p.id,uid)]);
  assert.ok(exported.doc.id);
  assert.equal(exported.doc.id, simultaneous.doc.id);
  assert.equal(exported.workflow.state,'completed');
  assert.equal((await workflow.generateFinalDocument(p.id,uid)).doc.id, exported.doc.id);
  workflow.backToChapter(uid,p.id,0);
  assert.equal(workflow.getWorkflowState(p.id,uid).state,'chapter_review');
  assert.equal(workflow.runFinalCheck(p.id,uid).passed,false);
  await regenerateChapter(uid,p.id,'ch_1',order.order_no);
  const revised = store.getProject(p.id,uid);
  assert.equal(revised.chapters[0].regenerate_count,1);
  assert.equal(revised.chapters[0].confirmed,false);
  assert.equal(revised.chapters[1].confirmed,false);
  const {order:unbound} = createFeatureOrder({userId:uid,itemType:'writing_fulltext',paymentMethod:'mock'});
  await markOrderPaid({orderNo:unbound.order_no,transactionId:'unbound-mock',channel:'mock'});
  await assert.rejects(regenerateChapter(uid,p.id,'ch_1',unbound.order_no), /已绑定/);
  await assert.rejects(workflow.generateFinalDocument(p.id,uid));
  // A failed upstream generation must preserve the previous text and rewrite quota.
  const beforeFailure = store.getProject(p.id,uid).chapters[0];
  process.env.NODE_ENV = 'production';
  try { await assert.rejects(regenerateChapter(uid,p.id,'ch_1',order.order_no), /未配置/); }
  finally { process.env.NODE_ENV = 'test'; }
  assert.deepEqual(store.getProject(p.id,uid).chapters[0], beforeFailure);
  workflow.reopenResearch(p.id,uid);
  await assert.rejects(workflow.confirmLiterature(p.id,uid,[...refs].reverse()), /顺序/);
  await workflow.confirmLiterature(p.id,uid,refs);
});

test('首章生成失败后仍保留已付费套餐，重试不需再次支付', async () => {
  const p = store.createProject({userId:uid,title:'First chapter timeout',field:'计算机'});
  workflow.createFullPaperWorkflow(p.id,uid);
  await workflow.confirmLiterature(p.id,uid,refs);
  workflow.saveOutlineValidated(p.id,uid,outline);
  workflow.confirmOutlineValidated(p.id,uid);
  const {order} = createFeatureOrder({userId:uid,itemType:'writing_fulltext',paymentMethod:'mock'});
  await markOrderPaid({orderNo:order.order_no,transactionId:'first-failure-mock',channel:'mock'});
  process.env.NODE_ENV='production';
  try { await assert.rejects(workflow.generateCurrentChapter(uid,p.id,order.order_no), /未配置/); }
  finally { process.env.NODE_ENV='test'; }
  assert.equal(workflow.getWorkflowState(p.id,uid).orderNo, order.order_no);
  await workflow.generateCurrentChapter(uid,p.id);
  assert.equal(workflow.getWorkflowState(p.id,uid).state,'chapter_review');
});

test('多模型计划遵守角色配置、单模型降级，且不返回 API 密钥', async () => {
  const { setSetting } = await import('../src/config-store.js');
  const { buildModelPlan } = await import('../src/services/orchestrator.js');
  process.env.LLM_API_KEY_DEEPSEEK = 'test-only-no-network';
  process.env.LLM_API_KEY_QWEN = 'test-only-no-network';
  try {
    setSetting('ai_role_routing', JSON.stringify({ technical: { writer:'qwen', reviewer:'deepseek' } }));
    let plan = buildModelPlan({field:'计算机'});
    assert.equal(plan.writer.key,'qwen');
    assert.equal(plan.reviewer.key,'deepseek');
    assert.equal(plan.multiModel,true);
    assert.ok(!JSON.stringify(plan).includes('test-only-no-network'));
    setSetting('ai_role_routing', JSON.stringify({ technical: { writer:'qwen', reviewer:'off' } }));
    assert.equal(buildModelPlan({field:'计算机'}).reviewer,null);
    delete process.env.LLM_API_KEY_DEEPSEEK;
    setSetting('ai_role_routing','{}');
    assert.equal(buildModelPlan({field:'计算机'}).multiModel,false);
  } finally {
    delete process.env.LLM_API_KEY_DEEPSEEK;
    delete process.env.LLM_API_KEY_QWEN;
    setSetting('ai_role_routing','{}');
  }
});

test('离线质量评测不能被 live 用例切换到真实 API', async () => {
  const { resolveMode, runGeneration } = await import('../scripts/promptfoo-provider.mjs');
  const env = { SF_PROMPTFOO_MOCK:'1' };
  assert.equal(resolveMode({mode:'live'}, {}, env), 'builtin');
  assert.equal(resolveMode({fixture:'good-medical'}, {}, env), 'mock');
  process.env.LLM_API_KEY_DEEPSEEK = 'must-never-reach-network';
  try {
    const result = await runGeneration({mode:'live',tool:'literature_review',topic:'测试主题'}, {env});
    assert.equal(result.metadata.mode,'builtin');
    assert.equal(result.metadata.usedRealAI,false);
    assert.ok(result.output.length > 0);
  } finally { delete process.env.LLM_API_KEY_DEEPSEEK; }
});
