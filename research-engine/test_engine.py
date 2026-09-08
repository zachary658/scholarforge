from engine import parse_evidence_blocks


def test_parse_evidence_blocks_preserves_section_metadata_and_doi():
    text = "研究标题 2024\n\n第一章 绪论\n\n这是第一段研究证据。\n\n第二章 方法\n\n方法证据，DOI 10.1000/example."
    result = parse_evidence_blocks(text, chunk_chars=100, overlap_chars=10)
    assert result["blocks"]
    assert any(block["section_title"] == "第一章 绪论" for block in result["blocks"])
    assert result["metadata"]["year"] == "2024"
    assert result["metadata"]["doi"] == "10.1000/example"


def test_parse_evidence_blocks_empty_input_is_safe():
    assert parse_evidence_blocks("  ")["blocks"] == []
