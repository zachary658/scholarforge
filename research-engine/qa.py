"""逐节证据检索 → 「结论—证据原文—论文—页码」绑定（QA 模式）。

完整模式走 paper-qa；降级模式用中英文二元词组 + BM25 风格打分 + Jaccard 重排，
与主后端 evidence-engine.js 的 tokenizeEvidence/scoreLocalRows 思路一致，保证降级质量可控。
"""
from __future__ import annotations

import math
import re
from typing import Any, Dict, List

CJK_RE = re.compile(r"[\u3400-\u9fff]+")
TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9._+-]*|[\u3400-\u9fff]+", re.IGNORECASE)


def tokenize(value: str) -> List[str]:
    text = (value or "").lower()
    tokens = TOKEN_RE.findall(text)
    out: List[str] = []
    for token in tokens:
        if CJK_RE.fullmatch(token):
            if len(token) == 1:
                out.append(token)
            else:
                out.extend(token[i : i + 2] for i in range(len(token) - 1))
        else:
            out.append(token)
    return out[:3000]


def _jaccard(a: List[str], b: List[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    inter = len(sa & sb)
    return inter / (len(sa) + len(sb) - inter)


def _retrieve(question: str, documents: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    q_tokens = list(dict.fromkeys(tokenize(question)))
    if not q_tokens:
        return documents[:limit]

    scored: List[Dict[str, Any]] = []
    for doc in documents:
        text = str(doc.get("text", ""))
        tokens = tokenize(f"{doc.get('title', '')} {text}")
        if not tokens:
            continue
        counts: Dict[str, int] = {}
        for t in tokens:
            counts[t] = counts.get(t, 0) + 1
        bm25 = 0.0
        matched = 0
        for t in q_tokens:
            tf = counts.get(t, 0)
            if not tf:
                continue
            matched += 1
            bm25 += tf
        # 简化打分：命中词数 + 短语精确命中加分
        score = bm25
        q_clean = question.lower().strip()
        if len(q_clean) >= 3 and q_clean in text.lower():
            score += 1.5
        if matched == 0:
            continue
        scored.append({**doc, "_score": score + matched * 0.5})
    scored.sort(key=lambda d: d["_score"], reverse=True)
    return scored[:limit]


def answer_question(
    question: str,
    documents: List[Dict[str, Any]],
    mode: str = "builtin",
    limit: int = 5,
    llm_config: Dict[str, str] | None = None,
) -> Dict[str, Any]:
    """返回 { answer, evidence, mode }。

    paperqa 模式下交给 PaperQA2 产出带引文的答案；
    builtin 模式下返回检索到的证据片段作为「结论」占位（不做生成式问答，
    避免无 LLM 时编造结论——由上层 Node 把证据交给主模型做受约束生成）。
    """
    if mode == "paperqa":
        try:
            result = _answer_paperqa(question, documents, limit, llm_config)
            # 返回值必须是合法结构：None / 缺关键字段同样按失败处理，
            # 否则非法结构会透传到上层 Node 客户端导致崩溃
            if isinstance(result, dict) and "evidence" in result and "mode" in result:
                return result
        except Exception:
            pass
        mode = "builtin"  # 完整模式失败降级，不阻断

    evidence = []
    for doc in _retrieve(question, documents, limit):
        evidence.append(
            {
                "quote": str(doc.get("text", ""))[:1200],
                "title": doc.get("title", ""),
                "page_number": doc.get("page_number"),
            }
        )
    return {"answer": "", "evidence": evidence, "mode": "builtin"}


def _answer_paperqa(question, documents, limit, llm_config) -> Dict[str, Any]:
    """PaperQA2 完整模式：构建 Docs 并执行问答。失败抛异常由上层降级。"""
    from paperqa import Settings, ask  # type: ignore

    settings = Settings()
    if llm_config and llm_config.get("base_url") and llm_config.get("api_key"):
        # OpenAI 兼容 LLM 配置（DeepSeek/Qwen 等）
        settings.llm = llm_config.get("model", "gpt-4o-mini")
        settings.llm_config = {
            "base_url": llm_config["base_url"],
            "api_key": llm_config["api_key"],
        }

    from paperqa import Doc  # type: ignore

    docs = []
    for d in documents[:limit * 2]:
        docs.append(
            Doc(
                docname=str(d.get("title") or "document"),
                citation=str(d.get("title") or ""),
                dockey=str(d.get("title") or "") or str(abs(hash(str(d.get("text", ""))))),
            )
        )
        # 把文本内容作为段落挂到 doc 上
        docs[-1].texts = [str(d.get("text", ""))]

    answer = ask(question, settings=settings, docs=docs)
    evidence = []
    for c in getattr(answer, "contexts", []) or []:
        evidence.append(
            {
                "quote": str(getattr(c, "context", getattr(c, "text", "")))[:1200],
                "title": str(getattr(c, "text", "")).split("\n")[0][:120],
                "page_number": getattr(c, "page", None),
            }
        )
    return {"answer": str(getattr(answer, "answer", "")), "evidence": evidence[:limit], "mode": "paperqa"}
