#!/usr/bin/env python3
"""MorPex v9.2 全栈架构审计"""
import os, re, json, subprocess
from collections import defaultdict

ROOT = "/e/morpex"
errors, warnings, ok = [], [], []

def check(label, condition, detail=""):
    if condition:
        ok.append((label, detail))
    else:
        errors.append((label, detail))

def warn(label, condition, detail=""):
    if not condition:
        warnings.append((label, detail))

# ═══════════════════════════════════════════════
# 1. TypeScript 编译
# ═══════════════════════════════════════════════
print("=== 1. TypeScript Compilation ===")
result = subprocess.run(["npx", "tsc", "--noEmit", "--pretty"], cwd=ROOT, capture_output=True, text=True)
ts_ok = "error" not in result.stdout.lower() if result.stdout else result.returncode == 0
check("TypeScript 编译零错误", ts_ok, result.stdout[:200] if not ts_ok else "OK")

# ═══════════════════════════════════════════════
# 2. 文件统计 vs ARCHITECTURE 文档
# ═══════════════════════════════════════════════
print("=== 2. File Statistics ===")

def count_ts_files(base):
    count = 0
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in ('node_modules','dist','.git','data')]
        count += sum(1 for f in files if f.endswith('.ts') and not f.endswith('.d.ts'))
    return count

core_count = count_ts_files(f"{ROOT}/packages/core/src")
studio_count = count_ts_files(f"{ROOT}/packages/studio/server")
memory_count = count_ts_files(f"{ROOT}/packages/memory/src")
obs_count = count_ts_files(f"{ROOT}/packages/studio/server/observability")
total = core_count + studio_count + memory_count

print(f"  Core: {core_count} ts files")
print(f"  Studio Server: {studio_count} ts files (obs: {obs_count})")
print(f"  Memory: {memory_count} ts files")
print(f"  Total: {total} ts files")

# ═══════════════════════════════════════════════
# 3. Pi Import 检查（核心规则：adapters 之外禁 @earendil-works）
# ═══════════════════════════════════════════════
print("=== 3. Pi Import Audit ===")

def check_pi_imports(directory, allowed=False):
    violations = []
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if d not in ('node_modules','dist','.git','data')]
        for f in files:
            if not f.endswith('.ts') or f.endswith('.d.ts'): continue
            path = os.path.join(root, f)
            try:
                with open(path, 'r', encoding='utf-8', errors='ignore') as fh:
                    content = fh.read()
            except:
                continue
            imports = re.findall(r"from\s+['\"](@earendil-works/[^'\"]+)['\"]", content)
            if imports and not allowed:
                violations.append((os.path.relpath(path, directory), imports))
    return violations

# L1: Adapters 允许 Pi
adapters_pi = check_pi_imports(f"{ROOT}/packages/core/src/adapters", allowed=True)
# Core (排除 adapters/) 禁止 Pi
core_dirs = [d for d in os.listdir(f"{ROOT}/packages/core/src") 
             if os.path.isdir(f"{ROOT}/packages/core/src/{d}") and d != 'adapters']
core_violations = []
for d in core_dirs:
    core_violations += check_pi_imports(f"{ROOT}/packages/core/src/{d}")
# Studio 禁止 Pi (除非 Server 通过 Core adapters)
studio_violations = check_pi_imports(f"{ROOT}/packages/studio/server")
# Memory 禁止 Pi
memory_violations = check_pi_imports(f"{ROOT}/packages/memory/src")

check("Core (排除adapters) 零 Pi import", len(core_violations) == 0, 
      f"违规: {len(core_violations)} files" if core_violations else "OK")
check("Studio Server 零 Pi import", len(studio_violations) == 0,
      f"违规: {len(studio_violations)} files" if studio_violations else "OK")
check("Memory 零 Pi import", len(memory_violations) == 0,
      f"违规: {len(memory_violations)} files" if memory_violations else "OK")

if core_violations:
    for path, imps in core_violations[:5]:
        print(f"    ✗ Core违规: {path} → {imps}")
if studio_violations:
    for path, imps in studio_violations[:5]:
        print(f"    ✗ Studio违规: {path} → {imps}")
if memory_violations:
    for path, imps in memory_violations[:5]:
        print(f"    ✗ Memory违规: {path} → {imps}")

# ═══════════════════════════════════════════════
# 4. ARCHITECTURE_CONTRACT vs DEFAULT_MODULES 一致性
# ═══════════════════════════════════════════════
print("=== 4. Contract vs DEFAULT_MODULES ===")

# Read contract from source
contract_src = open(f"{ROOT}/packages/studio/server/observability/architecture-contract.ts", 'r').read()
contract_modules = set(re.findall(r"name:\s*'([^']+)'", contract_src))

types_src = open(f"{ROOT}/packages/studio/server/observability/types.ts", 'r').read()
default_modules = set(re.findall(r"name:\s*'([^']+)'", types_src))

only_contract = contract_modules - default_modules
only_default = default_modules - contract_modules

check("Contract 模块全部在 DEFAULT_MODULES 中", len(only_contract) == 0,
      f"仅Contract: {only_contract}" if only_contract else "OK")
warn("DEFAULT_MODULES 模块全部在 Contract 中", len(only_default) == 0,
     f"仅DEFAULT: {only_default}" if only_default else "OK")

# ═══════════════════════════════════════════════
# 5. emitInitTrace 覆盖
# ═══════════════════════════════════════════════
print("=== 5. emitInitTrace Coverage ===")

studio_src = open(f"{ROOT}/packages/studio/server/StudioServer.ts", 'r').read()
traced = set(re.findall(r"emitInitTrace\('([^']+)'", studio_src))
not_traced = default_modules - traced

check("所有 DEFAULT_MODULES 都有 emitInitTrace", len(not_traced) == 0,
      f"缺失: {not_traced}" if not_traced else "OK")

# ═══════════════════════════════════════════════
# 6. API 端点审计
# ═══════════════════════════════════════════════
print("=== 6. API Endpoints ===")

# Count routes in observability-api.ts and RuntimeAPI.ts
obs_api = open(f"{ROOT}/packages/studio/server/observability/observability-api.ts", 'r').read()
obs_routes = re.findall(r"router\.(get|post|put|delete)\('([^']+)'", obs_api)

runtime_api = open(f"{ROOT}/packages/studio/server/RuntimeAPI.ts", 'r').read()
runtime_routes = re.findall(r"router\.(get|post|put|delete)\('([^']+)'", runtime_api)

total_routes = len(obs_routes) + len(runtime_routes)
print(f"  Observability API: {len(obs_routes)} routes")
print(f"  Runtime API: {len(runtime_routes)} routes")
print(f"  Total: {total_routes} routes")

# ═══════════════════════════════════════════════
# 7. 运行时可观测性
# ═══════════════════════════════════════════════
print("=== 7. Runtime Observability ===")

import urllib.request
try:
    resp = urllib.request.urlopen("http://localhost:8080/api/observability/exercise-status", timeout=5)
    status = json.loads(resp.read())
    exercised = status['exercisedCount']
    total = status['totalModules']
    coverage = status['coverage']
    check(f"模块演练覆盖 >= 70", exercised >= 70, f"{exercised}/{total} ({coverage})")
    check(f"模块演练 100%", exercised == total, f"{exercised}/{total} ({coverage})")
    
    # Audit
    resp2 = urllib.request.urlopen("http://localhost:8080/api/observability/audit", timeout=5)
    audit = json.loads(resp2.read())['report']
    check(f"架构审计通过 (Health >= 90%)", audit['healthScore'] >= 90, 
          f"{audit['healthScore']}% OK={audit['summary']['ok']} WARN={audit['summary']['warning']} ERR={audit['summary']['error']}")
except Exception as e:
    errors.append(("无法连接服务器", str(e)))

# ═══════════════════════════════════════════════
# 总结
# ═══════════════════════════════════════════════
print("\n" + "="*60)
print("审计总结")
print("="*60)
print(f"  ✅ 通过: {len(ok)}")
for label, detail in ok:
    print(f"     ✓ {label}")
print(f"  ⚠️  警告: {len(warnings)}")
for label, detail in warnings:
    print(f"     ⚠ {label}: {detail}")
print(f"  ❌ 错误: {len(errors)}")
for label, detail in errors:
    print(f"     ✗ {label}: {detail}")

score = len(ok) / max(len(ok) + len(errors), 1) * 100
print(f"\n  健康评分: {score:.0f}%")
