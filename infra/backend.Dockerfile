FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt

RUN python -m pip install --no-cache-dir \
    -r /app/backend/requirements.txt \
    && useradd --create-home --uid 10001 appuser

COPY backend /app/backend
COPY engine /app/engine

WORKDIR /app/backend

USER appuser

EXPOSE 8002

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
