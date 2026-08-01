#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# run-all.sh — MorPex 全栈一键启动（开发模式）
#
# 启动 3 个服务：
#   1. cognee 记忆引擎    :8001   （Python，本地文件存储，统一记忆层）
#   2. Embedding Server   :3100   （Python BGE-M3，ZVec 向量化）
#   3. StudioServer 后端  :8080   （MorPex Core + 记忆系统接线）
#
# 用法：
#   ./scripts/run-all.sh            # 后台启动 cognee+embed，前台运行后端
#   ./scripts/run-all.sh --bg       # 全部后台运行（nohup）
#   ./scripts/run-all.sh --status   # 查看 3 个服务健康状态
#   ./scripts/run-all.sh stop       # 停止全部（后台模式）
#
# 环境变量：
#   COGNEE_PORT   (默认 8001)   COGNEE_URL   (默认 http://localhost:8001)
#   PORT          (默认 8080)   COGNEE_VENV  (cognee venv 路径，默认自动探测)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8080}"
COGNEE_PORT="${COGNEE_PORT:-8001}"
COGNEE_URL="${COGNEE_URL:-http://localhost:${COGNEE_PORT}}"
MODE="${1:-}"
PIDFILE="$ROOT/.run-all.pids"

# ── 探测 cognee venv（避免重复安装）──
pick_cognee_python() {
  if [ -n "${COGNEE_VENV:-}" ] && [ -d "$COGNEE_VENV" ]; then
    echo "$COGNEE_VENV/bin/python"
  elif [ -x "$ROOT/.venv-cognee/bin/python" ]; then
    echo "$ROOT/.venv-cognee/bin/python"
  elif [ -x "$HOME/AppData/Local/Temp/cognee_spike/.venv/Scripts/python.exe" ]; then
    # 上次 spike 的 venv（Windows Git Bash /tmp 映射到该路径）
    echo "$HOME/AppData/Local/Temp/cognee_spike/.venv/Scripts/python.exe"
  fi
}

status() {
  echo "── 服务状态 ──────────────────────────────"
  for spec in "cognee:${COGNEE_PORT}:http://localhost:${COGNEE_PORT}/health" "embed:3100:http://localhost:3100/health" "backend:${PORT}:http://localhost:${PORT}/api/health"; do
    name="${spec%%:*}"; rest="${spec#*:}"; p="${rest%%:*}"; url="${rest#*:}"
    if curl -sf -m 3 "$url" >/dev/null 2>&1; then
      echo "  ✅ $name  :$p 在线"
    else
      echo "  ❌ $name  :$p 离线"
    fi
  done
}

stop() {
  echo "── 停止后台服务 ──"
  if [ -f "$PIDFILE" ]; then
    while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  # 兜底：按端口停
  for port in "$COGNEE_PORT" 3100 "$PORT"; do
    pid="$(netstat -ano 2>/dev/null | awk -v p=":$port " '$4==p{print $5;exit}')"
    [ -n "${pid:-}" ] && taskkill //PID "$pid" //F 2>/dev/null || true
  done
  echo "  ✅ 已停止"
}

if [ "$MODE" = "stop" ]; then stop; exit 0; fi
if [ "$MODE" = "--status" ]; then status; exit 0; fi

mkdir -p "$ROOT/logs"
: > "$PIDFILE"

# ── 0. 环境变量（从 .env 读取 LLM key）──
export DEEPSEEK_API_KEY="$(awk -F= '/^DEEPSEEK_API_KEY=/{print $2}' "$ROOT/.env" | tr -d '\r')"
export LLM_API_KEY="${LLM_API_KEY:-$DEEPSEEK_API_KEY}"
export COGNEE_URL
export PORT
export MIRROR_PATH="${MIRROR_PATH:-./data/mirror}"
export FRONTEND_DIST="${FRONTEND_DIST:-./packages/studio/ui/dist}"

# ── 1. cognee 记忆引擎 ──
if ! curl -sf -m 2 "http://localhost:${COGNEE_PORT}/health" >/dev/null 2>&1; then
  echo "▶ 启动 cognee 记忆引擎 :${COGNEE_PORT} ..."
  VENV_PY="$(pick_cognee_python || true)"
  if [ -n "$VENV_PY" ] && [ -x "$VENV_PY" ]; then
    # 复用已装好的 venv，直接起 uvicorn（跳过 pip install）
    export LLM_PROVIDER="${LLM_PROVIDER:-custom}"
    export LLM_MODEL="${LLM_MODEL:-deepseek/deepseek-chat}"
    export LLM_ENDPOINT="${LLM_ENDPOINT:-https://api.deepseek.com}"
    export EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-fastembed}"
    export EMBEDDING_MODEL="${EMBEDDING_MODEL:-BAAI/bge-small-en-v1.5}"
    export EMBEDDING_DIMENSIONS="${EMBEDDING_DIMENSIONS:-384}"
    DATA_DIR="${COGNEE_DATA_DIR:-$HOME/.morpex/cognee}"
    mkdir -p "$DATA_DIR"/{data,sys,cache,logs}
    export DATA_ROOT_DIRECTORY="$DATA_DIR/data"
    export SYSTEM_ROOT_DIRECTORY="$DATA_DIR/sys"
    export CACHE_ROOT_DIRECTORY="$DATA_DIR/cache"
    export ENABLE_BACKEND_ACCESS_CONTROL="${ENABLE_BACKEND_ACCESS_CONTROL:-false}"
    if [ "$MODE" = "--bg" ]; then
      nohup "$VENV_PY" -m uvicorn cognee.api.client:app --port "$COGNEE_PORT" \
        >>"$ROOT/logs/cognee.log" 2>&1 &
      echo $! >> "$PIDFILE"
    else
      nohup "$VENV_PY" -m uvicorn cognee.api.client:app --port "$COGNEE_PORT" \
        >>"$ROOT/logs/cognee.log" 2>&1 &
      echo $! >> "$PIDFILE"
    fi
    sleep 8
    curl -sf -m 3 "http://localhost:${COGNEE_PORT}/health" >/dev/null && echo "  ✅ cognee 就绪 :${COGNEE_PORT}" || { echo "  ⚠ cognee 未就绪，见 logs/cognee.log"; tail -5 "$ROOT/logs/cognee.log"; }
  else
    echo "  · 未找到现成 venv，改用 start-cognee.sh（首次会装依赖，较慢）"
    COGNEE_PORT="$COGNEE_PORT" ./scripts/start-cognee.sh --bg || true
  fi
else
  echo "▶ cognee 已在运行 :${COGNEE_PORT}"
fi

# ── 2. Embedding Server ──
if ! curl -sf -m 2 "http://localhost:3100/health" >/dev/null 2>&1; then
  echo "▶ 启动 Embedding Server :3100 ..."
  nohup python -u tools-python/embedding-server.py --model-path data/models/bge-m3 --mode http --port 3100 \
    >>"$ROOT/logs/embedding.log" 2>&1 &
  echo $! >> "$PIDFILE"
  sleep 6
  curl -sf -m 3 "http://localhost:3100/health" >/dev/null && echo "  ✅ Embedding 就绪 :3100" || echo "  ⚠ Embedding 加载中（BGE-M3 预热），见 logs/embedding.log"
else
  echo "▶ Embedding 已在运行 :3100"
fi

# ── 3. 后端 ──
if [ "$MODE" = "--bg" ]; then
  echo "▶ 后台启动 StudioServer :${PORT} ..."
  nohup node --import tsx/esm packages/studio/server/index.ts >>"$ROOT/logs/backend.log" 2>&1 &
  echo $! >> "$PIDFILE"
  sleep 12
  curl -sf -m 3 "http://localhost:${PORT}/api/health" >/dev/null && echo "  ✅ 后端就绪 :${PORT}" || { echo "  ⚠ 后端启动中/失败，见 logs/backend.log"; tail -10 "$ROOT/logs/backend.log"; }
else
  echo "▶ 前台启动 StudioServer :${PORT} （Ctrl+C 停止）"
  echo "   REST API: http://localhost:${PORT}/api"
  exec node --import tsx/esm packages/studio/server/index.ts
fi

status
