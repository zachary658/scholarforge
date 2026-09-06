"""qa 检索 / tokenize / 降级路径测试。"""
from qa import tokenize, _jaccard, _retrieve, answer_question


# ---------- tokenize ----------

def test_tokenize_chinese_uses_bigrams():
    assert tokenize("深度学习") == ["深度", "度学", "学习"]


def test_tokenize_single_cjk_char_kept():
    assert tokenize("图") == ["图"]


def test_tokenize_english_lowercased():
    tokens = tokenize("Transformer Neural Networks")
    assert tokens == ["transformer", "neural", "networks"]


def test_tokenize_mixed_content():
    tokens = tokenize("BERT-2023 在 GLUE 上")
    assert "bert-2023" in tokens or "bert" in tokens
    assert "glue" in tokens
    assert "在" in tokens


def test_tokenize_empty_and_none():
    assert tokenize("") == []
    assert tokenize(None) == []


# ---------- Jaccard ----------

def test_jaccard_identical():
    assert _jaccard(["a", "b"], ["a", "b"]) == 1.0


def test_jaccard_disjoint():
    assert _jaccard(["a"], ["b"]) == 0.0


def test_jaccard_empty_set():
    assert _jaccard([], ["a"]) == 0.0
    assert _jaccard([], []) == 0.0


# ---------- 检索 ----------

def test_retrieve_ranks_by_relevance():
    docs = [
        {"title": "无关文档", "text": "完全不相干的内容"},
        {"title": "目标文档", "text": "注意力机制是 Transformer 的核心，注意力机制通过查询键值实现"},
    ]
    hits = _retrieve("注意力机制", docs, limit=2)
    assert hits
    assert hits[0]["title"] == "目标文档"
    assert "_score" in hits[0]


def test_retrieve_phrase_exact_match_bonus():
    docs = [
        {"title": "A", "text": "检索增强生成技术综述"},
        {"title": "B", "text": "生成 技术另有其他含义 检索"},
    ]
    hits = _retrieve("检索增强生成", docs, limit=2)
    assert hits[0]["title"] == "A"


def test_retrieve_no_match_returns_empty():
    docs = [{"title": "X", "text": "完全不相关"}]
    assert _retrieve("量子纠缠", docs, limit=5) == []


def test_retrieve_unusable_question_falls_back_to_head():
    # 空白问题 tokenize 后无 token：退化为按原顺序取前 limit 个
    docs = [{"title": str(i), "text": f"内容{i}"} for i in range(4)]
    hits = _retrieve("  ", docs, limit=2)
    assert [h["title"] for h in hits] == ["0", "1"]


def test_retrieve_respects_limit():
    docs = [{"title": str(i), "text": "共同关键词内容"} for i in range(10)]
    assert len(_retrieve("共同关键词", docs, limit=3)) == 3


# ---------- answer_question：builtin 模式 ----------

def test_answer_builtin_returns_evidence_without_generation():
    docs = [{"title": "论文A", "text": "方法显著提升准确率至 95%。", "page_number": 3}]
    result = answer_question("方法效果如何", docs, mode="builtin", limit=5)
    assert result["mode"] == "builtin"
    assert result["answer"] == ""  # 不做生成式问答，防编造
    assert len(result["evidence"]) == 1
    ev = result["evidence"][0]
    assert ev["quote"].startswith("方法显著提升")
    assert ev["title"] == "论文A"
    assert ev["page_number"] == 3


def test_answer_builtin_truncates_long_quotes():
    # 注意 tokenize 对中文用二元词组：question 需与文档 bigram 重合才可命中
    docs = [{"title": "长文", "text": "字" * 5000}]
    result = answer_question("字字", docs, mode="builtin", limit=5)
    assert len(result["evidence"][0]["quote"]) <= 1200


def test_answer_builtin_empty_documents():
    result = answer_question("任意问题", [], mode="builtin", limit=5)
    assert result == {"answer": "", "evidence": [], "mode": "builtin"}


def test_answer_builtin_handles_malformed_documents():
    # 非法文档（None text / 缺字段）不应抛异常
    docs = [{"title": None, "text": None}, {}, {"text": "正常证据内容"}]
    result = answer_question("证据", docs, mode="builtin", limit=5)
    assert result["mode"] == "builtin"


# ---------- answer_question：paperqa 降级路径 ----------

def test_answer_paperqa_failure_degrades_to_builtin(monkeypatch):
    """paperqa 模式抛任何异常都必须降级 builtin，不向上传播。"""
    import qa as qa_mod

    def _boom(*args, **kwargs):
        raise RuntimeError("paperqa backend unavailable")

    monkeypatch.setattr(qa_mod, "_answer_paperqa", _boom)
    docs = [{"title": "论文", "text": "包含关键词的证据原文。"}]
    result = answer_question("关键词", docs, mode="paperqa", limit=5)
    assert result["mode"] == "builtin"
    assert result["evidence"]


def test_answer_paperqa_timeout_degrades_to_builtin(monkeypatch):
    import qa as qa_mod

    def _timeout(*args, **kwargs):
        raise TimeoutError("llm request timed out")

    monkeypatch.setattr(qa_mod, "_answer_paperqa", _timeout)
    result = answer_question("q", [{"text": "t"}], mode="paperqa", limit=5)
    assert result["mode"] == "builtin"


def test_answer_paperqa_success_passthrough(monkeypatch):
    import qa as qa_mod

    def _ok(question, documents, limit, llm_config):
        return {"answer": "据论文A，方法有效。", "evidence": [{"quote": "方法有效", "title": "论文A", "page_number": 2}], "mode": "paperqa"}

    monkeypatch.setattr(qa_mod, "_answer_paperqa", _ok)
    result = answer_question("效果", [{"text": "x"}], mode="paperqa", limit=5)
    assert result["mode"] == "paperqa"
    assert result["answer"].startswith("据论文A")


def test_answer_paperqa_invalid_response_falls_back(monkeypatch):
    """后端返回非预期结构（缺字段/None）时也走降级，不崩服务。"""
    import qa as qa_mod

    monkeypatch.setattr(qa_mod, "_answer_paperqa", lambda *a, **k: None)
    result = answer_question("q", [{"text": "内容"}], mode="paperqa", limit=5)
    assert result["mode"] == "builtin"
