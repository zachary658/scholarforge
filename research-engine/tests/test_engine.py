"""engine.parse_evidence_blocks 解析与分块测试。"""
from engine import parse_evidence_blocks, resolve_mode, is_paperqa_available


# ---------- 空输入 ----------

def test_parse_empty_text_returns_empty_blocks():
    result = parse_evidence_blocks("")
    assert result["blocks"] == []
    assert result["metadata"] == {"title": "", "authors": [], "doi": "", "year": "", "journal": ""}


def test_parse_whitespace_only_text_returns_empty():
    result = parse_evidence_blocks("   \n\n\t  \n\n  ")
    assert result["blocks"] == []


# ---------- 文本清洗 ----------

def test_parse_normalizes_line_endings_and_collapses_blank_lines():
    result = parse_evidence_blocks("第一段。\r\n第二行。\r\r\n\r\n\r\n\r\n第二段。")
    texts = [b["text"] for b in result["blocks"]]
    assert len(texts) == 1
    assert "\r" not in texts[0]
    assert "\n\n\n" not in texts[0]


# ---------- 段落合并与分块 ----------

def test_parse_merges_short_paragraphs_into_one_block():
    paras = ["短段落一。", "短段落二。", "短段落三。"]
    result = parse_evidence_blocks("\n\n".join(paras), chunk_chars=900)
    assert len(result["blocks"]) == 1
    assert "短段落一。" in result["blocks"][0]["text"]
    assert "短段落三。" in result["blocks"][0]["text"]


def test_parse_flushes_block_when_chunk_limit_reached():
    p1 = "甲" * 500
    p2 = "乙" * 500
    p3 = "丙" * 100
    result = parse_evidence_blocks("\n\n".join([p1, p2, p3]), chunk_chars=600, overlap_chars=0)
    # 500+500 > 600：第二段触发 flush，再与第三段合并
    assert len(result["blocks"]) >= 2


def test_parse_split_long_paragraph_respects_max_chars():
    long_para = "句子。这是一句用于测试切分逻辑的话。" * 80
    result = parse_evidence_blocks(long_para, chunk_chars=300, overlap_chars=50)
    assert len(result["blocks"]) > 1
    for b in result["blocks"]:
        assert len(b["text"]) <= 300


def test_parse_split_long_paragraph_produces_overlap():
    long_para = "。".join(f"第{i}句内容用于验证切分重叠窗口" for i in range(200))
    result = parse_evidence_blocks(long_para, chunk_chars=200, overlap_chars=60)
    texts = [b["text"] for b in result["blocks"]]
    if len(texts) >= 2:
        # 相邻块之间应存在内容重叠（后一块开头出现在前一块结尾附近）
        overlap_found = any(
            texts[i + 1][:10] in texts[i] or texts[i][-10:] in texts[i + 1]
            for i in range(len(texts) - 1)
        )
        assert overlap_found, "相邻分块间未观察到重叠内容"


def test_parse_blocks_carry_structured_fields():
    result = parse_evidence_blocks("正文内容若干。")
    for b in result["blocks"]:
        assert set(b.keys()) == {"page_number", "section_title", "text", "block_type"}
        assert b["page_number"] is None  # 纯文本通道无页码
        assert b["block_type"] == "text"


# ---------- 章节标题识别 ----------

def test_parse_recognizes_numbered_chapter_headings():
    text = "第一章 绪论\n\n这是绪论内容。\n\n第二章 方法\n\n这是方法内容。"
    result = parse_evidence_blocks(text)
    sections = [b["section_title"] for b in result["blocks"]]
    assert "第一章 绪论" in sections
    assert "第二章 方法" in sections
    # 标题本身不进入正文块
    assert all("绪论内容" not in (b["text"] or "") or b["section_title"] == "第一章 绪论" for b in result["blocks"])


def test_parse_recognizes_markdown_and_decimal_headings():
    text = "## Related Work\n\n相关工作内容。\n\n3.2 实验设置\n\n实验设置内容。"
    result = parse_evidence_blocks(text)
    sections = [b["section_title"] for b in result["blocks"]]
    assert "Related Work" in sections
    assert "3.2 实验设置" in sections


def test_parse_long_paragraph_starting_with_number_is_not_heading():
    # 超过 60 字的段落即使以数字开头也不应被识别为标题
    fake = "1. " + "这是一段以数字开头但远超标题长度的正文段落。" * 10
    result = parse_evidence_blocks(fake)
    assert all(b["section_title"] == "" for b in result["blocks"])


# ---------- 元数据启发 ----------

def test_parse_extracts_year_and_doi():
    text = (
        "Deep Learning for Medical Imaging\n\n"
        "本研究发表于 2023 年，提出了新方法。数据集 DOI 为 10.1234/abcd.5678，详见附录。"
    )
    meta = parse_evidence_blocks(text)["metadata"]
    assert meta["year"] == "2023"
    assert meta["doi"] == "10.1234/abcd.5678"


def test_parse_doi_trailing_punctuation_stripped():
    text = "文献标识：10.1000/xyz-2024."
    meta = parse_evidence_blocks(text)["metadata"]
    assert meta["doi"] == "10.1000/xyz-2024"


def test_parse_title_from_first_short_paragraph():
    text = "A Study on Retrieval Augmented Generation\n\n正文第一段较长一些，包含研究动机与主要贡献的描述。"
    meta = parse_evidence_blocks(text)["metadata"]
    assert meta["title"] == "A Study on Retrieval Augmented Generation"


def test_parse_no_false_metadata():
    meta = parse_evidence_blocks("仅有一段普通正文，没有任何元数据特征。")["metadata"]
    assert meta["year"] == ""
    assert meta["doi"] == ""


# ---------- MAX_BLOCKS 上限 ----------

def test_parse_caps_total_blocks():
    # 构造大量超长段落，确保块数量被 MAX_BLOCKS 截断而不是无限增长
    para = "长段落内容。" * 300  # 约 1500 字，chunk=200 时切成多块
    text = "\n\n".join([para] * 60)
    result = parse_evidence_blocks(text, chunk_chars=200, overlap_chars=0)
    from engine import MAX_BLOCKS
    assert len(result["blocks"]) <= MAX_BLOCKS


# ---------- 模式解析 ----------

def test_resolve_mode_env_override(monkeypatch):
    monkeypatch.setenv("RESEARCH_ENGINE_MODE", "builtin")
    assert resolve_mode() == "builtin"
    monkeypatch.setenv("RESEARCH_ENGINE_MODE", "PAPERQA ")
    assert resolve_mode() == "paperqa"


def test_resolve_mode_falls_back_to_availability(monkeypatch):
    monkeypatch.delenv("RESEARCH_ENGINE_MODE", raising=False)
    assert resolve_mode() == ("paperqa" if is_paperqa_available() else "builtin")
