// 冒烟测试：核心链路运行时验证（开发环境 + mock 支付）
// 用法：先 npm start（默认 3001），再 node scripts/smoke.mjs（可用 SMOKE_BASE 覆盖地址）
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3001';
let token = '';
let cookie = '';

async function req(path, { method = 'GET', body, auth = true, headers = {}, tk = null } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  const t = tk || token;
  if (auth && t) h.Authorization = `Bearer ${t}`;
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
    ...(cookie ? { headers: { ...h, Cookie: cookie } } : { headers: h }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

// 1. 注册（受同 IP 注册风控限制时，回退管理员接口建号）
const email = `smoke_${Date.now()}@test.com`;
let r = await req('/api/auth/register', { method: 'POST', auth: false, body: { email, password: 'pass1234', name: '冒烟测试', agree_terms: true, device_fingerprint: 'a'.repeat(16) } });
if (r.status !== 200 || !r.data.token) {
  // 风控拦截：改用管理员接口创建测试用户
  let ar = await req('/api/auth/login', { method: 'POST', auth: false, body: { email: process.env.ADMIN_EMAIL || 'admin@scholarforge.com', password: process.env.ADMIN_PASSWORD || 'Admin123456' } });
  const adminToken = ar.data?.token;
  if (adminToken) {
    await req('/api/admin/users', { method: 'POST', body: { email, password: 'pass1234', name: '冒烟测试' }, tk: adminToken });
  }
  r = await req('/api/auth/login', { method: 'POST', auth: false, body: { email, password: 'pass1234' } });
}
check('注册/登录测试用户', r.status === 200 && r.data.token, r.data.error || '');
token = r.data.token || '';

// 2. 免费大纲生成（内置模板，无 AI key）
r = await req('/api/tools/writing', { method: 'POST', body: { type: 'outline', topic: '深度学习在医学影像中的应用', field: '计算机科学' } });
check('免费大纲生成', r.status === 200 && r.data.content && r.data.chargeType === 'unlimited', `chargeType=${r.data.chargeType}`);
const outlineProjectId = r.data?.projectId;

// 3. 创建全文订单 → mock 支付
r = await req('/api/orders', { method: 'POST', body: { item_type: 'writing_fulltext', quantity: 1, payment_method: 'mock' } });
check('创建全文订单', r.status === 200 && r.data.order && r.data.order.status === 'pending', `amount=${r.data.order?.amount}`);
const orderNo = r.data.order?.order_no;
r = await req(`/api/payment/mock/${orderNo}`, { method: 'POST' });
check('mock 支付成功', r.status === 200 && r.data.order?.status === 'paid', r.data.error || '');
r = await req(`/api/payment/order/${orderNo}/status`);
check('订单状态 paid', r.data.status === 'paid');

// 4. quantity>1 被拒绝
r = await req('/api/orders', { method: 'POST', body: { item_type: 'writing_fulltext', quantity: 3, payment_method: 'mock' } });
check('quantity>1 被拒绝', r.status === 400, r.data.error || '');

// 5. 免费大纲会自动创建并关联工作区，同时保存真实检索来源；直接沿流程继续，不再新建孤立项目。
const projectId = outlineProjectId;
check('大纲自动关联工作区', Boolean(projectId), `projectId=${projectId}`);
r = await req(`/api/projects/${projectId}/outline/confirm`, { method: 'POST' });
check('确认大纲', r.status === 200, '');

// 6. 分章节生成（用全文订单）
r = await req(`/api/projects/${projectId}/chapters/generate`, { method: 'POST', body: { orderNo } });
check('分章节生成启动', r.status === 200 && r.data.queued === true, JSON.stringify(r.data).slice(0, 150));

// 7. 同一订单并发复用在生成期间应被拒绝（service_status=processing）
r = await req(`/api/projects/${projectId}/chapters/generate`, { method: 'POST', body: { orderNo } });
check('生成期间重复提交被拒', r.status === 400 && /生成中|已结束|重复/.test(r.data.error || ''), r.data.error || '');

// 8. 等待生成完成（轮询，内置模板很快）
let done = false;
for (let i = 0; i < 30; i++) {
  await new Promise((res) => setTimeout(res, 1000));
  const rr = await req(`/api/projects/${projectId}/chapters`);
  const chs = rr.data.chapters || [];
  if (!rr.data.generating && chs.length > 0 && chs.every((c) => c.status === 'done')) { done = true; break; }
}
check('章节全部生成完成', done, '');

// 9. 生成完成后订单 completed，同订单再用被拒（防一单多论文）
r = await req(`/api/payment/order/${orderNo}/status`);
check('订单服务已完成', r.data.status === 'paid', `status=${r.data.status}`);
r = await req('/api/projects', { method: 'POST', body: { title: '第二个项目', field: '计算机科学' } });
const p2 = r.data.project?.id;
await req(`/api/projects/${p2}`, { method: 'PUT', body: { outline: [{ chapter: '第一章', sections: [{ title: '1.1' }] }] } });
await req(`/api/projects/${p2}/outline/confirm`, { method: 'POST' });
r = await req(`/api/projects/${p2}/chapters/generate`, { method: 'POST', body: { orderNo } });
check('同订单第二项目被拒（一单多论文已堵）', r.status === 400, r.data.error || '');

// 10. 订单完成后仍可单章重写（每章最多 3 次上限，防无限白嫖——合并协作者产品行为）
r = await req(`/api/projects/${projectId}/chapters/ch_1/regenerate`, { method: 'POST', body: { orderNo } });
check('订单完成后单章重写可用（3次上限内）', r.status === 200 && r.data.chapter?.status === 'done', r.data.error || '');

// 11. 无真实来源的孤立项目必须先被文献门禁拦截，不能先收费再生成无依据正文
r = await req('/api/projects', { method: 'POST', body: { title: '第三个项目', field: '计算机科学' } });
const p3 = r.data.project?.id;
await req(`/api/projects/${p3}`, { method: 'PUT', body: { outline: [{ chapter: '第一章 绪论', sections: [{ title: '1.1 研究背景' }] }] } });
r = await req(`/api/projects/${p3}/outline/confirm`, { method: 'POST' });
check('无文献项目的大纲前置确认成功', r.status === 200, r.data.error || '');
r = await req(`/api/projects/${p3}/chapters/generate`, { method: 'POST', body: {} });
check('无真实文献不进入付费正文生成', r.status === 400 && /真实文献不足/.test(r.data.error || ''), r.data.error || '');

// 12. smart-writing：真实结果才算成功；降级空模板必须明确失败且订单可重试
r = await req('/api/orders', { method: 'POST', body: { item_type: 'literature_review', quantity: 1, payment_method: 'mock' } });
const lrOrderNo = r.data.order?.order_no;
await req(`/api/payment/mock/${lrOrderNo}`, { method: 'POST' });
r = await req('/api/tools/smart-writing', { method: 'POST', body: { topic: '深度学习医学影像', field: '计算机科学', projectId: projectId, orderNo: lrOrderNo } });
const researchSucceeded = r.status === 200 && r.data.ok === true;
const researchFailedCleanly = r.status === 200 && r.data.failed === true && r.data.retriable === true;
check('smart-writing 真实交付或明确失败', researchSucceeded || researchFailedCleanly, JSON.stringify(r.data).slice(0, 180));
if (researchSucceeded) {
  check('smart-writing 交付满足最低文献数', (r.data.references || []).filter((x) => x.doi || x.source_url).length >= 3);
} else {
  r = await req(`/api/payment/order/${lrOrderNo}/status`);
  check('降级失败不标记订单完成且可重试', r.data.status === 'paid' && r.data.service_status === 'failed', JSON.stringify(r.data));
}

console.log('\n=== 冒烟测试结束 ===');
