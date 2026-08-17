const BASE = '/api';

const TOKEN_KEY = 'sf_token';
const REFRESH_KEY = 'sf_refresh';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

function setTokens(accessToken, refreshToken) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// 是否处于受保护路径（公开页 401 不强制跳转）
function isProtectedPath() {
  const p = window.location.pathname;
  return p.startsWith('/app') || p.startsWith('/admin');
}

// 跳转到登录页（带 redirect）
function redirectToLogin() {
  const p = window.location.pathname + window.location.search;
  window.location.href = '/login?redirect=' + encodeURIComponent(p);
}

// ===== 401 自动刷新：access token 过期时，用 refresh token 换新的，重试原请求 =====
let refreshingPromise = null;

async function doRefresh() {
  // 单飞：并发 401 时只刷新一次，其余等待同一 Promise
  if (refreshingPromise) return refreshingPromise;
  const rt = getRefreshToken();
  if (!rt) return false;
  refreshingPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.accessToken) return false;
      setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshingPromise = null;
    }
  })();
  return refreshingPromise;
}

async function request(path, { method = 'GET', body, auth = true, headers = {}, _retried = false } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (auth) {
    const token = getToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('网络连接失败，请检查网络后重试');
  }
  // 401 自动刷新重试（仅认证请求且未重试过且非 /auth/refresh 自身）
  if (res.status === 401 && auth && !_retried && !path.startsWith('/auth/refresh')) {
    const ok = await doRefresh();
    if (ok) {
      return request(path, { method, body, auth, headers, _retried: true });
    }
    // 刷新失败：清理并跳转（仅受保护路径）
    clearTokens();
    if (isProtectedPath()) redirectToLogin();
  }
  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || `请求失败 (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    err.data = data;
    throw err;
  }
  return data;
}

// 文件上传
async function upload(path, file, fields = {}, _retried = false) {
  const fd = new FormData();
  fd.append('file', file);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const h = {};
  const token = getToken();
  if (token) h.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers: h, body: fd });
  } catch (e) {
    throw new Error('网络连接失败，请检查网络后重试');
  }
  // 401 自动刷新重试（仅一次，防无限循环）
  if (res.status === 401 && !_retried) {
    const ok = await doRefresh();
    if (ok) {
      return upload(path, file, fields, true);
    }
    clearTokens();
    if (isProtectedPath()) redirectToLogin();
  }
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.error || `上传失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  // ===== auth =====
  register: async (payload) => {
    const data = await request('/auth/register', { method: 'POST', body: payload, auth: false });
    if (data.accessToken) setTokens(data.accessToken, data.refreshToken);
    return data;
  },
  login: async (payload) => {
    const data = await request('/auth/login', { method: 'POST', body: payload, auth: false });
    if (data.accessToken) setTokens(data.accessToken, data.refreshToken);
    return data;
  },
  logout: async () => {
    const rt = getRefreshToken();
    try {
      await request('/auth/logout', { method: 'POST', body: { refreshToken: rt } });
    } catch { /* ignore */ }
    clearTokens();
  },
  me: () => request('/auth/me'),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),
  resetPassword: (payload) => request('/auth/reset-password', { method: 'POST', body: payload, auth: false }),

  // ===== public / 站点信息 =====
  getSite: () => request('/public/site', { auth: false }),
  getStatus: () => request('/public/status'),
  getPointsPackages: () => request('/membership/points-packages', { auth: false }),
  getChannels: () => request('/membership/channels', { auth: false }),

  // ===== tools =====
  writing: (payload) => request('/tools/writing', { method: 'POST', body: payload }),
  proposal: (payload) => request('/tools/proposal', { method: 'POST', body: payload }),
  polish: (payload) => request('/tools/polish', { method: 'POST', body: payload }),
  translate: (payload) => request('/tools/translate', { method: 'POST', body: payload }),
  grammar: (payload) => request('/tools/grammar', { method: 'POST', body: payload }),
  rewrite: (payload) => request('/tools/rewrite', { method: 'POST', body: payload }),
  formatReference: (payload) => request('/tools/format-reference', { method: 'POST', body: payload }),
  // ===== 借鉴千笔写作新增工具 =====
  aiReduce: (payload) => request('/tools/ai-reduce', { method: 'POST', body: payload }),
  literatureReview: (payload) => request('/tools/literature-review', { method: 'POST', body: payload }),
  taskBook: (payload) => request('/tools/task-book', { method: 'POST', body: payload }),
  defense: (payload) => request('/tools/defense', { method: 'POST', body: payload }),
  journal: (payload) => request('/tools/journal', { method: 'POST', body: payload }),

  // ===== 文档（旧 documents 表，文本草稿） =====
  listDocuments: () => request('/documents'),
  saveDocument: (payload) => request('/documents', { method: 'POST', body: payload }),
  updateDocument: (id, payload) => request(`/documents/${id}`, { method: 'PUT', body: payload }),
  deleteDocument: (id) => request(`/documents/${id}`, { method: 'DELETE' }),

  // ===== 参考文献 =====
  searchRefs: (q) => request(`/references/search?q=${encodeURIComponent(q || '')}`),
  listRefs: () => request('/references'),
  addRef: (payload) => request('/references', { method: 'POST', body: payload }),
  deleteRef: (id) => request(`/references/${id}`, { method: 'DELETE' }),
  formatRefs: (payload) => request('/references/format', { method: 'POST', body: payload }),
  formatPreview: (payload) => request('/references/format-preview', { method: 'POST', body: payload }),

  // ===== 支付 =====
  createOrder: (payload) => request('/payment/create-order', { method: 'POST', body: payload }),
  mockPay: (orderNo) => request(`/payment/mock/${orderNo}`, { method: 'POST' }),
  alipayQrcode: (orderNo) => request(`/payment/alipay/qrcode/${orderNo}`),
  wechatQrcode: (orderNo) => request(`/payment/wechat/qrcode/${orderNo}`),
  orderStatus: (orderNo) => request(`/payment/order/${orderNo}/status`),

  // ===== 我的订单 =====
  listOrders: (params) => request(`/orders?${new URLSearchParams(params).toString()}`),
  orderDetail: (orderNo) => request(`/orders/${orderNo}`),

  // ===== 我的积分 =====
  myPoints: () => request('/membership/status'),
  myPointsLog: (params) => request(`/courses/log?${new URLSearchParams(params || {}).toString()}`),
  myQuota: () => request('/courses/quota'),

  // ===== 课程（论文 1 对 1 指导） =====
  listCourses: () => request('/courses'),
  myCourses: () => request('/courses/my'),
  courseQuote: (payload) => request('/courses/quote', { method: 'POST', body: payload }),

  // ===== 模板 =====
  listTemplates: () => request('/templates'),
  uploadTemplate: (file, name) => upload('/templates/upload', file, name ? { name } : {}),
  deleteTemplate: (id) => request(`/templates/${id}`, { method: 'DELETE' }),

  // ===== 生成文档（Word） =====
  listDocs: () => request('/docs'),
  deleteDoc: (id) => request(`/docs/${id}`, { method: 'DELETE' }),
  downloadDoc: async (id) => {
    const token = getToken();
    let res = await fetch(`${BASE}/docs/download/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    // 401 自动刷新重试
    if (res.status === 401) {
      const ok = await doRefresh();
      if (ok) {
        const newToken = getToken();
        res = await fetch(`${BASE}/docs/download/${id}`, {
          headers: newToken ? { Authorization: `Bearer ${newToken}` } : {},
        });
      }
    }
    if (!res.ok) {
      let msg = `下载失败 (${res.status})`;
      try { const d = await res.json(); msg = d.error || msg; } catch {}
      throw new Error(msg);
    }
    return res.blob();
  },

  // ===== admin: 概览 =====
  adminOverview: () => request('/admin/overview'),

  // ===== admin: 积分套餐 =====
  adminListPointsPackages: () => request('/admin/points-packages'),
  adminSavePointsPackage: (payload) => request('/admin/points-packages', { method: 'POST', body: payload }),
  adminDeletePointsPackage: (id) => request(`/admin/points-packages/${id}`, { method: 'DELETE' }),
  // 兼容旧接口
  adminListCourses: () => request('/admin/courses'),
  adminSaveCourse: (payload) => request('/admin/courses', { method: 'POST', body: payload }),
  adminDeleteCourse: (id) => request(`/admin/courses/${id}`, { method: 'DELETE' }),
  // 课程对接管理
  adminListCourseOrders: (params) => request(`/admin/course-orders?${new URLSearchParams(params).toString()}`),
  adminUpdateCourseContact: (id, status) => request(`/admin/course-orders/${id}/contact-status`, { method: 'PUT', body: { status } }),

  // ===== support: 客服工作台 =====
  supportOverview: () => request('/support/overview'),
  supportListCourseOrders: (params) => request(`/support/course-orders?${new URLSearchParams(params).toString()}`),
  supportUpdateCourseContact: (id, status) => request(`/support/course-orders/${id}/contact-status`, { method: 'PUT', body: { status } }),
  supportListCourses: () => request('/support/courses'),

  // ===== admin: 订单 =====
  adminListOrders: (params) => request(`/admin/orders?${new URLSearchParams(params).toString()}`),
  adminRefundOrder: (orderNo, reason) => request(`/admin/orders/${orderNo}/refund`, { method: 'POST', body: { reason } }),

  // ===== admin: 模板 =====
  adminListTemplates: () => request('/admin/templates'),
  adminDeleteTemplate: (id) => request(`/admin/templates/${id}`, { method: 'DELETE' }),

  // ===== admin: 模型 =====
  adminListModels: () => request('/admin/models'),
  adminCreateModel: (payload) => request('/admin/models', { method: 'POST', body: payload }),
  adminUpdateModel: (id, payload) => request(`/admin/models/${id}`, { method: 'PUT', body: payload }),
  adminDeleteModel: (id) => request(`/admin/models/${id}`, { method: 'DELETE' }),
  adminTestModel: (id) => request(`/admin/models/${id}/test`, { method: 'POST' }),

  // ===== admin: 系统设置 =====
  adminGetSettings: () => request('/admin/settings'),
  adminUpdateSettings: (payload) => request('/admin/settings', { method: 'PUT', body: payload }),
  adminUploadWechatQrcode: (file) => upload('/admin/settings/wechat-qrcode', file),
  adminDeleteWechatQrcode: () => request('/admin/settings/wechat-qrcode', { method: 'DELETE' }),

  // ===== admin: 用户 =====
  adminListUsers: (params) => request(`/admin/users?${new URLSearchParams(params).toString()}`),
  adminCreateUser: (payload) => request('/admin/users', { method: 'POST', body: payload }),
  adminUpdateUser: (id, payload) => request(`/admin/users/${id}`, { method: 'PUT', body: payload }),
  adminDeleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminAdjustPoints: (id, payload) => request(`/admin/users/${id}/points`, { method: 'PUT', body: payload }),
  adminGrantPoints: (id, payload) => request(`/admin/users/${id}/grant-points`, { method: 'POST', body: payload }),
  // 兼容旧接口
  adminAdjustQuota: (id, payload) => request(`/admin/users/${id}/quota`, { method: 'PUT', body: payload }),
  adminGrantCourse: (id, courseId) => request(`/admin/users/${id}/grant-course`, { method: 'POST', body: { course_id: courseId } }),

  // ===== admin: 日志 =====
  adminListLogs: (params) => request(`/admin/logs?${new URLSearchParams(params).toString()}`),

  // ===== admin: 财务 =====
  adminFinance: (params) => request(`/admin/finance?${new URLSearchParams(params).toString()}`),

  // ===== 毕业作品指导制作 =====
  listGraduationProjects: () => request('/graduation'),
  listGraduationProjectsPublic: () => request('/graduation', { auth: false }),
  getGraduationProject: (id) => request(`/graduation/${id}`),
  myGraduationOrders: () => request('/graduation/my/orders'),
  createGraduationOrder: (projectId, requirements) => request('/graduation/orders', { method: 'POST', body: { project_id: projectId, requirements } }),
  payGraduationOrder: (id) => request(`/graduation/orders/${id}/pay`, { method: 'POST' }),

  // ===== admin: 毕业作品管理 =====
  adminListGraduationProjects: () => request('/admin/graduation'),
  adminSaveGraduationProject: (payload) => request('/admin/graduation', { method: 'POST', body: payload }),
  adminDeleteGraduationProject: (id) => request(`/admin/graduation/${id}`, { method: 'DELETE' }),
  adminListGraduationOrders: (params) => request(`/admin/graduation-orders?${new URLSearchParams(params).toString()}`),
  adminUpdateGraduationContact: (id, status) => request(`/admin/graduation-orders/${id}/contact-status`, { method: 'PUT', body: { status } }),
  adminQuoteGraduationOrder: (id, quoted_price) => request(`/admin/graduation-orders/${id}/quote`, { method: 'PUT', body: { quoted_price } }),
  adminCreateGraduationOrder: (payload) => request('/admin/graduation-orders', { method: 'POST', body: payload }),

  // ===== support: 毕业作品订单查看 =====
  supportListGraduationOrders: (params) => request(`/support/graduation-orders?${new URLSearchParams(params).toString()}`),
  supportUpdateGraduationContact: (id, status) => request(`/support/graduation-orders/${id}/contact-status`, { method: 'PUT', body: { status } }),

  // ===== 论文工作区 =====
  listProjects: () => request('/projects'),
  createProject: (data) => request('/projects', { method: 'POST', body: data }),
  getProject: (id) => request(`/projects/${id}`),
  updateProject: (id, data) => request(`/projects/${id}`, { method: 'PUT', body: data }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  previewProjectContext: (id, params) => request(`/projects/${id}/context-preview?${new URLSearchParams(params).toString()}`),
  listProjectTasks: (id, params) => request(`/projects/${id}/tasks?${new URLSearchParams(params).toString()}`),

  // ===== 任务历史 =====
  listTasks: (params) => request(`/tasks?${new URLSearchParams(params).toString()}`),
  getTask: (id) => request(`/tasks/${id}`),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
};

// 触发浏览器下载某个已生成的 Word 文档
export async function downloadDocFile(id, filename = '文档.docx') {
  const blob = await api.downloadDoc(id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
