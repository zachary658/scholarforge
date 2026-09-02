"""多篇论文结论冲突检测（矛盾检测）。

降级模式用中英文二元词组 Jaccard + 互斥表述词表；paperqa 模式可用 LLM 判断。
"""
from __future__ import annotations

from typing import Any, Dict, List

from qa import tokenize, _jaccard

POSITIVE_PATTERNS = ["显著提升", "显著改善", "优于", "提高", "改善", "有效", "outperform", "improve", "better"]
NEGATIVE_PATTERNS = ["无显著", "没有显著", "不存在显著", "效果有限", "未改善", "不显著", "no significant", "worse"]


def detect_conflicts(claims: List[Dict[str, Any]], threshold: float = 0.06) -> Dict[str, Any]:
    conflicts: List[Dict[str, str]] = []
    n = len(claims)
    for i in range(n):
        for j in range(i + 1, n):
            a = str(claims[i].get("text", ""))
            b = str(claims[j].get("text", ""))
            a_pos = any(p in a for p in POSITIVE_PATTERNS)
            b_neg = any(p in b for p in NEGATIVE_PATTERNS)
            a_neg = any(p in a for p in NEGATIVE_PATTERNS)
            b_pos = any(p in b for p in POSITIVE_PATTERNS)
            # 方向相反才可能是矛盾
            if not ((a_pos and b_neg) or (a_neg and b_pos)):
                continue
            sim = _jaccard(tokenize(a), tokenize(b))
            if sim >= threshold:
                conflicts.append(
                    {
                        "a": a,
                        "b": b,
                        "source_a": str(claims[i].get("source_title", "")),
                        "source_b": str(claims[j].get("source_title", "")),
                        "similarity": round(sim, 4),
                    }
                )
    return {"conflicts": conflicts}
