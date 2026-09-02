"""Research Engine REST 接口（FastAPI）。

鉴权：设置 RESEARCH_ENGINE_API_KEY 后，所有请求需带 X-Api-Key 头。
设计原则与主后端 docling-client / grobid-client 一致：本服务自身不吞异常，
解析/问答失败一律返回明确错误，由 Node 客户端决定是否降级。
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from engine import parse_evidence_blocks, resolve_mode
from qa import answer_question
from conflict import detect_conflicts

app = FastAPI(title="ScholarForge Research Engine", version="1.0.0")

API_KEY = os.getenv("RESEARCH_ENGINE_API_KEY", "").strip()


def _auth(x_api_key: Optional[str] = Header(default=None)) -> None:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")


class ParseRequest(BaseModel):
    text: str = ""
    filename: str = "paper.pdf"
    chunk_chars: int = 900
    overlap_chars: int = 140


class AnswerRequest(BaseModel):
    question: str
    documents: List[Dict[str, Any]] = []
    limit: int = 5


class ConflictsRequest(BaseModel):
    claims: List[Dict[str, Any]] = []
    threshold: float = 0.06


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "mode": resolve_mode()}


@app.post("/api/v1/parse")
def parse(req: ParseRequest, _: None = Depends(_auth)):
    if not req.text:
        raise HTTPException(status_code=400, detail="text is required")
    return parse_evidence_blocks(req.text, req.filename, req.chunk_chars, req.overlap_chars)


@app.post("/api/v1/answer")
def answer(req: AnswerRequest, _: None = Depends(_auth)):
    if not req.question:
        raise HTTPException(status_code=400, detail="question is required")
    llm_config = {
        "base_url": os.getenv("LLM_BASE_URL", ""),
        "api_key": os.getenv("LLM_API_KEY", ""),
        "model": os.getenv("LLM_MODEL", ""),
    }
    return answer_question(req.question, req.documents, resolve_mode(), req.limit, llm_config)


@app.post("/api/v1/conflicts")
def conflicts(req: ConflictsRequest, _: None = Depends(_auth)):
    return detect_conflicts(req.claims, req.threshold)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("RESEARCH_ENGINE_PORT", "8100")))
