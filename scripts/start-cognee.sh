#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# start-cognee.sh — cognee 本地记忆引擎 一键部署/启动
#
# 无 Docker，Python 本地文件存储（SQLite + LanceDB + KuzuDB）。
# 用途：为 @morpex/memory 统一记忆层提供本地知识图谱引擎。
#
# 用法：
#   COGNEE_PORT=8001 ./scripts/start-cognee.sh          # 前台运行
#   COGNEE_PORT=8001 ./scripts/start-cognee.sh --bg     # 后台运行
#
# 环境变量（可配置，见 docs/MEMORY_DEPLOYMENT.md）：
#   COGNEE_PORT        端口（默认 8001）
#   DEEPSEEK_API_KEY   LLM key（或 LLM_API_KEY）
#   LLM_PROVIDER/LLM_MODEL/LLM_ENDPOINT   LLM 配置（默认 custom/deepseek）
#   COGNEE_DATA_DIR    数据目录（默认 ~/.morpex/cognee）
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${COGNEE_PORT:-8001}"
VENV_DIR="${COGNEE_VENV:-$ROOT/.venv-cognee}"
DATA_DIR="${COGNEE_DATA_DIR:-$HOME/.morpex/cognee}"
MODE="${1:-}"

echo "▶ cognee 记忆引擎部署（端口 ${PORT}，数据目录 ${DATA_DIR}）"

# ── 1. Python 环境 ──────────────────────────────────────────────────
command -v python3 >/dev/null 2>&1 || { echo "✗ 需要 python3"; exit 1; }
if [ ! -d "$VENV_DIR" ]; then
  echo "  · 创建 venv: $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi
PIP="$VENV_DIR/bin/pip"
"$PIP" install --quiet --upgrade pip
echo "  · 安装 cognee（首次较慢）"
"$PIP" install --quiet "cognee[fastembed]" || { echo "✗ cognee 安装失败"; exit 1; }

# ── 2. 数据目录 + 环境变量 ──────────────────────────────────────────
mkdir -p "$DATA_DIR"/{data,sys,cache}
export LLM_API_KEY="${LLM_API_KEY:-${DEEPSEEK_API_KEY:-}}"
export LLM_PROVIDER="${LLM_PROVIDER:-custom}"
export LLM_MODEL="${LLM_MODEL:-deepseek/deepseek-chat}"
export LLM_ENDPOINT="${LLM_ENDPOINT:-https://api.deepseek.com}"
export EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-fastembed}"
export EMBEDDING_MODEL="${EMBEDDING_MODEL:-BAAI/bge-small-en-v1.5}"
export EMBEDDING_DIMENSIONS="${EMBEDDING_DIMENSIONS:-384}"
export DATA_ROOT_DIRECTORY="$DATA_DIR/data"
export SYSTEM_ROOT_DIRECTORY="$DATA_DIR/sys"
export CACHE_ROOT_DIRECTORY="$DATA_DIR/cache"
export ENABLE_BACKEND_ACCESS_CONTROL="${ENABLE_BACKEND_ACCESS_CONTROL:-false}"
[ -n "$LLM_API_KEY" ] || { echo "✗ 缺少 LLM_API_KEY / DEEPSEEK_API_KEY"; exit 1; }

# ── 3. 启动 ─────────────────────────────────────────────────────────
if [ "$MODE" = "--bg" ]; then
  echo "  · 后台启动（nohup），日志: $DATA_DIR/server.log"
  nohup "$VENV_DIR/bin/python" -m uvicorn cognee.api.client:app --port "$PORT" \
    >>"$DATA_DIR/server.log" 2>&1 &
  sleep 8
  echo "  · 健康检查 http://localhost:${PORT}/health"
  curl -sf "http://localhost:${PORT}/health" >/dev/null && echo "✅ cognee 就绪 :${PORT}" || {
    echo "⚠ 尚未就绪，查看日志: $DATA_DIR/server.log"; tail -5 "$DATA_DIR/server.log"; }
else
  exec "$VENV_DIR/bin/python" -m uvicorn cognee.api.client:app --port "$PORT"
fi
