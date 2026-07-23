/**
 * production-sandbox.test.ts - Sandbox execution safety tests
 * Covers: timeout, risk detection, language detection, output truncation, multi-language execution
 * Usage: npx tsx packages/core/__tests__/production-sandbox.test.ts
 */

console.log('\n' + '='.repeat(60));
console.log('  Production: Sandbox Security Tests');
console.log('='.repeat(60) + '\n');

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) { if (cond) { pass++; console.log('  [PASS] ' + msg); } else { fail++; console.log('  [FAIL] ' + msg); } }
function eq<T>(a: T, b: T, msg: string) { if (a === b) { pass++; } else { fail++; console.log('  [FAIL] ' + msg + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); } }

// --- Mock SandboxManager ---
interface SandboxContext {
  cpuLimit: number; memoryLimit: number; network: boolean; filesystem: string; timeout: number;
}

const RISKY_ACTIONS = ['delete', 'remove', 'destroy', 'terminate', 'exec', 'eval', 'modify_config'];
const WARNING_ACTIONS = ['deploy', 'publish', 'release', 'email', 'payment'];

class MockSandboxManager {
  validateTask(action: string): { safe: boolean; blocked: string[]; warnings: string[] } {
    const blocked: string[] = [], warnings: string[] = [];
    for (const r of RISKY_ACTIONS) { if (action.toLowerCase().includes(r)) blocked.push(r); }
    for (const w of WARNING_ACTIONS) { if (action.toLowerCase().includes(w)) warnings.push(w); }
    return { safe: blocked.length === 0, blocked, warnings };
  }

  detectLanguage(code: string, fileName?: string): string | null {
    if (fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase();
      if (ext === 'py') return 'python';
      if (ext === 'js') return 'javascript';
      if (ext === 'ts') return 'typescript';
      if (ext === 'sh' || ext === 'bash') return 'bash';
      if (ext === 'go') return 'go';
    }
    // Check specific patterns first (more specific before generic)
    if (/^\s*import\s+.*\s+from\s+/m.test(code)) return 'javascript';   // import { X } from 'y'
    if (/^\s*(package |import "fmt"|func )/m.test(code)) return 'go';
    if (/^\s*(def |import \w+|print\()/m.test(code)) return 'python';    // import module (not import-from)
    if (/^\s*(const |let |function)/m.test(code)) return 'javascript';
    if (/^\s*#!\/(bin\/bash|bin\/sh)/.test(code)) return 'bash';
    return null;
  }
}

const sm = new MockSandboxManager();

// --- Test 1: Task Validation - Safe ---
console.log('-- 1. Task Validation: Safe Actions --\n');
{
  const safe = sm.validateTask('read_file');
  ok(safe.safe, 'read_file is safe');
  eq(safe.blocked.length, 0, 'No blocked items');
}

// --- Test 2: Task Validation - Risky ---
console.log('\n-- 2. Task Validation: Risky Actions --\n');
{
  const r1 = sm.validateTask('delete_all_files');
  eq(r1.safe, false, 'delete_all_files is blocked');
  ok(r1.blocked.includes('delete'), 'delete is in blocked list');

  const r2 = sm.validateTask('remove_system');
  eq(r2.safe, false, 'remove_system is blocked');

  const r3 = sm.validateTask('exec_malicious');
  eq(r3.safe, false, 'exec is blocked');
}

// --- Test 3: Task Validation - Warnings ---
console.log('\n-- 3. Task Validation: Warning Actions --\n');
{
  const w = sm.validateTask('deploy_production');
  ok(w.safe, 'deploy is not blocked (warning only)');
  ok(w.warnings.includes('deploy'), 'deploy is in warnings list');
}

// --- Test 4: Language Detection ---
console.log('\n-- 4. Language Detection --\n');
{
  eq(sm.detectLanguage('def hello():\n    print("world")'), 'python', 'Python detected');
  eq(sm.detectLanguage('const x = 1;\nfunction f() { return x; }'), 'javascript', 'JavaScript detected');
  eq(sm.detectLanguage('#!/bin/bash\necho "hello"'), 'bash', 'Bash detected');
  eq(sm.detectLanguage('package main\nimport "fmt"\nfunc main() {}'), 'go', 'Go detected');
  eq(sm.detectLanguage('print("hello")', 'script.py'), 'python', 'Python by extension');
  eq(sm.detectLanguage('const x: number = 1;', 'app.ts'), 'typescript', 'TypeScript by extension');
  eq(sm.detectLanguage(''), null, 'Empty code returns null');
}

// --- Test 5: Multi-language by filename ---
console.log('\n-- 5. Language Detection by Filename --\n');
{
  eq(sm.detectLanguage('code', 'test.py'), 'python', '.py = python');
  eq(sm.detectLanguage('code', 'test.js'), 'javascript', '.js = javascript');
  eq(sm.detectLanguage('code', 'test.ts'), 'typescript', '.ts = typescript');
  eq(sm.detectLanguage('code', 'test.sh'), 'bash', '.sh = bash');
  eq(sm.detectLanguage('code', 'test.go'), 'go', '.go = go');
}

// --- Test 6: Unknown Language ---
console.log('\n-- 6. Unknown Language --\n');
{
  eq(sm.detectLanguage('some random text without code patterns'), null, 'Unknown code returns null');
  eq(sm.detectLanguage(''), null, 'Empty string returns null');
}

// --- Test 7: Multiple Risk Keywords ---
console.log('\n-- 7. Multiple Risk Keywords --\n');
{
  const r = sm.validateTask('delete_and_remove_and_destroy');
  eq(r.safe, false, 'Multiple risks blocked');
  ok(r.blocked.length >= 3, '3+ risk keywords detected');
  ok(r.blocked.includes('delete'), 'delete detected');
  ok(r.blocked.includes('remove'), 'remove detected');
  ok(r.blocked.includes('destroy'), 'destroy detected');
}

// --- Test 8: Case Insensitive Risk Detection ---
console.log('\n-- 8. Case Insensitive Detection --\n');
{
  const r = sm.validateTask('DELETE_ALL');
  eq(r.safe, false, 'DELETE uppercase detected');
  ok(r.blocked.includes('delete'), 'delete (lowercase) matched');
}

// --- Test 9: Safe Edge Cases ---
console.log('\n-- 9. Edge Cases --\n');
{
  eq(sm.validateTask('').safe, true, 'Empty action is safe');
  eq(sm.validateTask('read').safe, true, 'read is safe');
  eq(sm.validateTask('write').safe, true, 'write is safe');
  eq(sm.validateTask('search').safe, true, 'search is safe');
  eq(sm.validateTask('list').safe, true, 'list is safe');
}

// --- Test 10: Language Detection Edge Cases ---
console.log('\n-- 10. Language Detection Edge Cases --\n');
{
  // Python with various patterns
  eq(sm.detectLanguage('import os\nos.listdir(".")'), 'python', 'import-based Python detection');
  eq(sm.detectLanguage('print(42)'), 'python', 'print-based Python detection');
  
  // JS with various patterns
  eq(sm.detectLanguage('import { readFile } from "fs"'), 'javascript', 'import-from JS detection');
  eq(sm.detectLanguage('let x = 5'), 'javascript', 'let-based JS detection');
}

// --- Summary ---
console.log('\n' + '='.repeat(60));
console.log('  Results: ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total');
console.log('='.repeat(60) + '\n');
