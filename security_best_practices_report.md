# ScholarForge 安全审查报告（已更新）

审查范围：`client/`（React 18 + Vite）与 `server/`（Node.js + Express 4 + better-sqlite3）
审查依据：OWASP 及 Node/Express/React 安全最佳实践
最近更新：2026-08（覆盖历轮修复与功能升级后的最新状态）

## 执行摘要

整体安全基线扎实：JWT 双 token（access 15 分钟 + refresh 7 天 HttpOnly Cookie + 哈希入库 + 轮换）+ `token_version` 主动失效；bcrypt 哈希 + 密码强度校验；登录/注册/忘记密码/改密均有速率限制与防枚举；支付回调走官方 SDK 验签 + **商户归属校验（app_id/mchid）** + 金额一致性 + 交易号唯一性；SQL 全参数化；订单执行**原子抢占**防并发复用与一单多论文；软删除用户立即断权；内容安全阿里云/易盾直连；SSRF 校验含 DNS 解析后二次校验；SQLite 文件不入库、`.env` 已 gitignore。

历轮修复均已通过测试验证：单元/集成测试 25/25、端到端冒烟测试 17/17、前端生产构建通过。

## 已修复（历史问题清单）

| 编号 | 问题 | 状态 |
|------|------|------|
| - | 支付宝回调缺 app_id/seller_id 校验（跨商户通知重放，零成本支付绕过） | ✅ 已修：校验 app_id + mchid/appid |
| - | 已支付订单并发复用（一次付费多次生成） | ✅ 已修：claimOrderExecution 原子抢占 |
| - | 一单多论文/2 元段落订单驱动全论文/无限次重写 | ✅ 已修：仅接受 writing_fulltext 订单 + 每章重写上限 3 次 |
| - | 付费订单 AI 失败后永久锁死 | ✅ 已修：failed 状态可重试 |
| - | 阿里云内容安全签名缺 AccessKeyId（审核链路失效） | ✅ 已修：Authorization: acs {AccessKeyId}:{Signature} |
| - | SSRF 校验可绕过（localhost/IPv6/重绑定域名） | ✅ 已修：主机名黑名单 + DNS 解析后校验 |
| - | 软删除用户 access token 有效期内仍可访问 | ✅ 已修：token_version++ + 中间件拦截 deleted |
| - | 模板上传 zip-bomb（mammoth 解析先于大小校验） | ✅ 已修：解析前遍历条目校验解压大小 |
| - | quantity 多付少得 | ✅ 已修：仅支持单次购买 |
| - | 前端 402 契约断裂（err.needOrder 恒 undefined） | ✅ 已修：err.data.needOrder + 后端返回 amount |
| - | 中文文献被去重逻辑整体丢弃（_dedupKey 中文清空） | ✅ 已修：归一化保留 Unicode + 回归测试 |
| - | refresh token 存 localStorage（旧 M-01） | ✅ 已修：HttpOnly Cookie + 轮换 |
| - | 登录开放重定向（旧 M-02） | ✅ 已修：仅允许站内相对路径 |
| - | 上传仅校验扩展名（旧 L-01） | ✅ 已修：magic-byte 校验 |
| - | 异步中间件 Promise 丢弃（unhandledRejection 风险） | ✅ 已修：.catch(next) |
| - | 生产日志同步写阻塞事件循环 | ✅ 已修：异步队列 flush |
| - | xlsx CVE（prototype pollution / ReDoS） | ✅ 已修：升级 0.20.3 |
| - | DeepSeek max_tokens=16000 超上限（Invalid max_tokens） | ✅ 已修：按模型目录上限 |
| - | MCP 连接子进程崩溃后不恢复 | ✅ 已修：失败自动重置连接 |

## 剩余风险（已评估，可接受）

### 中低

1. **image-size DoS**（pptxgenjs 依赖，npm audit 2 项 high）：触发条件为解析恶意 ICNS/JXL/HEIF 图片；本平台 PPT 生成仅嵌入服务端自产的 PNG 图表，攻击者不可控。修复需升级 pptxgenjs 1.x（破坏性变更），暂缓。
2. **access token 存 localStorage**：XSS 可窃取（15 分钟窗口）；refresh token 已 HttpOnly。属行业常规取舍，前端无 `dangerouslySetInnerHTML`、CSP 已启用。
3. **未配置真实 AI 时付费买到内置模板**：生产环境已强制拦截下单；开发/演示模式仍允许（便于联调），演示环境对外需注意。

### 低

4. 限流为内存存储（多实例/重启失效）；部署建议网关层限流 + `TRUST_PROXY` 正确设置。
5. 纵深防御小项：vega 表达式校验未覆盖 filter/transform（数据 URL 已禁用）、图表渲染超时不取消底层任务、LaTeX→OMML 无超时、AI 上游错误体入服务端日志。
6. 前端小瑕疵：`auth.jsx` 硬编码 token key、个别 useEffect 依赖不完整、少量静默吞错。
7. 自动化测试尚未覆盖支付回调验签与权限矩阵（有冒烟测试兜底主链路）。

## 已确认无问题的关键面

- **SQL 注入**：全部参数化，无用户输入拼接。
- **认证/授权**：adminRequired/supportRequired 服务端强制校验；IDOR 已防护（user_id 归属校验覆盖文档/项目/图表/订单）。
- **支付安全**：验签 + 商户归属 + 金额一致性 + 交易号唯一性 + 幂等；mock 支付生产禁用（启动自检拒绝）。
- **密钥管理**：AI Key 仅环境变量、支付密钥入库但管理端脱敏返回、`.env` gitignore。
- **路径穿越**：文档/模板下载删除均经 resolve 后目录校验。
- **XSS**：无 DOM 注入 sink，React 默认转义，helmet CSP 启用。
- **内容安全**：本地归一化过滤（去空白/全角转半角）+ 阿里云/易盾可切换，失败降级有日志。
- **SSRF**：AI base_url 主机名黑名单 + IP 字面量拦截 + DNS 解析后校验。
