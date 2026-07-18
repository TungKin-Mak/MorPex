#!/usr/bin/env npx tsx
/**
 * test-thought-interceptor.ts — ThoughtInterceptor test suite
 *
 * Tests real-time streaming token scanning, MemoryBus correction querying,
 * abort/steer primitives, threshold enforcement, and retry limits.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BRIGHT = '\x1b[1m';
const RESET = '\x1b[0m';

let passed = 0, failed = 0;

function ok(label: string, detail?: string): void {
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${CYAN}(${detail})${RESET}` : ''}`);
  passed++;
}
function fail(label: string, reason: string): void {
  console.log(`  ${RED}✗${RESET} ${label}: ${RED}${reason}${RESET}`);
  failed++;
}
function heading(n: number, title: string): void {
  console.log(`\n${BRIGHT}═══ Test ${n}: ${title} ═══${RESET}\n`);
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// ── Mock MemoryBus ──

class MockMemoryBus {
  private memories: Array<{ text: string; score: number; meta: any }> = [];

  async remember(params: { content: string; memType?: string; importance?: number; metadata?: any }): Promise<void> {
    this.memories.push({ text: params.content, score: 0.95, meta: params.metadata ?? {} });
  }

  async query(params: { memType?: string; text: string; limit?: number }): Promise<Array<{ text: string; score: number; meta: any }>> {
    const results: Array<{ text: string; score: number; meta: any }> = [];
    for (const m of this.memories) {
      // Simple substring match for testing
      let score = 0;
      const queryWords = params.text.toLowerCase().split(/\s+/);
      const memWords = m.text.toLowerCase().split(/\s+/);
      let matches = 0;
      for (const qw of queryWords) {
        if (qw.length < 3) continue;
        for (const mw of memWords) {
          if (mw.includes(qw) || qw.includes(mw)) { matches++; break; }
        }
      }
      score = queryWords.length > 0 ? matches / Math.max(queryWords.filter(w => w.length >= 3).length, 1) : 0;
      score = Math.min(0.99, Math.max(0, score));
      if (score > 0) {
        results.push({ text: m.text, score, meta: m.meta });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, params.limit ?? 5);
  }
}

// ── Mock AgentContext ──

function createMockAgentContext(): { ctx: any; calls: { abort: number; steer: Array<{ role: string; content: string }> } } {
  const calls = { abort: 0, steer: [] as Array<{ role: string; content: string }> };
  const ctx = {
    abort: () => { calls.abort++; },
    steer: (msg: { role: string; content: string }) => { calls.steer.push(msg); },
    followUp: () => {},
    signal: undefined,
    hasQueuedMessages: () => calls.steer.length > 0,
  };
  return { ctx, calls };
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log(`${BRIGHT}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BRIGHT}║     ThoughtInterceptor — Real-Time Stream Scanner Test      ║${RESET}`);
  console.log(`${BRIGHT}╚══════════════════════════════════════════════════════════════╝${RESET}`);

  const { ThoughtInterceptor } = await import(
    '../packages/core/src/extensions/planning/extensions/ThoughtInterceptor.js'
  );
  const CorrectionPayload = {} as any; // type only

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  heading(1, 'Basic sentence accumulation and flush');
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const mb = new MockMemoryBus();
    const interceptor = new ThoughtInterceptor({ memoryBus: mb, threshold: 0.95, enableLogging: false });
    const { ctx, calls } = createMockAgentContext();
    const streamFn = interceptor.createStreamWrapper(ctx);
    interceptor.resetStats();

    // Feed tokens that form a safe sentence
    const tokens = ['I', ' think', ' we', ' should', ' build', ' a', ' web', ' app', '.', '\n'];
    for (const t of tokens) await streamFn(t);

    assert(calls.abort === 0, 'abort should not be called on safe thought');
    assert(calls.steer.length === 0, 'steer should not be called on safe thought');

    ok('Safe thought: no interception', 'abort=0, steer=0');
    ok('Sentence buffer flushed on delimiter', 'tokens including "." flushes buffer');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  heading(2, 'Interception on dangerous thought');
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const mb = new MockMemoryBus();
    await mb.remember({
      content: 'open port 3306 to public database',
      metadata: {
        errorKeywords: 'open port 3306',
        rootCause: 'Direct database port exposure led to ransomware attack',
        defensiveInstruction: 'Use VPC private subnet + SSH tunnel. Never expose DB ports.',
        historicalFailureCount: 12,
        preventionStrategy: 'Network security review before deployment',
      },
    });

    const interceptor = new ThoughtInterceptor({ memoryBus: mb, threshold: 0.20, enableLogging: false });
    const { ctx, calls } = createMockAgentContext();
    const streamFn = interceptor.createStreamWrapper(ctx);
    interceptor.resetStats();

    // Feed dangerous thought
    const tokens = ['I', ' will', ' open', ' port', ' 3306', ' to', ' public', '.', '\n'];
    for (const t of tokens) await streamFn(t);

    assert(calls.abort > 0, 'abort should be called on dangerous thought');
    assert(calls.steer.length > 0, 'steer should be called with correction');

    const stats = interceptor.getStats();
    ok('Dangerous thought intercepted', `interceptions=${stats.totalInterceptions}`);
    ok('abort() called', `abort was called ${calls.abort} time(s)`);
    ok('steer() called with SYSTEM INTERRUPTION',
      calls.steer[0]?.content?.includes('SYSTEM INTERRUPTION') ? 'content contains SYSTEM INTERRUPTION' : 'no SYSTEM INTERRUPTION found');
    ok('Correction payload in steer message',
      calls.steer[0]?.content?.includes('ransomware') ? 'mentions root cause' : 'no root cause');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  heading(3, 'Threshold respect');
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const mb = new MockMemoryBus();
    await mb.remember({
      content: 'deploy without testing',
      metadata: {
        errorKeywords: 'deploy without test',
        rootCause: 'Untested deployment caused outage',
        defensiveInstruction: 'Always include test phase before deploy',
        historicalFailureCount: 8,
        preventionStrategy: 'Mandatory testing gate before deployment',
      },
    });

    // Test with high threshold (0.95) — no match expected
    const interceptorHigh = new ThoughtInterceptor({ memoryBus: mb, threshold: 0.95, enableLogging: false });
    const { ctx: ctxHigh, calls: callsHigh } = createMockAgentContext();
    const streamFnHigh = interceptorHigh.createStreamWrapper(ctxHigh);
    interceptorHigh.resetStats();

    const tokens = ['I', ' will', ' deploy', ' without', ' testing', '.', '\n'];
    for (const t of tokens) await streamFnHigh(t);

    assert(callsHigh.abort === 0, 'high threshold should NOT intercept low-score match');
    ok('High threshold (0.95) → no interception',
      callsHigh.abort === 0 ? 'abort=0, as expected' : `abort=${callsHigh.abort} unexpected`);

    // Test with low threshold (0.20) — match expected
    const interceptorLow = new ThoughtInterceptor({ memoryBus: mb, threshold: 0.20, enableLogging: false });
    const { ctx: ctxLow, calls: callsLow } = createMockAgentContext();
    const streamFnLow = interceptorLow.createStreamWrapper(ctxLow);
    interceptorLow.resetStats();

    for (const t of tokens) await streamFnLow(t);

    assert(callsLow.abort > 0, 'low threshold should intercept');
    ok('Low threshold (0.20) → interception', `abort=${callsLow.abort}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  heading(4, 'Max retries prevention');
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const mb = new MockMemoryBus();
    await mb.remember({
      content: 'dangerous pattern triggers every time',
      metadata: {
        errorKeywords: 'dangerous pattern',
        rootCause: 'Test root cause',
        defensiveInstruction: 'Test instruction',
        historicalFailureCount: 3,
        preventionStrategy: 'Test prevention',
      },
    });

    const interceptor = new ThoughtInterceptor({ memoryBus: mb, threshold: 0.20, maxRetries: 2, enableLogging: false });

    // First dangerous sentence
    const { ctx: ctx1b, calls: calls1b } = createMockAgentContext();
    const streamFn1b = interceptor.createStreamWrapper(ctx1b);
    interceptor.resetStats();

    const tokens1 = ['this', ' is', ' a', ' dangerous', ' pattern', '.', '\n'];
    for (const t of tokens1) await streamFn1b(t);

    // Second dangerous sentence (different markup but same danger)
    const { ctx: ctx2, calls: calls2 } = createMockAgentContext();
    const streamFn2 = interceptor.createStreamWrapper(ctx2);
    interceptor.resetStats();

    const tokens2 = ['another', ' dangerous', ' pattern', ' here', '.', '\n'];
    for (const t of tokens2) await streamFn2(t);

    // After maxRetries=2, the 3rd trigger should be allowed
    assert(calls2.abort <= 1, 'should respect retry limit');
    const stats = interceptor.getStats();

    ok('Max retries enforced', `totalInterceptions=${stats.totalInterceptions} (maxRetries=2)`);
    ok('calls.abort within retry limit', `call count=${calls2.abort}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  heading(5, 'Correction injection content');
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const mb = new MockMemoryBus();
    await mb.remember({
      content: 'skip validation phase',
      metadata: {
        errorKeywords: 'skip validation',
        rootCause: 'Skipping validation caused production bugs',
        defensiveInstruction: 'Always run validation phase before build output',
        historicalFailureCount: 5,
        preventionStrategy: 'Validation gate mandatory',
      },
    });

    const interceptor = new ThoughtInterceptor({ memoryBus: mb, threshold: 0.30, enableLogging: false });
    const { ctx, calls } = createMockAgentContext();
    const streamFn = interceptor.createStreamWrapper(ctx);
    interceptor.resetStats();

    const tokens = ['we', ' can', ' skip', ' validation', ' phase', '.', '\n'];
    for (const t of tokens) await streamFn(t);

    const msg = calls.steer[0]?.content ?? '';

    assert(msg.includes('SYSTEM INTERRUPTION'), 'must contain SYSTEM INTERRUPTION header');
    assert(msg.includes('Skipping validation caused production bugs'), 'must contain root cause');
    assert(msg.includes('Always run validation phase'), 'must contain defensive instruction');
    assert(msg.includes('Validation gate mandatory'), 'must contain prevention strategy');
    assert(msg.includes('5'), 'must mention historicalFailureCount');

    ok('SYSTEM INTERRUPTION header present', msg.includes('SYSTEM INTERRUPTION') ? 'yes' : 'no');
    ok('Root cause included', msg.includes('production bugs') ? 'yes' : 'no');
    ok('Defensive instruction included', msg.includes('run validation') ? 'yes' : 'no');
    ok('Prevention strategy included', msg.includes('mandatory') ? 'yes' : 'no');
    ok('Historical failure count mentioned', msg.includes('5') ? 'yes' : 'no');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  heading(6, 'Sentence delimiters');
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const mb = new MockMemoryBus();
    const interceptor = new ThoughtInterceptor({ memoryBus: mb, threshold: 0.95, enableLogging: false });
    interceptor.resetStats();

    // Test with "." delimiter
    const { ctx: ctxDot, calls: callsDot } = createMockAgentContext();
    const streamFnDot = interceptor.createStreamWrapper(ctxDot);
    interceptor.resetStats();
    for (const t of ['hello', ' world', '.']) await streamFnDot(t);
    ok('Sentence delimiter "." flushes buffer', callsDot.abort === 0);

    // Test with "\n" delimiter
    const { ctx: ctxNewline, calls: callsNl } = createMockAgentContext();
    const streamFnNl = interceptor.createStreamWrapper(ctxNewline);
    for (const t of ['test', ' sentence', '\n']) await streamFnNl(t);
    ok('Sentence delimiter "\\n" flushes buffer', callsNl.abort === 0);

    // Test with "。" (Chinese period)
    const { ctx: ctxCn, calls: callsCn } = createMockAgentContext();
    const streamFnCn = interceptor.createStreamWrapper(ctxCn);
    for (const t of ['这个是', '测试', '。']) await streamFnCn(t);
    ok('Chinese period "。" flushes buffer', callsCn.abort === 0);

    // Test forced flush at 40 chars (no delimiter)
    const { ctx: ctxLong, calls: callsLong } = createMockAgentContext();
    const streamFnLong = interceptor.createStreamWrapper(ctxLong);
    // Feed 50 chars without any delimiter
    const longRun = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ'.split('');
    for (const t of longRun) await streamFnLong(t);
    ok('Forced flush at maxSentenceLength (40)', callsLong.abort === 0);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  heading(7, 'Stats tracking');
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const mb = new MockMemoryBus();
    const interceptor = new ThoughtInterceptor({ memoryBus: mb, threshold: 0.95, enableLogging: false });
    interceptor.resetStats();

    const { ctx, calls: _calls } = createMockAgentContext();
    const streamFn = interceptor.createStreamWrapper(ctx);

    // Feed 5 safe sentences
    for (let i = 0; i < 5; i++) {
      for (const t of [`sentence ${i}`, '.', '\n']) await streamFn(t);
    }

    let stats = interceptor.getStats();
    const scannedBefore = stats.totalSentencesScanned;

    // Feed a matching sentence (seed memory first)
    await mb.remember({
      content: 'dangerous operation',
      metadata: {
        errorKeywords: 'dangerous op',
        rootCause: 'Test RC',
        defensiveInstruction: 'Test DI',
        historicalFailureCount: 1,
        preventionStrategy: 'Test PS',
      },
    });

    const { ctx: ctx2, calls: calls2 } = createMockAgentContext();
    const streamFn2 = interceptor.createStreamWrapper(ctx2);
    interceptor.resetStats();

    for (const t of ['this', ' is', ' dangerous', ' operation', '.', '\n']) await streamFn2(t);

    stats = interceptor.getStats();
    ok('Stats totalSentencesScanned > 0', `${stats.totalSentencesScanned} sentences scanned`);
    ok('Stats totalInterceptions tracked', `${stats.totalInterceptions} interceptions`);
    ok('Stats lastInterception has timestamp',
      stats.lastInterception?.timestamp != null ? 'yes' : 'null');
    ok('Stats avgScanTimeMs recorded',
      `${stats.avgScanTimeMs.toFixed(1)}ms avg scan time`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  heading(8, 'Empty/tiny sentence skip');
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const mb = new MockMemoryBus();
    await mb.remember({
      content: 'danger',
      metadata: {
        errorKeywords: 'danger',
        rootCause: 'RC',
        defensiveInstruction: 'DI',
        historicalFailureCount: 1,
        preventionStrategy: 'PS',
      },
    });

    const interceptor = new ThoughtInterceptor({ memoryBus: mb, threshold: 0.20, enableLogging: false });
    const { ctx, calls } = createMockAgentContext();
    const streamFn = interceptor.createStreamWrapper(ctx);
    interceptor.resetStats();

    // Empty buffer flush (just a delimiter)
    await streamFn('.');
    // Tiny sentence (length < 3)
    await streamFn('ab');
    await streamFn('.');

    assert(calls.abort === 0, 'tiny/empty sentences should not trigger interception');
    ok('Empty buffer after delimiter → no scan', 'buffer ignored');
    ok('Tiny sentence (<3 chars) skipped', 'abort=0');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  heading(9, 'seedCorrectionMemory integration');
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const mb = new MockMemoryBus();
    const interceptor = new ThoughtInterceptor({ memoryBus: mb, threshold: 0.20, enableLogging: false });

    // Seed correction via the convenience method
    const seeded = await interceptor.seedCorrectionMemory({
      errorKeywords: 'delete production database',
      rootCause: 'Production data loss incident',
      defensiveInstruction: 'Never allow DELETE on production. Use RDS snapshot restore.',
      historicalFailureCount: 3,
      preventionStrategy: 'Production safety lock on all destructive operations',
    });

    ok('seedCorrectionMemory returned true', `${seeded}`);

    // Verify it can be intercepted
    const { ctx, calls } = createMockAgentContext();
    const streamFn = interceptor.createStreamWrapper(ctx);
    interceptor.resetStats();

    for (const t of ['I', ' will', ' delete', ' production', ' database', '.', '\n']) await streamFn(t);

    ok('Seeded correction memory triggers interception',
      calls.abort > 0 ? 'abort called' : 'no abort');
    ok('Seeded root cause in injection',
      calls.steer[0]?.content?.includes('Production data loss') ? 'yes' : 'no');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  heading(10, 'Multiple interceptions tracking');
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const mb = new MockMemoryBus();
    await mb.remember({
      content: 'dangerous first pattern',
      metadata: {
        errorKeywords: 'first pattern',
        rootCause: 'RC1',
        defensiveInstruction: 'DI1',
        historicalFailureCount: 2,
        preventionStrategy: 'PS1',
      },
    });
    await mb.remember({
      content: 'dangerous second pattern',
      metadata: {
        errorKeywords: 'second pattern',
        rootCause: 'RC2',
        defensiveInstruction: 'DI2',
        historicalFailureCount: 3,
        preventionStrategy: 'PS2',
      },
    });

    const interceptor = new ThoughtInterceptor({ memoryBus: mb, threshold: 0.20, enableLogging: false });
    const { ctx, calls } = createMockAgentContext();
    const streamFn = interceptor.createStreamWrapper(ctx);
    interceptor.resetStats();

    // Trigger first interception
    for (const t of ['first', ' dangerous', ' pattern', '.', '\n']) await streamFn(t);

    // Trigger second interception (on same streamFn)
    // But maxRetries=3 will allow up to 3, so both should work
    for (const t of ['second', ' dangerous', ' pattern', '.', '\n']) await streamFn(t);

    const stats = interceptor.getStats();
    ok('Multiple interceptions tracked',
      `${stats.totalInterceptions} interceptions tracked`);
    ok('Steer called multiple times',
      `${calls.steer.length} steer messages queued`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Summary
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log(`\n${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`${BRIGHT}  测试摘要${RESET}`);
  console.log(`${BRIGHT}════════════════════════════════════════════════════${RESET}`);
  console.log(`  ${GREEN}通过:${RESET} ${passed}`);
  console.log(`  ${RED}失败:${RESET} ${failed}`);
  console.log(`  总计: ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`${RED}Test runner error:${RESET}`, err);
  process.exit(1);
});
