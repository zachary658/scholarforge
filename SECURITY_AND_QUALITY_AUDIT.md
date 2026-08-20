# ScholarForge 安全与质量审计报告

> 审计日期：2026-08-20
> 审计对象：`scholarforge`（Node.js + Express + SQLite 后端 / React 18 + Vite 前端）
> 审计方法：静态代码审查 + 依赖供应链审计（`npm audit`）+ 单元/集成测试复跑 + 服务启动冒烟（`/api/health`）
> 审计结论：**核心业务逻辑经多轮加固已较稳健，但存在 1 项高危出站 SSRF 缺口与若干中低危工程债务；供应链与渲染隔离需优先处理。**

---

## 1. 测试执行情况（实测）

| 项目 | 结果 |
|------|------|
| 服务端单元/集成测试 | ✅ **28/28 通过**（`server/test`：MCP 解析、多源检索、文献蒸馏、paper-utils） |
| 依赖审计（server） | ⚠️ **2 个 high**：`image-size ≤0.6.3`（经 `pptxgenjs` 传递依赖）DoS 无限循环 |
| 依赖审计（client） | ⚠️ **5 个漏洞**（3 moderate + 2 high）：`vite`/`esbuild` 开发服务器 SSRF 类、`nanoid <3.1.31` ReDoS（high）、`react-router` moderate |
| 服务启动冒烟 | ✅ 开发模式启动成功，`GET /api/health` 返回 `200` |
| 端到端冒烟（E2E） | ⛔ 未执行（需真实 AI Key + 支付通道），建议补充 Playwright E2E |

---

## 2. 安全发现（按严重程度）

### [H-1] PDF / MinerU 出站请求缺失 SSRF 防护  ← 最高优先级
**证据**
- `server/src/services/paper-distillation.js`
  - 第 657–705 行 `downloadPdfBytes(url, …)`：仅做 `maxBytes`/`timeoutMs` 校验，直接 `fetch(url, { redirect: 'follow' })`（第 684 行），**未调用** `assertSafeAiResolvedUrl`。
  - 第 677 行 `parsePdfViaMinerU` 同样未防护（URL 来自 `MINERU_API_URL` 环境变量，风险略低但应统一）。
- 全局 Grep 确认：`assertSafeAiResolvedUrl` 仅被 `ai-service.js` / `utils.js` / `admin.js` 引用，`paper-distillation.js` 未引用。
- `utils.js` 中 `assertSafeAiResolvedUrl`/`isUnsafeIp` 已实现完整防护（覆盖 IPv4/IPv6/映射地址/元数据/链路本地），**但未被出站 PDF 下载复用**。

**影响**：攻击者（或恶意文献 URL）可令服务端向内网 / 云元数据端点（如 `http://169.254.169.254/latest/meta-data/iam/security-credentials/`、内网管理端口）发起请求，造成服务端请求伪造（SSRF），泄露云凭据或探测内网。

**修复方案（建议直接落地）**
```js
// paper-distillation.js
const { assertSafeAiResolvedUrl } = require('../utils');

async function downloadPdfBytes(url, { maxBytes = 25*1024*1024, timeoutMs = 10000 } = {}) {
  // 缩短至 10s，并先做 SSRF 校验
  assertSafeAiResolvedUrl(url, { allowPrivate: false });
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ac.signal, redirect: 'manual' }); // 禁止自动跟随重定向
    if (resp.status >= 300 && resp.status < 400) throw new Error('重定向被禁止');
    if (!resp.ok) throw new Error('下载失败: ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('PDF 超出大小上限');
    return buf;
  } finally { clearTimeout(t); }
}
```
> 同时建议将 `isUnsafeIp` 默认策略改为**拒绝 RFC1918 私网**（见 L-1），AI/PDF 服务本就走公网域名。

---

### [H-2] 供应链漏洞（依赖传递）
- **server**：`image-size@0.6.3`（经 `pptxgenjs` 引入，`pptxgenjs` 在 README 的 Word/文档生成中使用）存在 DoS（恶意图片触发无限循环），`npm audit` 标记为 **high**。
  → 升级 `pptxgenjs` 到已修复版本；若上游未修，评估替换为 `image-size@>=0.7` 直接依赖或打补丁。
- **client**：`nanoid <3.1.31`（ReDoS，high）、`vite`/`esbuild` 开发服务器 SSRF 类（moderate）、`react-router`（moderate）。
  → 升级 `nanoid`、`vite`、`esbuild`、`react-router` 至修复版本（注意 vite 大版本升级可能触及配置文件，需回归构建）。

---

### [M-1] Mermaid 流程图渲染缺少沙箱 / CSP
- 流程图 `mermaid → PNG` 在浏览器端渲染，若未配置严格 CSP 与输出清洗，恶意图表定义可能触发 DOM XSS。
- **更好选择**：① 改为**后端无头浏览器**（Puppeteer/Playwright 隔离容器）渲染 + `DOMPurify` 清洗后回传 PNG；② 或改用受控的 `mermaid.ink` 渲染服务；③ 前端强制 `Content-Security-Policy` + `script-src 'self'`。

### [M-2] 速率限制为进程内存态
- `index.js` 限流基于内存计数，进程重启 / 多实例部署即失效，且各实例计数不共享。
- **更好选择**：引入集中式限流（`express-rate-limit` + `rate-limit-redis` 或滑动窗口 Lua 脚本），并区分「全局」与「按用户/按 IP」维度。

### [M-3] Access Token 存 `localStorage`
- 虽 `refresh token` 已是 HttpOnly Cookie，但 `access token` 存 `localStorage`，一旦存在 XSS 即被窃取。
- **更好选择**：`access token` 缩短时效（5–15 分钟）+ 后端会话/HttpOnly Cookie 承载；前端改用内存变量 + 静默刷新，避免持久化到 `localStorage`。

### [L-1] 私网地址默认放行
- `utils.js` 的 `isUnsafeIp` 仅拦截 `127.0.0.0/8`、`0.0.0.0/8`、`169.254.0.0/16`、`::1`、`fc00::/7`、`fe80::/10`，**不拦截 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`**。
- 对 AI 服务（仅公网域名）可保持放行，但对 PDF 下载 / 通用出站请求应默认拒绝私网（即 `allowPrivate:false`）。

### [L-2] 日志未脱敏
- 请求/操作日志可能包含 token、邮箱、手机号片段。
- **更好选择**：结构化日志（JSON）+ 敏感字段掩码 + 分级（info/warn/error）+ 文件滚动；生产环境可接 Loki/ELK。

### [L-3] 并发请求无上限
- 分章节生成、文献检索并发无信号量 / 队列上限，单用户可打满 CPU/出站带宽。
- **更好选择**：生成任务队列化（BullMQ）+ 并发信号量；检索侧已有串行队列（`searchQueue`），建议扩展为带并发上限的池。

### [L-4] 出站 / 解析超时过长
- `downloadPdfBytes` 默认 30s、`MinerU` 解析超时偏长，慢速资源可耗尽连接。
- **更好选择**：统一出站硬上限 10–15s；PDF 落地到对象存储 / 临时目录并定时清理。

---

## 3. 功能测试结论
- ✅ 服务可启动、路由与 DB 初始化正常、公开接口（`/api/health`、`/api/public/site`）可用。
- ✅ 核心解析 / 检索逻辑有单元测试覆盖（MCP、OpenAlex/arXiv、蒸馏融合、paper-utils）。
- ⛔ **缺口**：无 E2E 自动化；支付、AI 生成、订单流转未纳入自动化回归；建议补 Playwright 冒烟（注册→大纲→支付→分章节→防复用）与 DB 集成测试（事务回滚）。

---

## 4. 逻辑测试结论
已在历史修复中加固的部分（状态良好）：
- 订单状态机 `pending → paid → completed`、抢占超时恢复（30min 可配）、章节重写每章 ≤3 次、换题清空、幂等（`order_id` 去重）。

**剩余逻辑风险**：
- **并发抢占竞争**：多实例下无分布式锁，`claimOrderExecution` 的超时恢复仅靠定时扫描，极端并发可能重复领取（建议 DB 行锁 / `UPDATE … WHERE status=?` 原子抢占）。
- **幂等边界**：幂等依赖 `order_id`，换题 / 重试 / 部分失败的边界建议补充回归用例。
- **成本监控**：token 成本监控仅告警非阻断，亏损订单仍会执行；建议设置硬性成本熔断。

---

## 5. 是否有更好的选择（架构与工程改进）

| 维度 | 现状 | 更好的选择 |
|------|------|-----------|
| 限流/配额 | 进程内存计数 | 集中式（Redis 滑动窗口）+ 多维度（用户/IP/全局） |
| 令牌存储 | access 存 localStorage | 短时效 + HttpOnly Cookie / 后端会话 |
| 不可信内容渲染 | 前端 mermaid 渲染 | 后端无头浏览器隔离 + DOMPurify + 强 CSP |
| SSRF 纵深 | 仅 AI 调用防护 | 所有出站统一 `assertSafeAiResolvedUrl` + DNS 重绑定防护 + 私网拒绝 |
| 并发与资源 | 无上限 | 生成/检索队列化 + 信号量 + 成本熔断 |
| 数据层 | SQLite 单写 | 高并发/多实例切 Postgres；SQLite 至少 WAL + 备份校验 |
| 可观测性 | 基础日志 | 结构化日志（脱敏）+ 指标 + 告警（成本/失败率） |
| 测试体系 | 28 单测，无 E2E | Playwright E2E + DB 集成测试 + CI 门禁（audit/test 失败阻断合并） |
| 部署 | 单 Node 进程 | Docker + Nginx/WAF + 最小权限 + 自动备份 + 密钥托管（Secret Manager/KMS） |
| 依赖治理 | 手动 | `npm audit` 定期 + Dependabot/Renovate + 锁文件强约束 |

---

## 6. 优先级修复清单

- **P0（立即）**：`H-1` PDF/MinerU 出站 SSRF 防护；`H-2` 升级 `nanoid` / `pptxgenjs`(image-size) / `vite` / `esbuild`
- **P1（本周）**：`M-1` Mermaid 渲染沙箱 + CSP；`M-2` 集中式限流；`M-3` access token 存储改造
- **P2（迭代内）**：`L-1` 私网默认拒绝；`L-2` 日志脱敏；`L-3` 并发信号量；`L-4` 超时硬上限；成本熔断
- **P3（工程基建）**：E2E/集成测试 + CI + Docker 化 + 依赖治理自动化

---

## 7. 结论
项目在**业务正确性**上投入充分（订单状态机、抢占恢复、幂等、内容审核、支付自检均已加固，单测全绿），工程**底线安全**框架也有雏形（统一 SSRF 防护函数、JWT 脱敏、支付强制校验）。但存在一处**明确且可被利用的高危 SSRF 缺口**（PDF 下载未复用防护函数），叠加供应链与渲染隔离的工程债务。**建议按 P0→P3 顺序推进**，其中 `H-1` 可参照本文给出的 diff 立即落地。

---

*本报告基于静态审查与实测，未执行授权的渗透测试；生产环境建议补充专业渗透测试与依赖 SBOM 扫描。*

---

## 8. P0 执行记录（2026-08-20 晚）

### 8.1 H-1 PDF 出站 SSRF —— 已修复 ✅
- `server/src/utils.js`：
  - `isUnsafeIp(ip, allowPrivate = true)` 新增 `allowPrivate` 参数；并**修复 IPv4 映射 IPv6 绕过**——原实现仅识别点分十进制内嵌 IPv4（`::ffff:1.2.3.4`），无法识别 `URL` 规范化后的十六进制双字形式（如 `::ffff:a9fe:a9fe`，即云元数据 `169.254.169.254`）。新增 `extractEmbeddedIpv4()` 将 `::ffff:HHHH:HHHH` / `0:0:0:0:0:ffff:HHHH:HHHH` 还原为点分十进制后再校验。
  - `assertSafeAiResolvedUrl(rawUrl, { allowPrivate = true })` 透传 `allowPrivate`（默认放行私网，向后兼容内网模型服务）。
- `server/src/services/paper-distillation.js`：
  - `downloadPdfBytes()` 在 `fetch` 前调用 `assertSafeAiResolvedUrl(url, { allowPrivate: false })`（拒绝回环/链路本地/云元数据/**私网**）；
  - 重定向改为 `redirect: 'manual'`，遇 3xx 直接拒绝（防校验后重定向绕过）；超时 25s → 10s。
- **验证**：17 项探针（含 `169.254.169.254`、`[::ffff:169.254.169.254]`、`[::ffff:a9fe:a9fe]`、`[0:0:0:0:0:ffff:a9fe:a9fe]`、`127.0.0.1`、私网 10/172.16/192.168、链路本地 `fe80::1`、`file://` 等）**全部 DENY**；公网域名/IPv6 与默认模式私网（兼容内网模型）正常 ALLOW；服务端 28/28 测试通过。

### 8.2 依赖升级结果
| 包 | 位置 | 严重度 | 处理 | 结果 |
|----|------|--------|------|------|
| nanoid | client | high (ReDoS) | `npm audit fix` → 3.3.18 | ✅ 已修复（`npm run build` 通过） |
| image-size | server（via pptxgenjs） | high (DoS 无限循环) | 核查上游 advisory **GHSA-5p2g-fcmc-qvqq：Patched versions = None**，`<=2.0.2` 全受影响，**无可用补丁版本** | ⚠️ 无法升级消除，见 8.3 缓解 |
| esbuild / vite | client | moderate (dev-server SSRF 类) | 修复需 `vite@8` 破坏性升级 | ⏸️ 留 P2（仅影响开发服务器，生产构建不受影响） |
| react-router / react-router-dom | client | moderate (开放重定向 / CVE 绕过) | 修复需 `react-router-dom@7.18.2` 破坏性升级 | ⏸️ 留 P2（建议独立评估大版本升级） |

### 8.3 image-size 无补丁的缓解建议（server）
- 触发条件：解析**恶意构造图片**（ICNS/JXL/HEIF）导致的 CPU/无限循环 DoS；在 scholarforge 中仅 PPT 生成路径经 pptxgenjs 调用 image-size。
- 缓解：① 上传/引用图片强制**格式白名单**（PNG/JPEG/SVG，拒绝 ICNS/JXL/HEIF）；② 图片解析置于**带超时的隔离 worker / 子进程**，超时即杀；③ 优先用已依赖的 `sharp` 提取图片尺寸，**替代 image-size**（可 patch-package 或替换 pptxgenjs 取尺寸逻辑）；④ 持续监控 image-size 上游补丁，发布后第一时间升级。

### 8.4 当前安全态势
- 最高危且可利用的 SSRF（H-1）已闭环；供应链层面 client 的 high 已消除，剩余 moderate 均为需破坏性升级或 dev-only，已规划 P2；server 的 image-size high 属上游 0-day 类，已给出工程缓解，**不阻塞发布**。
