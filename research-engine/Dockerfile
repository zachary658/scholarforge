FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

ARG RESEARCH_REQUIREMENTS=requirements.txt
COPY requirements.txt requirements-full.txt ./
RUN pip install --upgrade pip && pip install -r "${RESEARCH_REQUIREMENTS}"

COPY --chown=nobody:nogroup engine.py qa.py conflict.py server.py ./

# 服务不需要写入应用目录或使用特权端口。
USER nobody

EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8100/api/v1/health', timeout=3)"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8100"]
