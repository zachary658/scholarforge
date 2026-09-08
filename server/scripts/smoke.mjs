// 冒烟测试：核心链路运行时验证（开发环境 + mock 支付）
// 用法：先 npm start（默认 3001），再 node scripts/smoke.mjs（可用 SMOKE_BASE 覆盖地址）
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3001';
let token = '';
let cookie = '';

async function req(path, { method = 'GET', body, auth = true, headers = {}, tk = null } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  const t = tk || token;
  if (auth && t) h.Authorization = `Bearer ${t}`;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(Number(process.env.SMOKE_REQUEST_TIMEOUT_MS) || 30000),
      ...(cookie ? { headers: { ...h, Cookie: cookie } } : { headers: h }),
    });
  } catch (error) {
    return { status: 0, data: { error: `请求失败或超时: ${error.message}` } };
  }
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
// 注册策略只接受真实可送达的 QQ/163 邮箱域；使用每次唯一的 QQ 形式账号，
// 既覆盖生产注册规则，也避免重复运行时与旧测试账号冲突。
const email = `${Date.now()}@qq.com`;
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

// 3. 进入完整论文工作流，先检索并确认 10 篇可追溯文献（至少 3 篇外文）。
const projectId = outlineProjectId;
check('大纲自动关联工作区', Boolean(projectId), `projectId=${projectId}`);
r = await req(`/api/workflow/${projectId}/start`, {
  method: 'POST',
  body: { title: '深度学习在医学影像中的应用', field: '计算机科学', degree: 'undergraduate' },
});
check('进入完整论文工作流', r.status === 200 && r.data.workflow?.state === 'researching', r.data.error || '');
r = await req('/api/references/search?q=%E6%B7%B1%E5%BA%A6%E5%AD%A6%E4%B9%A0%E5%8C%BB%E5%AD%A6%E5%BD%B1%E5%83%8F');
const verifiedReferences = r.data.results || [];
check('检索到可溯源文献', r.status === 200 && verifiedReferences.length >= 10, `count=${verifiedReferences.length}`);
r = await req(`/api/workflow/${projectId}/literature/confirm`, { method: 'POST', body: { references: verifiedReferences } });
check('文献门禁通过', r.status === 200 && r.data.workflow?.state === 'outline_review', r.data.error || '');
r = await req(`/api/workflow/${projectId}/outline/confirm`, { method: 'POST' });
check('确认大纲', r.status === 200 && r.data.workflow?.state === 'chapter_generating', r.data.error || '');

// 4. 只有完成文献与大纲门禁后才创建项目级全文套餐 → mock 支付。
r = await req('/api/orders', { method: 'POST', body: { item_type: 'writing_fulltext', quantity: 1, payment_method: 'mock', params: { project_id: projectId } } });
check('创建全文订单', r.status === 200 && r.data.order && r.data.order.status === 'pending', `amount=${r.data.order?.amount}`);
const orderNo = r.data.order?.order_no;
r = await req(`/api/payment/mock/${orderNo}`, { method: 'POST' });
check('mock 支付成功', r.status === 200 && r.data.order?.status === 'paid', r.data.error || '');
r = await req(`/api/payment/order/${orderNo}/status`);
check('订单状态 paid', r.data.status === 'paid');

// 5. quantity>1 被拒绝
r = await req('/api/orders', { method: 'POST', body: { item_type: 'writing_fulltext', quantity: 3, payment_method: 'mock', params: { project_id: projectId } } });
check('quantity>1 被拒绝', r.status === 400, r.data.error || '');

// 6. 按产品流程逐章生成、逐章确认；首章传订单，后续自动复用项目套餐，不重复付费。
let workflowState = 'chapter_generating';
let chaptersConfirmed = 0;
for (let i = 0; i < 15 && workflowState !== 'final_review'; i++) {
  r = await req(`/api/workflow/${projectId}/chapters/current/generate`, {
    method: 'POST', body: i === 0 ? { orderNo } : {},
  });
  check(`生成第 ${i + 1} 章`, r.status === 200 && r.data.workflow?.state === 'chapter_review', r.data.error || '');
  if (r.status !== 200) break;
  const currentIndex = r.data.workflow.currentChapterIndex;
  const chapter = r.data.workflow.project?.chapters?.[currentIndex];
  r = await req(`/api/workflow/${projectId}/chapters/current/confirm`, {
    method: 'POST', body: { chapterId: chapter?.id, content: chapter?.content },
  });
  check(`确认第 ${i + 1} 章`, r.status === 200, r.data.error || '');
  if (r.status !== 200) break;
  chaptersConfirmed += 1;
  workflowState = r.data.workflow?.state;
}
check('逐章流程进入全文检查', workflowState === 'final_review' && chaptersConfirmed > 0, `confirmed=${chaptersConfirmed}, state=${workflowState}`);
r = await req(`/api/workflow/${projectId}/final-check`, { method: 'POST' });
check('全文一致性检查返回可定位报告', r.status === 200 && Array.isArray(r.data.check?.checks), r.data.error || '');

// 7. 文献检索指标已进入后台运行监控聚合。
r = await req('/api/auth/login', { method: 'POST', auth: false, body: { email: process.env.ADMIN_EMAIL || 'admin@scholarforge.com', password: process.env.ADMIN_PASSWORD || 'Admin123456' } });
const adminToken = r.data?.token;
r = await req('/api/admin/operational-metrics?hours=24', { tk: adminToken });
check('运行监控记录检索指标', r.status === 200 && (r.data.rows || []).some((item) => item.metric === 'reference_search'), r.data.error || '');

// 8. smart-writing：真实结果才算成功；降级空模板必须明确失败且订单可重试
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
  r = await req(`/api/orders/${lrOrderNo}`);
  check('降级失败不标记订单完成且可重试', r.data.status === 'paid' && r.data.service_status === 'failed', JSON.stringify(r.data));
}

console.log('\n=== 冒烟测试结束 ===');
