# ScholarForge · 学术论文辅助平台

AI 驱动的学术论文辅助写作平台，集成论文写作、开题报告、文献综述、答辩 PPT、AI 率检测、降重润色于一体，按需付费，输出可编辑 Word 文档。

## 技术栈

- **后端**：Node.js + Express + SQLite（better-sqlite3）
- **前端**：React 18 + Vite + TailwindCSS + React Router
- **AI**：支持 DeepSeek / OpenAI 兼容协议（未配置时使用内置模板）
- **文档生成**：docx + latex-to-omml（原生可编辑公式）+ vega-lite/mermaid（图表）
- **文献检索**：OpenAlex + Semantic Scholar + CrossRef 多源聚合

## 目录结构

```
scholarforge/
├── server/                  # 后端服务
│   ├── src/
│   │   ├── index.js         # 入口（端口 3001）
│   │   ├── db.js            # 数据库
│   │   ├── ai.js            # 内置 AI 模板
│   │   ├── ai-service.js    # AI 服务调用
│   │   ├── routes/          # 14 个 API 路由
│   │   └── services/        # 11 个核心服务
│   │       ├── docx-generator.js       # Word 生成
│   │       ├── paper-distillation.js   # 论文蒸馏
│   │       ├── multi-source-search.js  # 多源检索
│   │       └── chart-renderer.js       # 图表渲染
│   ├── data/scholarforge.db # 数据库（含配置，已清空测试数据）
│   └── .env.example         # 环境变量模板
├── client/                  # 前端应用
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/           # 23 个页面
│   │   ├── components/
│   │   └── lib/api.js
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
# 编辑 .env 填写 AI 密钥等（不配置也可运行，使用内置模板）
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

## 默认账号

首次启动自动创建管理员账号：

- 邮箱：`admin@scholarforge.com`
- 密码：通过 `ADMIN_PASSWORD` 环境变量指定（建议 ≥8 位强密码）；未设置时自动生成随机强密码，需在部署前通过 `ADMIN_PASSWORD` 显式指定方可登录

普通用户通过注册页面创建，注册即赠积分（默认 30 积分，可在管理后台调整）。

客服账号（`is_support`）由管理员在「用户管理」中创建，或通过 `POST /api/admin/users` 接口创建。

## 核心功能

| 功能 | 说明 | 计费 |
|------|------|------|
| 大纲生成 | 3 级结构化大纲 | 免费不限次 |
| 全文生成 | 完整毕业论文（10000+ 字）| 5 元/次 |
| 段落续写 | 正文段落扩写 | 1 元/次 |
| 开题报告 | 10 章节结构化 | 8 元/次 |
| 文献综述 | 含主题分类与引用 | 6 元/次 |
| 答辩 PPT | 大纲 + 演讲稿 | 8 元/次 |
| AI 率检测 | 风险评级 + 定位 | 3 元/次 |
| 降 AI 率 | 智能改写 | 4 元/次 |
| 查重检测 | 重复率分析 | 3 元/次 |
| 论文降重 | 同义改写 | 3 元/次 |
| 文献检索 | OpenAlex 多源聚合 | 免费 |
| 学术润色 | 语句优化 | 2 元/次 |
| 中英翻译 | 双向翻译 | 2 元/次 |
| 语法纠错 | 问题检测 | 1 元/次 |

价格可在管理后台动态调整。

## Word 输出特性

- 原生可编辑公式（OMML，双击可编辑，非图片）
- 三线表（学术规范样式：上下粗线 + 表头细线，无竖线）
- 数据图表（vega-lite → PNG 嵌入）
- 流程图（mermaid → PNG 嵌入）
- 高校模板（内置清华、北大等 10+ 高校学位论文格式）

## 智能写作流程

1. **多源检索**：OpenAlex + Semantic Scholar + CrossRef 并行检索，跨源去重，按引用数排序
2. **论文蒸馏**：MapReduce 提取每篇论文的方法/创新点/结论，融合生成大纲
3. **原创生成**：基于融合框架分章节生成，含图表/公式/表格/参考文献
4. **Word 输出**：注入 OMML 公式 + 渲染图表 + 三线表，导出 .docx

## 质量承诺

- AI 率 > 15% 可退费（使用降 AI 功能后）
- 重复率 > 20% 可退费（使用降重功能后）
- 文献均来自真实学术数据库，可溯源

## 管理后台

登录管理员账号后访问 `/admin`：

- 功能定价管理（动态调价）
- 用户与额度管理
- 订单与退费审核
- AI 模型配置
- 高校模板管理
- 课程与赠额管理

## 验证

启动后可通过以下方式验证服务：

```bash
# 健康检查
curl http://localhost:3001/api/health

# 公开站点信息（站点名称、积分套餐、课程、毕业作品项目）
curl http://localhost:3001/api/public/site
```

前端访问 `http://localhost:5173` 查看落地页、注册/登录；管理员登录后访问 `/admin` 使用管理后台。

## 许可证

仅供学术研究辅助使用。
