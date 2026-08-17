# ScholarForge 安全审查报告

审查范围：`client/`（React 18 + Vite）与 `server/`（Node.js + Express 4 + better-sqlite3）
审查依据：OWASP 及 Node/Express/React 安全最佳实践
日期：2026-08-17

## 执行摘要

整体而言，这套代码的安全基线相当扎实：认证采用 JWT 双 token + `token_version` 主动失效 + refresh token 哈希入库轮换；密码使用 bcrypt 哈希且带强度校验；登录/注册/忘记密码均有速率限制与防枚举；支付回调走官方 SDK 验签并做金额一致性校验；SQL 全部参数化；文档下载有路径穿越防护；`.env` 已正确加入 `.gitignore`，未发现硬编码密钥。

本次共发现 **3 项中危、4 项低危**，无直接的 SQL 注入、XSS 逃逸、支付绕过或路径穿越等高危漏洞。中危项集中在令牌存储、开放重定向与管理员可配置的 SSRF 面。

---

## 中危（Medium）

### [M-01] Access / Refresh Token 存于 localStorage，XSS 可导致账号接管
- **位置**：`client/src/lib/api.js` L3-L22（`TOKEN_KEY`/`REFRESH_KEY`、`setTokens`）、`client/src/lib/auth.jsx` L11
- **证据**：
  ```js
  const TOKEN_KEY = 'sf_token';
  const REFRESH_KEY = 'sf_refresh';
  function setTokens(accessToken, refreshToken) {
    localStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  }
  ```
- **影响**：一旦发生 XSS（或第三方脚本被污染），攻击者可同时窃取 access token（15 分钟）与 refresh token（7 天），实现账号接管并在较长窗口内保持控制。
- **缓解现状**：前端未使用 `dangerouslySetInnerHTML`，React 默认转义，XSS 面较小；认证用 `Authorization: Bearer` 头而非 Cookie，因此无 CSRF 风险。
- **建议**：refresh token 改由服务端下发 `HttpOnly + SameSite` Cookie（需同时引入 CSRF 防护，因 Cookie 认证会引入 CSRF）；或至少将 refresh token 移出 `localStorage`（存内存 + 短期重登）。若维持现状，需明确接受该风险并保持 CSP 严格。

### [M-02] 登录跳转的 `redirect` 参数未校验，存在开放重定向
- **位置**：`client/src/pages/Login.jsx` L32-L34
- **证据**：
  ```js
  const redirect = params.get('redirect');
  if (redirect) {
    navigate(redirect);
  }
  ```
- **影响**：攻击者可构造 `/login?redirect=//evil.com`（或 `https://evil.com`）钓鱼链接，用户登录成功后跳转到恶意站点，配合伪造的登录页可窃取凭据。
- **建议**：仅允许站内相对路径。例如：
  ```js
  const safe = redirect && /^\/(?!\/)/.test(redirect) ? redirect : null;
  ```
  校验失败回退到默认首页（`/app`、`/admin`、`/support`）。

### [M-03] 管理员可配置 AI `base_url` 引发的服务端 SSRF 面
- **位置**：`server/src/routes/admin.js` L495-L527（`POST /admin/models/:id/test` 中 `fetch(m.base_url ...)`）；`server/src/services/ai-service.js` L160（AI 调用同样使用配置的 `base_url`）
- **证据**：
  ```js
  const url = m.base_url.replace(/\/$/, '') + '/chat/completions';
  const r = await fetch(url, { ... });
  ```
- **影响**：`base_url` 由管理员写入并持久化，服务端会对其发起请求。若该账号被攻破，或部署在云环境，可被用来探测内网 / 云元数据端点（`http://169.254.169.254`）等。因仅管理员可达，评级为中危而非高危。
- **建议**：在发起请求前对 `base_url` 做校验——仅允许 `https://`（必要时放行 `http://` 且仅内网白名单），并解析后拒绝回环地址、链路本地地址、云元数据 IP；同时设置 DNS 解析后的 IP 校验与超时（已有时长超时）。

---

## 低危（Low）

### [L-01] 文件上传仅校验扩展名，未校验真实文件类型
- **位置**：`server/src/routes/admin.js` L46-L81（模板 `.docx`、二维码图片）、`server/src/routes/templates.js` L15-L27
- **证据**：`fileFilter` 仅检查 `file.originalname.toLowerCase().endsWith('.docx')` / 图片扩展名。
- **影响**：攻击者可上传改扩展名的任意内容（如把 HTML/脚本命名为 `.docx`）。但上传接口为 `adminRequired`，且文件不以 inline HTML 形式回显、下载时用 `Content-Disposition: attachment`，实际利用面很小。
- **建议**：增加 magic-byte / MIME 校验（docx 为 `PK\x03\x04` 的 ZIP，图片校验文件头），并保持现有随机文件名与大小限制。

### [L-02] `trust proxy` 依赖部署配置，未配置时限流与风控 IP 失真
- **位置**：`server/src/index.js` L41-L44；`server/src/routes/auth.js` L27-L51、L60-L63（`getClientIp`）
- **证据**：仅当设置 `TRUST_PROXY` 时才 `app.set('trust proxy', ...)`。
- **影响**：若生产部署在 Nginx/网关后而未设置 `TRUST_PROXY`，`req.ip` 恒为代理 IP，导致全局限流、登录/注册限流、同 IP 注册风控对**所有用户共享同一桶**（可被误伤或绕过）。
- **建议**：生产部署文档明确要求设置 `TRUST_PROXY`（信任层数或精确值），并确保前置代理覆盖/剥离 `X-Forwarded-*` 头。

### [L-03] 速率限制使用内存存储，多实例/重启后失效
- **位置**：`server/src/index.js` L83-L94、`server/src/routes/auth.js` L27-L51（`express-rate-limit` 未配置 `store`）
- **影响**：限流计数存于进程内存，重启即清零；横向扩容多实例时各实例独立计数，可被绕过。
- **建议**：如需生产级防护，接入共享存储（Redis `rate-limit-redis`）或由网关层统一限流。

### [L-04] `isProtectedPath` 未覆盖 `/support` 路由
- **位置**：`client/src/lib/api.js` L25-L28
- **证据**：`return p.startsWith('/app') || p.startsWith('/admin');`
- **影响**：客服工作台（`/support`）下 access token 失效并 refresh 失败时，不会自动跳转登录页，仅停留在失效页面。属体验/一致性小问题，非安全漏洞。
- **建议**：将 `/support` 纳入 `isProtectedPath` 判断。

---

## 已确认无问题的关键面（无需修复）

- **SQL 注入**：所有查询使用参数化占位符；`WHERE`/`SET` 拼接均来自白名单常量，未发现用户输入直接拼接 SQL。
- **认证/授权**：`adminRequired`/`supportRequired` 均在服务端强制校验；毕业作品订单操作均有 `user_id` 归属校验（IDOR 已防护）。
- **支付安全**：支付宝/微信回调走官方 SDK 验签 + 金额一致性校验 + 交易号唯一性校验 + 订单状态守卫；`mock` 支付在生产/真实通道下被禁用。
- **路径穿越**：`docs.js`/`admin.js` 的文件路径经 `resolve` 后校验仍在目标目录内，并拒绝 `..` 与 `\0`。
- **密钥管理**：`.env`/`server/.env` 已在 `.gitignore`；仅 `.env.example` 入仓（占位值）；源码未发现硬编码密钥。
- **XSS**：前端未使用 `dangerouslySetInnerHTML`/`innerHTML` 等 DOM 注入 sink；React 默认转义。
- **安全头**：`helmet` 已启用并配置 CSP、`frame-ancestors`、`nosniff`；`X-Powered-By` 由 helmet 处理。
- **错误处理**：统一错误中间件不向客户端泄露堆栈。
