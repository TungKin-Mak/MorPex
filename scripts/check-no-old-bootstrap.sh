#!/bin/bash
# CI check: forbid importing old bootstrap files
# Usage: scripts/check-no-old-bootstrap.sh

echo "[check] Scanning for old bootstrap imports..."

FOUND=0
for PATTERN in "bootstrap-v12" "bootstrap-v13" "bootstrap-v14" "bootstrap-v15" "bootstrap-v16"; do
    # Search source files, exclude node_modules, tests, index.ts, and doc comments
    MATCHES=$(grep -rn "from.*$PATTERN" packages/ --include="*.ts" \
        | grep -v "node_modules" \
        | grep -v "__tests__" \
        | grep -v "packages/core/src/index.ts" \
        | grep -v "packages/core/src/bootstrap-$PATTERN.ts" \
        | grep -v "packages/archived" \
        || true)
    if [ -n "$MATCHES" ]; then
        echo "[FAIL] Found imports of deprecated $PATTERN:"
        echo "$MATCHES"
        FOUND=1
    fi
done

if [ "$FOUND" -eq 1 ]; then
    echo "[FAIL] Old bootstrap imports forbidden. Use bootstrapUnified() instead."
    exit 1
else
    echo "[PASS] No old bootstrap imports found"
    exit 0
fi
