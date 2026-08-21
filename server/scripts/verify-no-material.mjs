// 验证：不上传资料直接生成（可选性）
const BASE = 'http://127.0.0.1:3001';

async function req(path, { method = 'GET', body, tk = null } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (tk) h.Authorization = `Bearer ${tk}`;
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

// 管理员建新用户
let r = await req('/api/auth/login', { method: 'POST', body: { email: 'admin@scholarforge.com', password: 'Admin123456' } });
const at = r.data.token;
const email = `nomat_${Date.now()}@test.com`;
await req('/api/admin/users', { method: 'POST', tk: at, body: { email, password: 'pass1234', name: '无材料验证' } });
r = await req('/api/auth/login', { method: 'POST', body: { email, password: 'pass1234' } });
const ut = r.data.token;

// 1. 大纲生成（免费，无材料）→ 应直接成功
r = await req('/api/tools/writing', { method: 'POST', tk: ut, body: { type: 'outline', topic: '无材料直接生成验证', field: '计算机科学' } });
console.log('大纲生成(无材料):', r.status, r.data.chargeType || r.data.error || '');

// 2. 付费功能（开题报告）无材料 → needOrder 金额=纯功能价 → 支付 → 生成
r = await req('/api/tools/proposal', { method: 'POST', tk: ut, body: { topic: '无材料验证课题', field: '计算机科学' } });
console.log('needOrder(无材料):', r.status, JSON.stringify({ amount: r.data.amount, materialFee: r.data.materialFee, materialIds: r.data.materialIds }));
r = await req('/api/orders', { method: 'POST', tk: ut, body: { item_type: 'proposal', quantity: 1, payment_method: 'mock' } });
const orderNo = r.data.order?.order_no;
await req(`/api/payment/mock/${orderNo}`, { method: 'POST', tk: ut });
r = await req('/api/tools/proposal', { method: 'POST', tk: ut, body: { topic: '无材料验证课题', field: '计算机科学', orderNo } });
console.log('生成(无材料):', r.status, r.data.content ? 'OK' : (r.data.error || 'FAIL'));
