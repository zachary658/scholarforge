"""conflict.detect_conflicts 冲突检测与去重测试。"""
from conflict import detect_conflicts


def test_positive_vs_negative_direction_conflict_detected():
    claims = [
        {"text": "方法A相比基线显著提升准确率", "source_title": "论文一"},
        {"text": "方法A相比基线无显著差异，效果有限", "source_title": "论文二"},
    ]
    result = detect_conflicts(claims, threshold=0.06)
    assert len(result["conflicts"]) == 1
    c = result["conflicts"][0]
    assert c["source_a"] == "论文一"
    assert c["source_b"] == "论文二"
    assert c["similarity"] > 0


def test_reversed_direction_also_detected():
    claims = [
        {"text": "该干预措施效果有限，未改善结果", "source_title": "甲"},
        {"text": "该干预措施有效，优于对照组", "source_title": "乙"},
    ]
    assert len(detect_conflicts(claims)["conflicts"]) == 1


def test_same_direction_claims_not_conflict():
    claims = [
        {"text": "方法显著提升准确率", "source_title": "甲"},
        {"text": "方法有效改善召回率", "source_title": "乙"},
    ]
    assert detect_conflicts(claims)["conflicts"] == []


def test_unrelated_topics_not_conflict_even_opposite_direction():
    # 方向相反但主题完全不同：相似度低于阈值，不报冲突
    claims = [
        {"text": "施肥显著提升作物产量", "source_title": "农业研究"},
        {"text": "神经网络剪枝无显著精度损失", "source_title": "ML研究"},
    ]
    assert detect_conflicts(claims, threshold=0.06)["conflicts"] == []


def test_similarity_threshold_filters_borderline_pairs():
    claims = [
        {"text": "新的训练策略显著提升模型效果", "source_title": "甲"},
        {"text": "新的训练策略效果不显著", "source_title": "乙"},
    ]
    low = detect_conflicts(claims, threshold=0.99)["conflicts"]
    assert low == []
    # 阈值足够低时同一对会被检出（自洽性：降低阈值只增不减）
    high = detect_conflicts(claims, threshold=0.0)["conflicts"]
    assert len(high) == 1


def test_no_self_comparison_and_no_duplicates():
    # 单条 claim 不与自身比较；pair 只产出一次（i<j）
    claims = [
        {"text": "该技术在任务上显著优于基线方法", "source_title": "A"},
        {"text": "该技术在任务上不显著优于基线方法", "source_title": "B"},
    ]
    conflicts = detect_conflicts(claims)["conflicts"]
    pairs = {(c["source_a"], c["source_b"]) for c in conflicts}
    assert len(pairs) == len(conflicts)  # 无重复
    assert ("A", "A") not in pairs  # 无自比


def test_empty_claims_returns_empty():
    assert detect_conflicts([]) == {"conflicts": []}


def test_malformed_claims_treated_as_empty_text():
    # 缺 text / text=None 的条目按空串处理，不抛异常
    # （None 元素由 FastAPI 的 pydantic 校验在 HTTP 边界挡下，见 test_api.py）
    claims = [{}, {"text": None, "source_title": "x"}, {"text": "方法显著有效", "source_title": "y"}]
    result = detect_conflicts(claims)
    assert "conflicts" in result


def test_english_patterns_supported():
    claims = [
        {"text": "Our model significantly outperform the baseline on GLUE", "source_title": "EN-1"},
        {"text": "No significant improvement was observed on GLUE", "source_title": "EN-2"},
    ]
    result = detect_conflicts(claims, threshold=0.05)
    assert len(result["conflicts"]) == 1
