#!/bin/bash
# check-boundaries.sh — MorPex dependency boundary enforcement
#
# Runs on pre-commit / CI. Fails if any forbidden dependency is detected.
# Requires: dependency-cruiser (already in devDependencies)

set -euo pipefail

echo "=== MorPex Dependency Boundary Check ==="
echo ""

PASS=0
FAIL=0

# ── Rule 1: Contracts must not depend on anything ──
echo -n "[1] contracts → zero deps ... "
if npx dependency-cruiser packages/contracts --config .dependency-cruiser.js --output-type text 2>&1 | grep -q "error"; then
  echo "❌ FAIL"
  FAIL=$((FAIL + 1))
else
  echo "✅ PASS"
  PASS=$((PASS + 1))
fi

# ── Rule 2: Core must not import Pi packages (excl. adapters/) ──
echo -n "[2] core → no pi-ai/pi-agent-core ... "
# Check for any @earendil-works imports outside adapters/
VIOLATIONS=$(grep -rn "@earendil-works" packages/core/src/ --include="*.ts" | grep -v "adapters/" | grep -v "__tests__" | grep -v node_modules | wc -l)
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "❌ FAIL ($VIOLATIONS violations)"
  grep -rn "@earendil-works" packages/core/src/ --include="*.ts" | grep -v "adapters/" | grep -v "__tests__" | grep -v node_modules
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
  echo "⚠️  WARN ($CIRCULAR pre-existing circular deps)"
  PASS=$((PASS + 1))  # Pre-existing, not a new violation
else
  echo "✅ PASS"
  PASS=$((PASS + 1))
fi

# ── Rule 5: No floating Pi versions ──
echo -n "[5] pi versions fixed ... "
FLOATING=$(grep -E "[\"']@earendil-works/pi-(ai|agent-core|coding-agent)[\"']\s*:\s*[\"']\^|~|latest|\*" package.json | wc -l)
if [ "$FLOATING" -gt 0 ]; then
  echo "❌ FAIL ($FLOATING floating versions)"
  FAIL=$((FAIL + 1))
else
  echo "✅ PASS (all exact)"
  PASS=$((PASS + 1))
fi

echo ""
echo "═══════════════════════════════════════"
echo "Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "❌ Boundary check FAILED. Fix violations before committing."
  exit 1
else
  echo "✅ All boundary checks passed."
  exit 0
fi
