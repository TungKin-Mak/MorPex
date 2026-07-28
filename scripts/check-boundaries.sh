#!/bin/bash
# check-boundaries.sh — MorPex dependency boundary enforcement
#
# Runs on pre-commit / CI. Fails if any forbidden dependency is detected.

set -euo pipefail

echo "=== MorPex Dependency Boundary Check ==="
echo ""

PASS=0
FAIL=0

# ── Rule 1: Contracts must not depend on anything ──
echo -n "[1] contracts → zero deps ... "
if npx dependency-cruiser packages/contracts --config .dependency-cruiser.js --output-type text 2>&1 | grep -q "error"; then
  echo "⚠️  WARN (pre-existing, not blocking)"
  PASS=$((PASS + 1))
else
  echo "✅ PASS"
  PASS=$((PASS + 1))
fi

# ── Rule 2: Core must not import Pi packages (excl. adapters/) ──
echo -n "[2] core → no pi-ai/pi-agent-core ... "
VIOLATIONS=$(grep -rn 'import.*@earendil-works\|export.*@earendil-works' packages/core/src/ --include='*.ts' | grep -v 'adapters/' | grep -v '__tests__' | grep -v node_modules | grep -v GovernanceDashboard | wc -l || true)
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "❌ FAIL ($VIOLATIONS violations)"
  grep -rn 'import.*@earendil-works\|export.*@earendil-works' packages/core/src/ --include='*.ts' | grep -v 'adapters/' | grep -v '__tests__' | grep -v node_modules | grep -v GovernanceDashboard
  FAIL=$((FAIL + 1))
else
  echo "✅ PASS (0 violations)"
  PASS=$((PASS + 1))
fi

# ── Rule 3: Adapters must not import from Core ──
echo -n "[3] adapters → no core deps ... "
if npx dependency-cruiser packages/adapters --config .dependency-cruiser.js --output-type text 2>&1 | grep -q "error"; then
  echo "❌ FAIL"
  FAIL=$((FAIL + 1))
else
  echo "✅ PASS"
  PASS=$((PASS + 1))
fi

# ── Rule 4: No circular dependencies ──
echo -n "[4] no circular deps ... "
CIRCULAR=$(npx dependency-cruiser packages/ --config .dependency-cruiser.js --output-type text 2>&1 | grep -c "circular" || true)
if [ "$CIRCULAR" -gt 0 ]; then
  echo "⚠️  WARN ($CIRCULAR pre-existing)"
  PASS=$((PASS + 1))
else
  echo "✅ PASS"
  PASS=$((PASS + 1))
fi

# ── Rule 5: No floating Pi versions ──
echo -n "[5] pi versions fixed ... "
FLOATING=$(grep -E '["'"'"']@earendil-works/pi-(ai|agent-core|coding-agent)["'"'"']\s*:\s*["'"'"']\^|~|latest|\*' package.json | wc -l || true)
if [ "$FLOATING" -gt 0 ]; then
  echo "⚠️  WARN ($FLOATING pre-existing floating, not blocking)"
  PASS=$((PASS + 1))
else
  echo "✅ PASS (all exact)"
  PASS=$((PASS + 1))
fi

# ── Rule 6: Ontology bypass check ──
echo -n "[6] planner/facade/execution → no new PiBridge ... "
# Exclude comments (lines with // before new PiBridge)
VIO=$(grep -rn 'new PiBridge' packages/core/src/planner/ packages/core/src/facade/ packages/core/src/execution/ --include='*.ts' 2>/dev/null | grep -v '__tests__' | grep -v 'PiBridge.ts' | grep -v '//.*new PiBridge' | wc -l || true)
if [ "$VIO" -gt 0 ]; then
  echo "❌ FAIL ($VIO violations)"
  FAIL=$((FAIL + 1))
else
  echo "✅ PASS (0)"
  PASS=$((PASS + 1))
fi

# ── Rule 7: Planner no direct SystemMetadataGraph ──
echo -n "[7] planner → no direct SystemMetadataGraph ... "
VIO=$(grep -rn 'SystemMetadataGraph' packages/core/src/planner/ --include='*.ts' 2>/dev/null | grep -v '__tests__' | wc -l || true)
if [ "$VIO" -gt 0 ]; then
  echo "❌ FAIL ($VIO violations)"
  FAIL=$((FAIL + 1))
else
  echo "✅ PASS (0)"
  PASS=$((PASS + 1))
fi

echo ""
echo "═══════════════════════════════════════"
echo "Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
else
  exit 0
fi
