# ScholarForge Research Engine（PaperQA2 研究引擎）

面向科学文献的段落级学术 RAG 服务。作为 ScholarForge 的**独立 Python 研究服务**接入，
Node.js 后端通过内部 API（`PAPERQA_API_URL`）调用，未配置时静默降级、绝不阻断主流程。

对应《ScholarForge 技术升级方案》优先级 5：PaperQA2 作为研究引擎试点。

## 职责边界

本服务只负责「研究」——把候选论文解析为**带页码/章节的证据块**、逐节检索证据、
输出「结论—证据原文—论文—页码」绑定关系、检测论文间结论冲突。

**不接管**用户、订单、工作区和前端（这些是 ScholarForge 产品层的价值，不能交给通用 RAG 平台）。

## 架构

```
ScholarForge 产品层（用户/订单/工作区）
        │ 内部 API（JSON over HTTP）
        ▼
research-engine（本服务，Python/FastAPI）
  ├─ engine.py    论文解析 → 证据块（全文索引、元数据感知、分块）
  ├─ qa.py        逐节证据检索 → 结论-证据-页码绑定（QA 模式）
  ├─ conflict.py  结论冲突检测
  └─ server.py    REST 接口
```

## 两种运行模式

1. **完整模式**（推荐，生产）：安装 `paper-qa`（PaperQA2）及其依赖，具备真正的全文索引、
   上下文摘要、重排、引文定位能力。
2. **降级模式**（零额外重依赖）：不安装 `paper-qa` 时，退回内置的轻量证据块解析 +
   关键词检索，保证服务可启动、可联调，但证据质量低于完整模式。

## 快速开始

```bash
cd research-engine

# 1. 创建虚拟环境
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# 2. 安装依赖（二选一）
pip install -r requirements.txt          # 轻量降级模式（FastAPI + uvicorn）
pip install -r requirements-full.txt     # 完整模式（PaperQA2 + BSD 许可的 PyPDF 后端）

# 3. 配置环境变量（复制 .env.example 为 .env）
cp .env.example .env

# 4. 启动
uvicorn server:app --host 0.0.0.0 --port 8100
```

也可以从仓库根目录直接启动轻量服务：

```bash
# 根目录 .env 同时设置 PAPERQA_API_URL=http://research-engine:8100
docker compose --profile research up --build

# 完整 PaperQA2 镜像：把 .env 中 RESEARCH_REQUIREMENTS 改为 requirements-full.txt
```

## API

### `POST /api/v1/parse`
把 PDF/文本解析为带页码、章节的证据块。

```jsonc
// 请求（multipart 或 JSON）
{ "text": "...", "filename": "paper.pdf", "chunk_chars": 900, "overlap_chars": 140 }

// 响应
{ "blocks": [ { "page_number": 1, "section_title": "引言", "text": "...", "block_type": "text" } ],
  "metadata": { "title": "...", "authors": [], "doi": "", "year": "" },
  "mode": "paperqa" | "builtin" }
```

### `POST /api/v1/answer`
针对单个问题，返回「结论 + 支撑证据 + 页码」绑定（QA 模式）。

```jsonc
// 请求
{ "question": "...", "documents": [{ "text": "...", "title": "...", "page_number": 1 }] }

// 响应
{ "answer": "结论", "evidence": [ { "quote": "证据原文", "title": "论文", "page_number": 1 } ], "mode": "..." }
```

### `POST /api/v1/conflicts`
检测多篇论文之间的结论冲突。

```jsonc
// 请求
{ "claims": [ { "text": "结论A", "source_title": "论文1" }, { "text": "结论B", "source_title": "论文2" } ] }

// 响应
{ "conflicts": [ { "a": "结论A", "b": "结论B", "reason": "..." } ] }
```

### `GET /api/v1/health`
健康检查 + 当前运行模式（`paperqa` / `builtin`）。

## 许可

PaperQA2（`paper-qa`）为 Apache-2.0；PDF 解析使用 `paper-qa-pypdf` / `pypdf`（BSD-3-Clause）。
依赖策略明确禁止把 PyMuPDF 带入商业镜像；CI 会解析完整依赖树并阻止该包出现。
如未来确需 PyMuPDF 的高保真能力，必须先取得适用的商业许可并经过法务确认。本服务自身代码随 ScholarForge 仓库分发。
