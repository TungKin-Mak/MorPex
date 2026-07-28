#!/bin/bash
# check-ontology-bypass.sh — Ontology grounding 旁路扫描门禁
set -euo pipefail

PASS=0; FAIL=0
RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'

check() {
  local rule="$1" hits="$2"
  local count
  count=$(echo "$hits" | grep -c . || true)
  if [ "$count" -gt 0 ]; then
    echo -e "  ${RED}❌ FAIL${NC} $rule ($count 处违规)"
    echo "$hits" | sed 's/^/       /'
    FAIL=$((FAIL + 1))
  else
    echo -e "  ${GREEN}✅ PASS${NC} $rule"
    PASS=$((PASS + 1))
  fi
}

echo ""; echo "=== Ontology 旁路扫描 ==="; echo ""

# Rule 1: planner/facade/execution → new PiBridge（排除注释）
echo "[1] 规划层无 new PiBridge"
hits=$(grep -rn "new PiBridge" packages/core/src/planner/ packages/core/src/facade/ packages/core/src/execution/ 2>/dev/null \
  | grep -v "\.d\.ts" \
  | awk -F: '{$1=$2=""; sub(/^[[:space:]]+/, ""); if ($0 !~ /^\/\//) print}' \
  || true)
check "规划层无 new PiBridge" "$hits"

# Rule 2: planner 不直接碰 SystemMetadataGraph
echo "[2] planner 不直接碰 SystemMetadataGraph"
hits=$(grep -rn "import.*SystemMetadataGraph" packages/core/src/planner/ 2>/dev/null || true)
check "planner 不直接碰 SystemMetadataGraph" "$hits"

# Rule 3: execution/ 中无 new PiBridge
echo "[3] execution 无 new PiBridge"
hits=$(grep -rn "new PiBridge" packages/core/src/execution/ 2>/dev/null | grep -v "\.d\.ts" \
  | awk -F: '{$1=$2=""; sub(/^[[:space:]]+/, ""); if ($0 !~ /^\/\//) print}' \
  || true)
check "execution 无 new PiBridge" "$hits"

# Rule 4: extensions/planning 不直接导入 pi 包
echo "[4] planning 扩展无 pi 依赖"
hits=$(grep -rn "@earendil-works" packages/core/src/extensions/planning/ 2>/dev/null | grep -v "\.d\.ts" || true)
check "planning 扩展无直接 pi 依赖" "$hits"

echo ""; echo "=== $PASS 通过, $FAIL 失败 ==="; echo ""
exit $([ "$FAIL" -gt 0 ] && echo 1 || echo 0)
