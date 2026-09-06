"""FastAPI 接口契约测试（TestClient）：参数校验、鉴权、响应结构、异常输入。"""
import pytest
from fastapi.testclient import TestClient

from server import app

client = TestClient(app)


# ---------- 健康检查 ----------

def test_health_returns_status_and_mode():
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["mode"] in ("paperqa", "builtin")


# ---------- /api/v1/parse ----------

def test_parse_happy_path_contract():
    r = client.post("/api/v1/parse", json={"text": "第一章 绪论\n\n研究背景与动机。", "filename": "a.pdf"})
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["blocks"], list) and body["blocks"]
    assert set(body["blocks"][0].keys()) == {"page_number", "section_title", "text", "block_type"}
    assert set(body["metadata"].keys()) == {"title", "authors", "doi", "year", "journal"}


def test_parse_empty_text_rejected_400():
    r = client.post("/api/v1/parse", json={"text": ""})
    assert r.status_code == 400
    assert "text" in r.json()["detail"]


def test_parse_missing_body_rejected_422():
    r = client.post("/api/v1/parse", json={})
    # text 有默认值 ""，走 400 分支而非 422
    assert r.status_code == 400


def test_parse_custom_chunk_params_respected():
    text = "长正文。" * 400
    r = client.post("/api/v1/parse", json={"text": text, "chunk_chars": 200, "overlap_chars": 0})
    assert r.status_code == 200
    blocks = r.json()["blocks"]
    assert len(blocks) > 1
    assert all(len(b["text"]) <= 200 for b in blocks)


def test_parse_non_string_text_rejected_422():
    r = client.post("/api/v1/parse", json={"text": 12345})
    assert r.status_code == 422  # pydantic 类型校验


# ---------- /api/v1/answer ----------

def test_answer_happy_path_contract():
    docs = [{"title": "论文A", "text": "证据：方法显著有效。", "page_number": 7}]
    r = client.post("/api/v1/answer", json={"question": "方法是否有效", "documents": docs, "limit": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] in ("paperqa", "builtin")
    assert isinstance(body["evidence"], list)
    if body["mode"] == "builtin":
        assert body["answer"] == ""
        assert body["evidence"][0]["title"] == "论文A"


def test_answer_empty_question_rejected_400():
    r = client.post("/api/v1/answer", json={"question": "", "documents": []})
    assert r.status_code == 400


def test_answer_missing_question_rejected_422():
    # question 为必填字段，缺省走 pydantic 校验
    r = client.post("/api/v1/answer", json={"documents": []})
    assert r.status_code == 422


def test_answer_empty_documents_returns_empty_evidence():
    r = client.post("/api/v1/answer", json={"question": "任意问题", "documents": []})
    assert r.status_code == 200
    body = r.json()
    assert body["evidence"] == []


def test_answer_limit_bounds_contract():
    docs = [{"title": str(i), "text": f"共享关键词{i}"} for i in range(10)]
    r = client.post("/api/v1/answer", json={"question": "共享关键词", "documents": docs, "limit": 2})
    assert r.status_code == 200
    assert len(r.json()["evidence"]) <= 2


# ---------- /api/v1/conflicts ----------

def test_conflicts_happy_path_contract():
    claims = [
        {"text": "方法显著提升效果", "source_title": "甲"},
        {"text": "方法效果不显著", "source_title": "乙"},
    ]
    r = client.post("/api/v1/conflicts", json={"claims": claims, "threshold": 0.05})
    assert r.status_code == 200
    conflicts = r.json()["conflicts"]
    assert len(conflicts) == 1
    assert set(conflicts[0].keys()) == {"a", "b", "source_a", "source_b", "similarity"}


def test_conflicts_empty_claims():
    r = client.post("/api/v1/conflicts", json={"claims": []})
    assert r.status_code == 200
    assert r.json()["conflicts"] == []


def test_conflicts_defaults_applied():
    # 缺省 claims/threshold 也有默认值，不 422
    r = client.post("/api/v1/conflicts", json={})
    assert r.status_code == 200
    assert r.json()["conflicts"] == []


def test_conflicts_invalid_threshold_type_422():
    r = client.post("/api/v1/conflicts", json={"claims": [], "threshold": "not-a-float"})
    assert r.status_code == 422


# ---------- 未知路由 ----------

def test_conflicts_null_claim_element_rejected_422():
    # pydantic 在 HTTP 边界挡住 None 元素，不进入业务函数
    r = client.post("/api/v1/conflicts", json={"claims": [None]})
    assert r.status_code == 422


def test_unknown_route_returns_404():
    assert client.get("/api/v1/nonexistent").status_code == 404


# ---------- API Key 鉴权（隔离全局 API_KEY 状态） ----------

def _fresh_client():
    """重新导入 server 模块以应用新的环境变量（FastAPI TestClient 状态隔离）。"""
    import importlib
    import server as server_mod
    importlib.reload(server_mod)
    return TestClient(server_mod.app)


def test_api_key_enforced_when_configured(monkeypatch):
    monkeypatch.setenv("RESEARCH_ENGINE_API_KEY", "secret-key-123")
    c = _fresh_client()
    # 业务接口需要鉴权
    r = c.post("/api/v1/parse", json={"text": "内容"})
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid api key"


def test_api_key_accepted_when_correct(monkeypatch):
    monkeypatch.setenv("RESEARCH_ENGINE_API_KEY", "secret-key-123")
    c = _fresh_client()
    r = c.post(
        "/api/v1/parse",
        json={"text": "正文内容。"},
        headers={"X-Api-Key": "secret-key-123"},
    )
    assert r.status_code == 200


def test_api_key_rejects_wrong_value(monkeypatch):
    monkeypatch.setenv("RESEARCH_ENGINE_API_KEY", "secret-key-123")
    c = _fresh_client()
    r = c.post(
        "/api/v1/parse",
        json={"text": "正文内容。"},
        headers={"X-Api-Key": "wrong"},
    )
    assert r.status_code == 401


def test_api_key_blank_env_disables_auth(monkeypatch):
    monkeypatch.setenv("RESEARCH_ENGINE_API_KEY", "   ")
    c = _fresh_client()
    assert c.post("/api/v1/parse", json={"text": "内容。"}).status_code == 200
