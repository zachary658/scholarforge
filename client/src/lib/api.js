const BASE = '/api';

// 安全：access token 改为内存变量存储，不再持久化到 localStorage，降低 XSS 窃取面（M-3）。
// refresh token 仍为 HttpOnly Cookie，由浏览器自动携带；页面刷新后通过 bootstrapToken() 静默续期。
let memoryToken = null;

function getToken() {
  return memoryToken;
}

function setToken(accessToken) {
  memoryToken = accessToken;
}

export function clearTokens() {
  memoryToken = null;
}

// 页面加载 / 会话恢复时调用：若内存中无 token，尝试用 HttpOnly refresh cookie 静默换取新 access token。
// 返回是否成功获得可用 token（成功则上层可继续调用 /auth/me 恢复用户态）。
export async function bootstrapToken() {
  if (getToken()) return true;
  return doRefresh();
}

// 是否处于受保护路径（公开页 401 不强制跳转）
function isProtectedPath() {
  const p = window.location.pathname;
  return p.startsWith('/app') || p.startsWith('/admin') || p.startsWith('/support');
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
  refreshingPromise = (async () => {
    try {
      // refresh token 经 HttpOnly Cookie 自动携带，无需从 localStorage 读取
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.accessToken) return false;
      setToken(data.accessToken);
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
      credentials: 'include',
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
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers: h, body: fd, credentials: 'include' });
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
    if (data.accessToken) setToken(data.accessToken);
    return data;
  },
  login: async (payload) => {
    const data = await request('/auth/login', { method: 'POST', body: payload, auth: false });
    if (data.accessToken) setToken(data.accessToken);
    return data;
  },
  logout: async () => {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    clearTokens();
  },
  me: () => request('/auth/me'),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),
  resetPassword: (payload) => request('/auth/reset-password', { method: 'POST', body: payload, auth: false }),
  changePassword: (payload) => request('/auth/change-password', { method: 'POST', body: payload }),
  agreeAcademicIntegrity: () => request('/auth/academic-integrity', { method: 'POST', body: { agreed: true } }),

  // ===== public / 站点信息 =====
  getSite: () => request('/public/site', { auth: false }),
  getChannels: () => request('/membership/channels', { auth: false }),
  getFeatures: () => request('/membership/features', { auth: false }),

  // ===== tools =====
  writing: (payload) => request('/tools/writing', { method: 'POST', body: payload }),
  // 深度文献调研：多角度检索 → 解析研究框架 → 大纲（需已支付的 literature_review 订单）
  smartWriting: (payload) => request('/tools/smart-writing', { method: 'POST', body: payload }),
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
  // ===== 专利申请 / 期刊发表辅助工具 =====
  patentDraft: (payload) => request('/tools/patent-draft', { method: 'POST', body: payload }),
  reviewReply: (payload) => request('/tools/review-reply', { method: 'POST', body: payload }),

  // ===== 写作参考材料（上传解读 / 列表 / 删除） =====
  uploadMaterial: (file, fields = {}) => upload('/materials/upload', file, fields),
  listMaterials: (params) => request(`/materials?${new URLSearchParams(params || {}).toString()}`),
  deleteMaterial: (id) => request(`/materials/${id}`, { method: 'DELETE' }),

  // ===== 专利申请服务 =====
  getPatentTypes: () => request('/patent', { auth: false }),
  myPatentOrders: () => request('/patent/my/orders'),
  createPatentOrder: (payload) => request('/patent/orders', { method: 'POST', body: payload }),
  payPatentOrder: (id) => request(`/patent/orders/${id}/pay`, { method: 'POST' }),

  // ===== 期刊发表服务 =====
  getJournalLevels: () => request('/publication', { auth: false }),
  myPublicationOrders: () => request('/publication/my/orders'),
  createPublicationOrder: (payload) => request('/publication/orders', { method: 'POST', body: payload }),
  payPublicationOrder: (id) => request(`/publication/orders/${id}/pay`, { method: 'POST' }),

  // ===== 整篇文档改写（降重 / 降AI率：上传 docx，保留格式与图表） =====
  rewriteDoc: (file, orderNo) => {
    const fields = {};
    if (orderNo) fields.orderNo = orderNo;
    return upload('/tools/rewrite-doc', file, fields);
  },
  aiReduceDoc: (file, orderNo) => {
    const fields = {};
    if (orderNo) fields.orderNo = orderNo;
    return upload('/tools/ai-reduce-doc', file, fields);
  },

  // ===== 文档（旧 documents 表，文本草稿） =====
  listDocuments: () => request('/documents'),
  saveDocument: (payload) => request('/documents', { method: 'POST', body: payload }),
  updateDocument: (id, payload) => request(`/documents/${id}`, { method: 'PUT', body: payload }),
  deleteDocument: (id) => request(`/documents/${id}`, { method: 'DELETE' }),

  // ===== 参考文献 =====
  searchRefs: (q) => request(`/references/search?q=${encodeURIComponent(q || '')}`),
  listRefs: (params = {}) => request(`/references?${new URLSearchParams(params).toString()}`),
  addRef: (payload) => request('/references', { method: 'POST', body: payload }),
  deleteRef: (id) => request(`/references/${id}`, { method: 'DELETE' }),
  formatRefs: (payload) => request('/references/format', { method: 'POST', body: payload }),
  formatPreview: (payload) => request('/references/format-preview', { method: 'POST', body: payload }),

  // ===== 支付（课程 / 毕业作品，保留独立流程） =====
  createOrder: (payload) => request('/payment/create-order', { method: 'POST', body: payload }),
  mockPay: (orderNo) => request(`/payment/mock/${orderNo}`, { method: 'POST' }),
  alipayQrcode: (orderNo) => request(`/payment/alipay/qrcode/${orderNo}`),
  wechatQrcode: (orderNo) => request(`/payment/wechat/qrcode/${orderNo}`),
  orderStatus: (orderNo) => request(`/payment/order/${orderNo}/status`),

  // ===== 功能订单（现金直付：固定价 / 人工报价） =====
  createFeatureOrder: (payload) => request('/orders', { method: 'POST', body: payload }),
  requestQuote: (payload) => request('/orders/request-quote', { method: 'POST', body: payload }),
  payOrder: (orderNo, payload) => request(`/orders/${orderNo}/pay`, { method: 'POST', body: payload }),

  // ===== 我的订单 =====
  listOrders: (params) => request(`/orders?${new URLSearchParams(params).toString()}`),
  orderDetail: (orderNo) => request(`/orders/${orderNo}`),

  // ===== 课程（论文 1 对 1 指导） =====
  listCourses: () => request('/courses'),
  myCourses: () => request('/courses/my'),
  courseQuote: (payload) => request('/courses/quote', { method: 'POST', body: payload }),

  // ===== 模板 =====
  listTemplates: () => request('/templates'),
  uploadTemplate: (file, name) => upload('/templates/upload', file, name ? { name } : {}),
  deleteTemplate: (id) => request(`/templates/${id}`, { method: 'DELETE' }),

  // ===== 生成文档（Word） =====
  listDocs: (params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== '')).toString();
    return request(`/docs${query ? `?${query}` : ''}`);
  },
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

  // ===== admin: 功能定价（现金直付：固定价 / 人工报价） =====
  adminListFeatures: () => request('/admin/features'),
  adminSaveFeature: (payload) => request('/admin/features', { method: 'POST', body: payload }),
  adminDeleteFeature: (key) => request(`/admin/features/${key}`, { method: 'DELETE' }),

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

  // ===== admin: 订单（现金直付功能订单 + 课程/毕业作品订单） =====
  adminListOrders: (params) => request(`/admin/orders?${new URLSearchParams(params).toString()}`),
  adminQuoteOrder: (id, payload) => request(`/admin/orders/${id}/quote`, { method: 'POST', body: payload }),
  adminMarkPaid: (id) => request(`/admin/orders/${id}/mark-paid`, { method: 'POST' }),

  // ===== admin: 模板 =====
  adminListTemplates: () => request('/admin/templates'),
  adminDeleteTemplate: (id) => request(`/admin/templates/${id}`, { method: 'DELETE' }),

  // ===== admin: 模型（预设目录 + 环境变量 Key，后台仅支持选择默认模型与测试连接） =====
  adminListModels: () => request('/admin/models'),
  adminSetDefaultModel: (key) => request('/admin/models/default', { method: 'PUT', body: { key } }),
  adminTestModel: (key) => request(`/admin/models/${key}/test`, { method: 'POST' }),

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
  adminApproveGraduationQuote: (id, status) => request(`/admin/graduation-orders/${id}/quote-status`, { method: 'PUT', body: { status } }),
  adminCreateGraduationOrder: (payload) => request('/admin/graduation-orders', { method: 'POST', body: payload }),

  // ===== support: 毕业作品订单查看 =====
  supportListGraduationOrders: (params) => request(`/support/graduation-orders?${new URLSearchParams(params).toString()}`),
  supportUpdateGraduationContact: (id, status) => request(`/support/graduation-orders/${id}/contact-status`, { method: 'PUT', body: { status } }),
  supportQuoteGraduationOrder: (id, quoted_price) => request(`/support/graduation-orders/${id}/quote`, { method: 'POST', body: { quoted_price } }),

  // ===== support: 跟进备注 =====
  supportListNotes: (orderType, orderRefId) => request(`/support/notes?order_type=${orderType}&order_ref_id=${orderRefId}`),
  supportAddNote: (orderType, orderRefId, content) => request('/support/notes', { method: 'POST', body: { order_type: orderType, order_ref_id: orderRefId, content } }),

  // ===== support: 专利申请 / 期刊发表对接 =====
  supportListPatentOrders: (params) => request(`/support/patent-orders?${new URLSearchParams(params).toString()}`),
  supportUpdatePatentContact: (id, status) => request(`/support/patent-orders/${id}/contact-status`, { method: 'PUT', body: { status } }),
  supportQuotePatentOrder: (id, quoted_price) => request(`/support/patent-orders/${id}/quote`, { method: 'POST', body: { quoted_price } }),
  supportListPublicationOrders: (params) => request(`/support/publication-orders?${new URLSearchParams(params).toString()}`),
  supportUpdatePublicationContact: (id, status) => request(`/support/publication-orders/${id}/contact-status`, { method: 'PUT', body: { status } }),
  supportQuotePublicationOrder: (id, quoted_price) => request(`/support/publication-orders/${id}/quote`, { method: 'POST', body: { quoted_price } }),

  // ===== admin: 专利申请 / 期刊发表管理 =====
  adminListPatentOrders: (params) => request(`/admin/patent-orders?${new URLSearchParams(params).toString()}`),
  adminUpdatePatentContact: (id, status) => request(`/admin/patent-orders/${id}/contact-status`, { method: 'PUT', body: { status } }),
  adminApprovePatentQuote: (id, status) => request(`/admin/patent-orders/${id}/quote-status`, { method: 'PUT', body: { status } }),
  adminListPublicationOrders: (params) => request(`/admin/publication-orders?${new URLSearchParams(params).toString()}`),
  adminUpdatePublicationContact: (id, status) => request(`/admin/publication-orders/${id}/contact-status`, { method: 'PUT', body: { status } }),
  adminApprovePublicationQuote: (id, status) => request(`/admin/publication-orders/${id}/quote-status`, { method: 'PUT', body: { status } }),

  // ===== 论文工作区 =====
  listProjects: () => request('/projects'),
  createProject: (data) => request('/projects', { method: 'POST', body: data }),
  getProject: (id) => request(`/projects/${id}`),
  updateProject: (id, data) => request(`/projects/${id}`, { method: 'PUT', body: data }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  previewProjectContext: (id, params) => request(`/projects/${id}/context-preview?${new URLSearchParams(params).toString()}`),
  listProjectTasks: (id, params) => request(`/projects/${id}/tasks?${new URLSearchParams(params).toString()}`),
  getProjectEvidence: (id, params = {}) => request(`/projects/${id}/evidence?${new URLSearchParams(params).toString()}`),
  rebuildProjectEvidence: (id) => request(`/projects/${id}/evidence/rebuild`, { method: 'POST' }),

  // ===== 阶段三：大纲确认 + 分章节生成 =====
  confirmOutline: (id) => request(`/projects/${id}/outline/confirm`, { method: 'POST' }),
  getChapters: (id) => request(`/projects/${id}/chapters`),
  generateChapters: (id, payload) => request(`/projects/${id}/chapters/generate`, { method: 'POST', body: payload }),
  regenerateChapter: (id, chapterId, payload) => request(`/projects/${id}/chapters/${chapterId}/regenerate`, { method: 'POST', body: payload }),
  editChapter: (id, chapterId, content) => request(`/projects/${id}/chapters/${chapterId}`, { method: 'PUT', body: { content } }),
  mergeChapters: (id, body = {}) => request(`/projects/${id}/chapters/merge`, { method: 'POST', body }),

  // ===== 完整论文工作流（阶段三升级：状态机驱动的论文生产流程） =====
  startFullPaperWorkflow: (id, meta) => request(`/workflow/${id}/start`, { method: 'POST', body: meta || {} }),
  getWorkflowState: (id) => request(`/workflow/${id}/state`),
  confirmLiterature: (id, references) => request(`/workflow/${id}/literature/confirm`, { method: 'POST', body: { references } }),
  saveOutlineValidated: (id, payload) => request(`/workflow/${id}/outline`, { method: 'POST', body: payload }),
  confirmOutlineValidated: (id) => request(`/workflow/${id}/outline/confirm`, { method: 'POST' }),
  generateCurrentChapter: (id, orderNo) => request(`/workflow/${id}/chapters/current/generate`, { method: 'POST', body: orderNo ? { orderNo } : {} }),
  confirmCurrentChapter: (id) => request(`/workflow/${id}/chapters/current/confirm`, { method: 'POST' }),
  backToChapter: (id, index) => request(`/workflow/${id}/chapters/back`, { method: 'POST', body: { index } }),
  runFinalCheck: (id) => request(`/workflow/${id}/final-check`, { method: 'POST' }),
  generateFinalDocument: (id, payload) => request(`/workflow/${id}/final-document`, { method: 'POST', body: payload || {} }),
  getExpertConsult: (id) => request(`/workflow/${id}/expert-consult`),

  // ===== 数据图表 =====
  uploadChart: (file) => upload('/charts/upload', file),
  renderChart: (payload) => request('/charts/render', { method: 'POST', body: payload }),
  listCharts: (params = {}) => request(`/charts?${new URLSearchParams(params).toString()}`),
  insertChart: (id, payload) => request(`/charts/${id}/insert`, { method: 'POST', body: payload }),

  // ===== 降AI率（多版本） =====
  aiReduceVersions: (payload) => request('/tools/ai-reduce-versions', { method: 'POST', body: payload }),

  // ===== 任务历史 =====
  listTasks: (params) => request(`/tasks?${new URLSearchParams(params).toString()}`),
  getTask: (id) => request(`/tasks/${id}`),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  retryTask: (id) => request(`/tasks/${id}/retry`, { method: 'POST' }),
};

// 触发浏览器下载某个已生成的 Word 文档
export async function downloadDocFile(id, filename = '文档.docx') {
  const blob = await api.downloadDoc(id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  // Firefox 等浏览器在 click() 后立即 revoke 会导致下载失败：延迟 1s 再释放
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}
