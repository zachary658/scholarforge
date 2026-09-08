from conflict import detect_conflicts


def test_detect_conflicts_requires_opposite_direction_and_shared_topic():
    result = detect_conflicts([
        {"text": "该模型显著提升医学影像分割准确率", "source_title": "论文A"},
        {"text": "该模型对医学影像分割准确率无显著改善", "source_title": "论文B"},
        {"text": "乡村物流模式有效", "source_title": "论文C"},
    ])
    assert len(result["conflicts"]) == 1
    assert result["conflicts"][0]["source_a"] == "论文A"


def test_detect_conflicts_does_not_flag_same_direction():
    result = detect_conflicts([
        {"text": "方法显著提升识别率"},
        {"text": "新方法提高识别率"},
    ])
    assert result["conflicts"] == []
