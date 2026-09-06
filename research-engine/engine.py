"""论文解析 → 带页码/章节的证据块。

两种模式：
  - paperqa 模式：安装 paper-qa 后具备全文索引、元数据感知、上下文摘要能力；
  - builtin 模式：零额外重依赖的轻量分块（保证服务可启动、可联调）。

所有解析逻辑集中在纯函数 parse_evidence_blocks，便于脱离 HTTP 单测。
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional

DEFAULT_CHUNK_CHARS = 900
DEFAULT_OVERLAP_CHARS = 140
MAX_BLOCKS = 4000


def _clean(text: Any) -> str:
    s = str(text or "")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _split_long(text: str, max_chars: int, overlap_chars: int) -> List[str]:
    chunks: List[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(n, start + max_chars)
        if end < n:
            boundary = max(
                [text.rfind(p, start, end) for p in ("。", "！", "？", ". ", "; ", "\n")],
            )
            if boundary > start + int(max_chars * 0.55):
                end = boundary + 1
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= n:
            break
        start = max(start + 1, end - overlap_chars)
    return chunks


def parse_evidence_blocks(
    text: str,
    filename: str = "paper.pdf",
    chunk_chars: int = DEFAULT_CHUNK_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
) -> Dict[str, Any]:
    """把纯文本按段落分块，输出带（可选）章节标题的证据块。

    页码信息在纯文本通道中无法获得（置 null）；若上层传入的是 PDF，
    请先用 pymupdf/Docling/GROBID 抽出带页码的文本再调用本函数。
    """
    text = _clean(text)
    if not text:
        # 与非空路径保持同一 metadata 结构（含 journal 键），上层解析无需分支
        return {"blocks": [], "metadata": {"title": "", "authors": [], "doi": "", "year": "", "journal": ""}}

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    blocks: List[Dict[str, Any]] = []
    section = ""
    current = ""

    def flush() -> None:
        nonlocal current
        if not current:
            return
        if len(blocks) < MAX_BLOCKS:
            blocks.append(
                {
                    "page_number": None,
                    "section_title": section,
                    "text": current,
                    "block_type": "text",
                }
            )
        current = ""

    for para in paragraphs:
        # 简单章节标题启发：单行、短、以编号或「第X章」开头
        if len(para) <= 60 and re.match(r"^(?:#{1,6}\s+|第[一二三四五六七八九十\d]+[章节部分篇]|\d+(?:\.\d+)*[\s、.．]|[一二三四五六七八九十]+[、.．])", para):
            flush()
            section = _clean(re.sub(r"^#{1,6}\s+", "", para))
            continue
        if len(para) > chunk_chars:
            flush()
            for piece in _split_long(para, chunk_chars, overlap_chars):
                blocks.append(
                    {"page_number": None, "section_title": section, "text": piece, "block_type": "text"}
                )
            continue
        if not current:
            current = para
        elif len(current) + len(para) + 2 <= chunk_chars:
            current += "\n\n" + para
        else:
            flush()
            overlap = current[-overlap_chars:]
            overlap = re.sub(r"^\S*\s?", "", overlap).strip()
            current = (overlap + "\n\n" + para) if overlap else para
    flush()

    # 元数据启发：标题取首个短段落，年份取 4 位数字，DOI 用正则
    title = ""
    year = ""
    doi = ""
    for para in paragraphs[:3]:
        if len(para) <= 200 and not title:
            title = para
    m_year = re.search(r"\b(19|20)\d{2}\b", text)
    if m_year:
        year = m_year.group(0)
    m_doi = re.search(r"\b10\.\d{4,9}/[^\s,，；;)\"']+", text)
    if m_doi:
        doi = m_doi.group(0).rstrip(".,;")

    return {
        "blocks": blocks,
        "metadata": {"title": title, "authors": [], "doi": doi, "year": year, "journal": ""},
    }


def is_paperqa_available() -> bool:
    try:
        import paperqa  # noqa: F401
        return True
    except Exception:
        return False


def resolve_mode() -> str:
    """按环境变量 / 依赖探测决定运行模式。"""
    env = os.getenv("RESEARCH_ENGINE_MODE", "").strip().lower()
    if env in ("paperqa", "builtin"):
        return env
    return "paperqa" if is_paperqa_available() else "builtin"
