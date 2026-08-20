# ScholarForge · 学术论文辅助平台

AI 驱动的学术论文辅助写作平台，集成论文写作、分章节生成、开题报告、文献综述、答辩 PPT、降 AI 率、论文降重于一体，现金直付按次计费，输出可编辑 Word 文档。

## 技术栈

- **后端**：Node.js + Express + SQLite（better-sqlite3）
- **前端**：React 18 + Vite + TailwindCSS + React Router
- **AI**：支持 DeepSeek / OpenAI 兼容协议（未配置时使用备用写作引擎）
- **文档生成**：docx + latex-to-omml（原生可编辑公式）+ vega-lite/mermaid（图表）
- **文献检索**：OpenAlex + Semantic Scholar + CrossRef + arXiv 四源聚合；可选 CNKI（知网）MCP 插件通道
- **深度文献调研**：借鉴 STORM 多视角架构，研究主题拆分 3-5 个检索角度，分角度检索、跨角度去重融合出研究框架与大纲
- **数据借鉴**：摘要指标 + OA 全文 PDF 提取（可选 MinerU 高质量解析通道，未配置时用内置 pdfjs 兜底），图表/表格自动标注来源
- **内容安全**：本地敏感词过滤兜底 + 可配置阿里云内容安全 / 网易易盾

## 目录结构

```
scholarforge/
├── server/                  # 后端服务
│   ├── src/
│   │   ├── index.js         # 入口（端口 3001）
│   │   ├── db.js            # 数据库（含迁移与种子定价）
│   │   ├── ai-service.js    # AI 服务调用
│   │   ├── config-store.js  # 配置读写（含站点/支付/内容安全）
│   │   ├── auth.js          # JWT 认证与 safeUser 脱敏
│   │   ├── routes/          # API 路由（auth/tools/orders/payment/projects/charts/references/admin...）
│   │   └── services/        # 核心服务
│   │       ├── payment.js           # 订单与支付（固定价/人工报价）
│   │       ├── billing.js           # 现金定价与 token 成本监控
│   │       ├── chapter-service.js   # 分章节生成队列
│   │       ├── content-safety.js    # 内容安全审核
│   │       ├── text-optimize.js     # 降重/降AI增强
│   │       ├── docx-generator.js    # Word 生成（三线表/图表/公式/图表引用校验）
│   │       ├── paper-distillation.js   # 深度文献调研（检索→框架提取→融合）
│   │       ├── multi-source-search.js  # 多源检索
│   │       └── chart-renderer.js       # 图表渲染
│   ├── data/scholarforge.db # 数据库
│   └── .env.example         # 环境变量模板
├── client/                  # 前端应用
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/           # 页面（工作台/AI 写作/文本优化/管理后台/客服工作台）
│   │   ├── components/      # FeaturePay、AcademicIntegrityModal、PayModal 等
│   │   └── lib/             # api.js、useAcademicIntegrity.js
│   └── vite.config.js       # Vite 配置（proxy 到 3001）
└── design/                  # 设计稿
```

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 1. 安装依赖

```bash
# 后端
cd server
npm install

# 前端
cd ../client
npm install
```

### 2. 配置环境变量（可选）

```bash
cd server
cp .env.example .env
# 编辑 .env 配置服务信息；AI 模型 Key 通过环境变量 LLM_API_KEY_XXX 注入（见 .env.example），不配置则使用内置模板
```

### 3. 启动服务

```bash
# 后端（终端 1）
cd server
npm start          # 默认端口 3001

# 前端（终端 2）
cd client
npm run dev        # 默认端口 5173
```

### 4. 访问

打开浏览器访问 `http://localhost:5173`

## 生产部署

### 1. 构建前端

```bash
cd client
npm install
npm run build        # 产物输出到 client/dist
```

后端启动时会自动托管 `client/dist`（SPA 路由已处理），生产只需跑一个 Node 服务。

### 2. 环境变量（必配）

```bash
NODE_ENV=production
JWT_SECRET=<至少32字符强随机值>       # 缺失或过短时拒绝启动
ADMIN_PASSWORD=<管理员初始密码≥8位>   # 缺失则生成随机密码且无法登录
PORT=3001
TRUST_PROXY=1                          # 部署在 Nginx/网关后必须设置，否则限流/风控 IP 全部失真
CORS_ALLOW_ORIGINS=https://你的域名    # 同域部署时保持默认即可
FRONTEND_URL=https://你的域名          # 密码重置邮件链接用
SMTP_URL=smtps://user:pass@host:465    # 生产必须配置（缺失时密码重置邮件被拒绝发送）
MAIL_FROM=ScholarForge <noreply@你的域名>
LLM_API_KEY_DEEPSEEK=<key>             # 至少配置一个真实模型，否则付费下单被拒绝
LOG_TO_FILE=true                       # 建议开启（生产默认写日志）
```

### 3. 支付（强制校验）

生产环境启动自检：`payment_mode` 必须为非 mock 且至少配置一个真实通道（支付宝/微信），否则**拒绝启动**。商户密钥在管理后台「系统设置」配置（不在环境变量中）。

### 4. Nginx 反代（参考）

```nginx
server {
  listen 443 ssl;
  server_name 你的域名;
  # ssl_certificate ...; ssl_certificate_key ...;
  client_max_body_size 10m;
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;   # AI 生成/智能写作耗时较长
  }
}
```

### 5. 数据备份与运维

- 数据文件：`server/data/scholarforge.db`（SQLite，WAL 模式）+ `server/uploads/`（生成文档/图表/模板）
- 备份：直接复制 db 文件 + uploads 目录（建议每天一次）
- 日志：`server/logs/`（按天滚动，注意磁盘空间）
- 可选增强：`MINERU_API_URL`（PDF 高质量解析）、`CNKI_MCP_COMMAND`（知网文献，注意合规）

### 6. 进程守护

使用 pm2 / systemd / Docker 守护 Node 进程，接收 `SIGTERM` 时服务会优雅关闭。

## 默认账号

首次启动自动创建管理员账号：

- 邮箱：`admin@scholarforge.com`
- 密码：通过 `ADMIN_PASSWORD` 环境变量指定（建议 ≥8 位强密码）；未设置时自动生成随机强密码，需在部署前通过 `ADMIN_PASSWORD` 显式指定方可登录

普通用户通过注册页面创建。客服账号（`is_support`）由管理员在「用户管理」中创建。

## 收费模式（现金直付）

平台不使用积分，所有 AI 功能均为**现金直付**：

- **固定价格**：每个功能在管理后台「功能定价」中配置现金价格（单位：元），下单后支付；**修改后立即对用户端生效**
- **人工报价**：可将功能设为报价模式，用户提交需求后由客服报价、管理员审批，用户确认支付
- **支付流程**：先下单支付 → 支付成功后执行生成（订单状态：pending → paid → completed，失败自动可重试）；付费引导以居中弹窗展示，支付成功自动继续生成
- **支付渠道**：微信支付 / 支付宝（商户号、密钥、证书路径在管理后台「系统设置」配置，不硬编码）；未配置真实渠道时可用 mock 通道联调，也可由管理员手工标记支付
- **不支持退款**：平台不提供退款功能
- **课程 / 毕业作品订单**：保留独立流程（课程固定价下单、毕业作品人工报价 + 审批）

### 功能定价（默认，元/次）

> 以下为系统**初始默认值**，管理员可在后台「功能定价」随时调整（改价立即生效）；每个功能受 token 成本监控保护，亏损时告警。

| 功能 | 说明 | 默认价格 |
|------|------|------|
| 大纲生成 | 3 级结构化大纲，自动写入工作区 | 免费不限次（每小时限 60 次）|
| 摘要生成 | 提炼论文摘要 | 2 |
| 段落续写 | 正文段落扩写 | 2 |
| 全文生成 | 完整毕业论文（10000+ 字）| 35 |
| 开题报告 | 结构化开题报告 | 8 |
| 文献综述 | 含主题分类与引用 | 6 |
| 深度文献调研 | 多角度检索解析真实论文，产出研究框架/文献/数据/大纲 | 6（复用文献综述订单）|
| 任务书 | 进度安排与考核指标 | 4 |
| 答辩 PPT | 大纲 + 演讲稿 | 8 |
| 期刊论文 | 符合期刊规范的完整论文 | 100 |
| 降 AI 率 | 智能改写消除 AI 痕迹 | 4 |
| 论文降重 | 同义改写 | 3 |
| 学术润色 | 语句优化 | 2 |
| 中英翻译 | 双向翻译 | 2 |
| 语法纠错 | 问题检测 | 2 |
| 文献检索 | OpenAlex 四源聚合 | 免费 |
| 文献格式化 | GB/T 7714 / APA / MLA | 免费 |

## 核心写作流程

1. **生成大纲**（免费）：论文写作页生成 3 级结构化大纲，**自动写入论文工作区**（按题目自动建区，同题复用）
2. **深度文献调研**（付费升级，可选）：从多个研究角度检索真实论文，解析出研究方法/创新点/结论、真实文献清单与可参考的实验数据表格，产出更优质的大纲并覆盖工作区
3. **数据借鉴引擎**：从检索论文的摘要与 OA 全文 PDF 提取性能指标与表格数据，用 vega-lite 重绘对比图表 / 三线表插入论文，图题与表格**自动标注数据来源**（"数据引自 XXX [n]"）
4. **大纲确认**：在工作区查看/编辑结构化大纲，手动确认后方可生成全文
5. **分章节生成**：逐章生成 + 局部重写（每章最多 3 次）+ 章节编辑，每章注入真实文献/数据硬约束（AI 只许 `[CITE:n]` / `[CHART:x]` 引用，代码统一替换），DB 轮询实时查看进度，完成后一键合并导出
6. **数据图表**：上传 Excel/CSV 数据，vega-lite 渲染柱状/折线/饼/散点图，一键插入章节
7. **文献管理**：四源检索（缓存 + 超时重试 + 熔断）、批量引用生成（GB/T 7714 / APA / MLA）
8. **降重 / 降 AI 率**：增强改写（连贯性检查）、多版本对比选择
9. **Word 导出**：图表引用自动校验、三线表、OMML 公式、页脚 AI 辅助生成水印

## 内容自动归档与保留

- **按题目自动建区**：用户生成内容时无需手动创建工作区——论文类内容按题目自动建区（同题复用、异题分建），润色/翻译/降重等文本优化内容统一归「文本优化」区
- **生成即归档**：每次生成成功自动归档到对应工作区，右上角提示"内容已保存至论文工作区"，可从「论文工作区 / 我的任务 / 我的文档」随时回看
- **保留期 30 天**：任务记录与 Word 文档默认保留 30 天（管理后台「系统设置 → doc_retention_days」可调），到期自动清理；生成成功提示与「我的任务 / 我的文档」页面顶部均有保留期提醒，请及时下载保存

## 合规与安全

- **学术诚信承诺书**：全文生成、降重、降 AI 率等敏感功能首次使用强制签署，后端 DB 记录签署时间
- **内容安全审核**：所有 AI 工具的用户输入与 AI 输出均过审（本地敏感词兜底，可切换阿里云内容安全 / 网易易盾，外部服务失败自动回退本地）
- **用户协议与隐私政策**：独立页面 `/terms`、`/privacy`，注册页强制勾选
- **ICP 备案**：管理后台「系统设置」可配置备案号与链接，落地页页脚展示
- **账户安全**：密码修改强制全设备下线，修改接口带速率限制；refresh token HttpOnly 存储；用户信息脱敏返回
- **免责声明**：注册需知、落地页页脚、导出文档页脚均含 AI 辅助生成提示

## Word 输出特性

- 原生可编辑公式（OMML，双击可编辑，非图片）
- 三线表（学术规范样式：上下粗线 + 表头细线，无竖线）
- 数据图表（vega-lite → PNG 嵌入，正文引用自动校验）
- 流程图（mermaid → PNG 嵌入）
- 高校模板（内置 10+ 高校学位论文格式）

## 管理后台

登录管理员账号后访问 `/admin`：

- 概览与财务中心（订单收入统计）
- 功能定价（现金价格 / 报价模式切换，token 成本监控）
- 订单管理（7 态状态流转、手工标记支付、生成进度）
- 报价管理（人工报价审批）
- 课程管理 / 课程对接 / 毕业作品 / 作品对接
- 用户管理（含客服账号创建）
- AI 模型配置、高校模板管理
- 系统设置：站点信息（含 ICP 备案）、支付通道（微信/支付宝商户配置）、内容安全审核（provider 与密钥）

## 客服工作台

客服账号（`is_support`）登录后访问 `/support`：

- 工作台首页：聚合待对接、今日新增、超时未处理、待审批报价等统计
- 课程对接：查看已支付课程订单与需求，标记对接状态，跟进备注
- 毕业作品：查看作品订单、提交报价（需管理员审批通过后才生效）、跟进备注
- 课程列表：查看服务内容与定价

客服提交的报价需管理员在 `/admin/graduation-orders` 审批通过后，用户方可支付。

## 验证

启动后可通过以下方式验证服务：

```bash
# 健康检查
curl http://localhost:3001/api/health

# 公开站点信息（站点名称、课程、毕业作品项目、ICP 备案）
curl http://localhost:3001/api/public/site
```

自动化验证：

```bash
# 单元/集成测试（28 项：数据借鉴引擎、arXiv/MCP 解析、大纲结构化等）
cd server && npm test

# 端到端冒烟测试（需后端已启动：注册→大纲→支付→分章节生成→防复用等 17 项）
node server/scripts/smoke.mjs
```

前端访问 `http://localhost:5173` 查看落地页（AI 写作全流程、论文降重、降AI率导航直达）、注册/登录；管理员登录后访问 `/admin` 使用管理后台。

## 许可证

仅供学术研究辅助使用。
