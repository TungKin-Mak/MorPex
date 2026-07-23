#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# MorPex k6 Load Test Runner
# 
# 用法:
#   bash scripts/run-k6-test.sh              # 默认负载 (阶梯式 10→200 VU)
#   bash scripts/run-k6-test.sh --smoke      # 冒烟测试 (5 VU, 30s)
#   bash scripts/run-k6-test.sh --stress     # 压力测试 (200 VU, 5min)
#   bash scripts/run-k6-test.sh --soak       # 浸泡测试 (100 VU, 30min)
#   bash scripts/run-k6-test.sh --custom 50 120  # 自定义 (50 VU, 120s)
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
K6_SCRIPT="$SCRIPT_DIR/k6-load-test.js"
RESULTS_DIR="$PROJECT_DIR/data/k6-results"

# Defaults
MODE="default"
VUS=""
DURATION=""
BASE_URL="${BASE_URL:-http://localhost:3100}"
API_URL="${API_URL:-http://localhost:3001}"

# Parse args
case "${1:-default}" in
  --smoke)
    MODE="smoke"
    VUS=5
    DURATION="30s"
    ;;
  --stress)
    MODE="stress"
    VUS=200
    DURATION="300s"
    ;;
  --soak)
    MODE="soak"
    VUS=100
    DURATION="1800s"
    ;;
  --custom)
    MODE="custom"
    VUS="${2:-50}"
    DURATION="${3:-120s}"
    ;;
  default|--default)
    MODE="default"
    ;;
  *)
    echo -e "${RED}Unknown mode: $1${NC}"
    echo "Usage: bash scripts/run-k6-test.sh [--smoke|--stress|--soak|--custom VUS DURATION]"
    exit 1
    ;;
esac

# Check k6 installation
if ! command -v k6 &> /dev/null; then
  echo -e "${YELLOW}⚠️  k6 not found. Install options:${NC}"
  echo "  macOS:   brew install k6"
  echo "  Linux:   sudo apt-get install k6  OR  sudo gpg -k && echo '...' | sudo tee /etc/apt/sources.list.d/k6.list && sudo apt-get update && sudo apt-get install k6"
  echo "  Windows: choco install k6  OR  winget install k6"
  echo "  Docker:  docker run --rm -i grafana/k6 run - < scripts/k6-load-test.js"
  echo ""
  echo -e "${CYAN}Running via Docker instead...${NC}"
  
  mkdir -p "$RESULTS_DIR"
  
  docker run --rm -i \
    --network host \
    -v "$PROJECT_DIR/scripts:/scripts" \
    -e BASE_URL="$BASE_URL" \
    -e API_URL="$API_URL" \
    grafana/k6 run \
    ${VUS:+--vus $VUS} \
    ${DURATION:+--duration $DURATION} \
    /scripts/k6-load-test.js \
    2>&1 | tee "$RESULTS_DIR/k6-$(date +%Y%m%d_%H%M%S).log"
  
  exit $?
fi

# Pre-flight check
echo -e "${CYAN}╔════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  MorPex k6 Load Test — $MODE mode        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Base URL:  ${GREEN}$BASE_URL${NC}"
echo -e "  API URL:   ${GREEN}$API_URL${NC}"
echo -e "  Mode:      ${YELLOW}$MODE${NC}"
echo -e "  VUs:       ${YELLOW}${VUS:-staged}${NC}"
echo -e "  Duration:  ${YELLOW}${DURATION:-staged}${NC}"
echo ""

# Check endpoints are reachable
echo -e "${CYAN}Pre-flight health check...${NC}"
if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "${BASE_URL}/health" 2>/dev/null | grep -q "200"; then
  echo -e "  ${GREEN}✅ Health endpoint OK${NC}"
else
  echo -e "  ${YELLOW}⚠️  Health endpoint not reachable at $BASE_URL/health${NC}"
  echo -e "  ${YELLOW}   Make sure the server is running: npm run dev${NC}"
fi

# Create results directory
mkdir -p "$RESULTS_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULT_FILE="$RESULTS_DIR/k6-summary-${MODE}-${TIMESTAMP}.json"

echo ""
echo -e "${CYAN}Starting k6 test...${NC}"
echo ""

# Run k6
k6 run \
  ${VUS:+--vus $VUS} \
  ${DURATION:+--duration $DURATION} \
  --summary-export "$RESULT_FILE" \
  --out json="$RESULTS_DIR/k6-metrics-${MODE}-${TIMESTAMP}.json" \
  "$K6_SCRIPT"

EXIT_CODE=$?

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════╗${NC}"
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${CYAN}║  ${GREEN}✅ All thresholds met${CYAN}                   ║${NC}"
else
  echo -e "${CYAN}║  ${RED}❌ Thresholds exceeded (code: $EXIT_CODE)${CYAN}      ║${NC}"
fi
echo -e "${CYAN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Summary: ${GREEN}$RESULT_FILE${NC}"
echo ""

exit $EXIT_CODE
