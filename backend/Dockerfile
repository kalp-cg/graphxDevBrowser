FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 LOCAL_GRAPH_DIR=/data
RUN useradd --create-home --uid 10001 sentinel && mkdir -p /data /projects && chown sentinel /data
COPY requirements.txt .
RUN pip install -r requirements.txt && apt-get update -qq && apt-get install -y -qq --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
COPY sentinel ./sentinel
USER sentinel
EXPOSE 8100
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request,os; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.getenv('PORT','8100'), timeout=4)"
# A fresh install starts empty: connect a project from DevBrowser. SEED_DEMO=1 loads the sample company instead
# (what the hosted demo uses). Hosts like Render pass the port in $PORT.
CMD ["sh", "-c", "if [ \"${SEED_DEMO:-0}\" = \"1\" ]; then python -m sentinel.seed --if-empty; fi && uvicorn sentinel.api.main:app --host 0.0.0.0 --port ${PORT:-8100}"]
