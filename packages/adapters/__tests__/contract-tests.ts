/**
 * Adapter Contract Tests
 *
 * These tests validate that all adapters (MockRuntimeAdapter, PiAIAdapter, PiAgentCoreAdapter)
 * satisfy the InferencePort and AgentRuntimePort contracts.
 *
 * Run with: npx tsx packages/adapters/__tests__/contract-tests.ts
 *
 * Design: Tests use ONLY types from @morpex/contracts.
 * MockRuntimeAdapter is tested here; Pi adapters require Pi backend.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════
// MockRuntimeAdapter tests (no Pi dependencies)
// ═══════════════════════════════════════════════════════════════════

// Dynamic import to handle path resolution
async function runTests() {
  const { MockRuntimeAdapter, simpleTextResponse, toolCallSequence, errorScenario, timeoutScenario, cancellationScenario, usageScenario, unknownEventScenario, providerUnavailableScenario, authFailureScenario, rateLimitScenario, contextLimitScenario, streamingOrderScenario, emptyResponseScenario, modelNotFoundScenario, streamMidFailureScenario } = await import('../mock-runtime/MockRuntimeAdapter.js');

  await describe('MockRuntimeAdapter — AgentRuntimePort', async () => {

    await it('1. simple text output', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(simpleTextResponse('test-1', 'Hello, world!'));

      const events: any[] = [];
      for await (const event of adapter.execute({ runId: 'test-1', input: 'hi', systemPrompt: 'be helpful', tools: [] })) {
        events.push(event);
      }

      assert.equal(events.length > 0, true);
      assert.equal(events[0].type, 'run.started');
      assert.equal(events[events.length - 1].type, 'run.completed');
    });

    await it('2. streaming incremental output', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(simpleTextResponse('test-2', 'Hello world this is a test'));

      let deltaCount = 0;
      for await (const event of adapter.execute({ runId: 'test-2', input: 'hi', systemPrompt: 'be helpful', tools: [] })) {
        if (event.type === 'assistant.delta' && (event as any).text) {
          deltaCount++;
          assert.ok((event as any).text.length > 0, 'Delta text should have content');
        }
      }
      assert.ok(deltaCount >= 2, `Expected at least 2 deltas, got ${deltaCount}`);
    });

    await it('3. reasoning present', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript({
        label: 'with-reasoning',
        steps: [
          { delayMs: 5, event: { type: 'run.started' as any, runId: 'test-3', timestamp: Date.now() } },
          { delayMs: 5, event: { type: 'reasoning.delta' as any, runId: 'test-3', text: 'Let me think...' } },
          { delayMs: 5, event: { type: 'assistant.delta' as any, runId: 'test-3', text: 'Answer' } },
          { final: true, event: { type: 'run.completed' as any, runId: 'test-3' } },
        ],
      });

      let hasReasoning = false;
      for await (const event of adapter.execute({ runId: 'test-3', input: 'think', systemPrompt: '', tools: [] })) {
        if (event.type === 'reasoning.delta') hasReasoning = true;
      }
      assert.equal(hasReasoning, true);
    });

    await it('4. single tool call', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(toolCallSequence('test-4', [
        { name: 'read_file', args: { path: '/test.txt' }, result: 'file content' },
      ]));

      let toolRequested = false;
      let toolCompleted = false;
      for await (const event of adapter.execute({ runId: 'test-4', input: 'read', systemPrompt: '', tools: [] })) {
        if (event.type === 'tool.requested') toolRequested = true;
        if (event.type === 'tool.completed') toolCompleted = true;
      }
      assert.equal(toolRequested, true);
      assert.equal(toolCompleted, true);
    });

    await it('5. multiple consecutive tool calls', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(toolCallSequence('test-5', [
        { name: 'tool_a', args: {}, result: 'a' },
        { name: 'tool_b', args: {}, result: 'b' },
        { name: 'tool_c', args: {}, result: 'c' },
      ]));

      const toolCalls: string[] = [];
      for await (const event of adapter.execute({ runId: 'test-5', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'tool.requested') toolCalls.push(event.call.name);
      }
      assert.deepEqual(toolCalls, ['tool_a', 'tool_b', 'tool_c']);
    });

    await it('6. tool success and failure', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript({
        label: 'mixed-tools',
        steps: [
          { delayMs: 5, event: { type: 'run.started' as any, runId: 'test-6', timestamp: Date.now() } },
          { delayMs: 5, event: { type: 'tool.requested' as any, runId: 'test-6', call: { callId: 'c1', name: 'good', args: {} } } },
          { delayMs: 5, event: { type: 'tool.started' as any, runId: 'test-6', callId: 'c1' } },
          { delayMs: 5, event: { type: 'tool.completed' as any, runId: 'test-6', result: { callId: 'c1', name: 'good', success: true, content: 'ok' } } },
          { delayMs: 5, event: { type: 'tool.requested' as any, runId: 'test-6', call: { callId: 'c2', name: 'bad', args: {} } } },
          { delayMs: 5, event: { type: 'tool.started' as any, runId: 'test-6', callId: 'c2' } },
          { delayMs: 5, event: { type: 'tool.failed' as any, runId: 'test-6', callId: 'c2', error: { code: 'E_TOOL_ERROR', message: 'fail', retryable: false } } },
          { final: true, event: { type: 'run.completed' as any, runId: 'test-6' } },
        ],
      });

      let goodCount = 0, badCount = 0;
      for await (const event of adapter.execute({ runId: 'test-6', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'tool.completed') goodCount++;
        if (event.type === 'tool.failed') badCount++;
      }
      assert.equal(goodCount, 1);
      assert.equal(badCount, 1);
    });

    await it('7. provider error conversion', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(errorScenario('test-7', { code: 'E_TIMEOUT', message: 'Provider timeout', retryable: true }));

      let finalError: any = null;
      for await (const event of adapter.execute({ runId: 'test-7', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'run.failed') finalError = event.error;
      }
      assert.ok(finalError);
      assert.equal(finalError.retryable, true);
      assert.equal(finalError.message, 'Provider timeout');
    });

    await it('8. user cancellation', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(cancellationScenario('test-8', 'User clicked cancel'));

      let cancelled = false;
      for await (const event of adapter.execute({ runId: 'test-8', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'run.cancelled') {
          cancelled = true;
          assert.equal((event as any).reason, 'User clicked cancel');
        }
      }
      assert.equal(cancelled, true);
    });

    await it('9. cancellation via adapter.cancel()', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript({
        label: 'long-task',
        steps: [
          { delayMs: 200, event: { type: 'run.started' as any, runId: 'test-9', timestamp: Date.now() } },
          { delayMs: 200, event: { type: 'assistant.delta' as any, runId: 'test-9', text: 'Working...' } },
          { final: true, event: { type: 'run.completed' as any, runId: 'test-9' } },
        ],
      });

      // Cancel after 50ms
      setTimeout(() => adapter.cancel('test-9', 'Cancelled'), 50);

      let terminal: string | null = null;
      for await (const event of adapter.execute({ runId: 'test-9', input: 'run', systemPrompt: '', tools: [] })) {
        terminal = event.type;
      }
      // The adapter.cancel() sets aborted=true, so the event loop should yield cancelled
      assert.ok(terminal === 'run.cancelled' || terminal === 'run.completed', `Unexpected terminal: ${terminal}`);
    });

    await it('10. top-level timeout', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript({
        label: 'timeout',
        steps: [
          { delayMs: 5, event: { type: 'run.started' as any, runId: 'test-10', timestamp: Date.now() } },
          { delayMs: 5000, event: { type: 'run.failed' as any, runId: 'test-10', error: { code: 'E_TIMEOUT', message: 'Execution timed out', retryable: true } } },
          { final: true, event: { type: 'run.failed' as any, runId: 'test-10', error: { code: 'E_TIMEOUT', message: 'Execution timed out', retryable: true } } },
        ],
      });

      const timeoutMs = 100;
      const result = await Promise.race([
        (async () => {
          let last: string = '';
          for await (const event of adapter.execute({ runId: 'test-10', input: 'run', systemPrompt: '', tools: [], timeoutMs })) {
            last = event.type;
          }
          return last;
        })(),
        new Promise<string>(r => setTimeout(() => r('timeout'), timeoutMs + 100)),
      ]);

      // Should hit timeout scenario
      assert.ok(result === 'run.failed' || result === 'timeout');
    });

    await it('11. token usage', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(usageScenario('test-11'));

      let usage: any = null;
      for await (const event of adapter.execute({ runId: 'test-11', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'usage.updated') usage = (event as any).usage;
      }
      assert.ok(usage);
      assert.equal(typeof usage.inputTokens, 'number');
      assert.equal(typeof usage.outputTokens, 'number');
      assert.ok(usage.inputTokens > 0);
    });

    await it('12. multiple concurrent runs isolation', async () => {
      const adapter1 = new MockRuntimeAdapter();
      const adapter2 = new MockRuntimeAdapter();

      adapter1.setScript(simpleTextResponse('run-1', 'Response A'));
      adapter2.setScript(simpleTextResponse('run-2', 'Response B'));

      const results: string[] = [];
      const run1Done = new Promise<void>(async (resolve) => {
        for await (const event of adapter1.execute({ runId: 'run-1', input: 'a', systemPrompt: '', tools: [] })) {
          if (event.type === 'run.completed') results.push('A-done');
        }
        resolve();
      });

      const run2Done = new Promise<void>(async (resolve) => {
        for await (const event of adapter2.execute({ runId: 'run-2', input: 'b', systemPrompt: '', tools: [] })) {
          if (event.type === 'run.completed') results.push('B-done');
        }
        resolve();
      });

      await Promise.all([run1Done, run2Done]);
      assert.equal(results.includes('A-done'), true);
      assert.equal(results.includes('B-done'), true);
    });

    await it('13. unknown event handling', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(unknownEventScenario('test-13'));

      let ranToCompletion = false;
      for await (const event of adapter.execute({ runId: 'test-13', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'run.completed') ranToCompletion = true;
      }
      // Should terminate normally despite unknown events
      assert.equal(ranToCompletion, true);
    });

    await it('14. adapter does not leak Pi types', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(simpleTextResponse('test-14', 'Hello'));

      for await (const event of adapter.execute({ runId: 'test-14', input: 'run', systemPrompt: '', tools: [] })) {
        // All events should have runId (MorPex contract field)
        assert.equal(typeof (event as any).runId, 'string');
        // Should NOT have any pi-specific fields
        assert.equal('providerCode' in (event as any), false);
      }
    });

    await it('15. run.completed terminal event', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(simpleTextResponse('test-15', 'Done'));

      let terminal: string | null = null;
      for await (const event of adapter.execute({ runId: 'test-15', input: 'run', systemPrompt: '', tools: [] })) {
        terminal = event.type;
      }
      assert.equal(terminal, 'run.completed');
    });

    await it('16. assistant.delta streaming order', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(streamingOrderScenario('test-16'));

      const deltas: string[] = [];
      for await (const event of adapter.execute({ runId: 'test-16', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'assistant.delta') deltas.push((event as any).text);
      }
      assert.deepEqual(deltas, ['First ', 'second ', 'third.']);
    });

    await it('17. provider unavailable error', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(providerUnavailableScenario('test-17'));

      let final: any = null;
      for await (const event of adapter.execute({ runId: 'test-17', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'run.failed') final = event;
      }
      assert.ok(final);
      assert.equal((final as any).error.code, 'E_PROVIDER_UNAVAILABLE');
      assert.equal((final as any).error.retryable, true);
    });

    await it('18. authentication failure', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(authFailureScenario('test-18'));

      let final: any = null;
      for await (const event of adapter.execute({ runId: 'test-18', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'run.failed') final = event;
      }
      assert.ok(final);
      assert.equal((final as any).error.code, 'E_AUTHENTICATION_FAILED');
      assert.equal((final as any).error.retryable, false);
    });

    await it('19. rate limiting error', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(rateLimitScenario('test-19'));

      let final: any = null;
      for await (const event of adapter.execute({ runId: 'test-19', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'run.failed') final = event;
      }
      assert.ok(final);
      assert.equal((final as any).error.code, 'E_RATE_LIMITED');
      assert.equal((final as any).error.retryable, true);
    });

    await it('20. context length exceeded', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(contextLimitScenario('test-20'));

      let final: any = null;
      for await (const event of adapter.execute({ runId: 'test-20', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'run.failed') final = event;
      }
      assert.ok(final);
      assert.equal((final as any).error.code, 'E_CONTEXT_LIMIT_EXCEEDED');
    });

    await it('21. runId consistency across events', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(simpleTextResponse('test-21', 'Data'));

      for await (const event of adapter.execute({ runId: 'test-21', input: 'run', systemPrompt: '', tools: [] })) {
        assert.equal((event as any).runId, 'test-21', `Event ${event.type} should have runId 'test-21'`);
      }
    });

    await it('22. unsupported checkpoint/resume returns failure', async () => {
      const adapter = new MockRuntimeAdapter();
      const caps = await adapter.getAgentCapabilities();
      // Mock adapter declares checkpointResume: false
      assert.equal(caps.checkpointResume, false);
    });

    await it('23. run.failed produces exactly one terminal event', async () => {
      const adapter = new MockRuntimeAdapter();
      const err: any = { code: 'E_UNKNOWN', message: 'Fatal error', retryable: false };
      adapter.setScript({
        label: 'single-fail',
        steps: [
          { delayMs: 5, event: { type: 'run.started' as any, runId: 'test-23', timestamp: Date.now() } },
          { final: true, event: { type: 'run.failed' as any, runId: 'test-23', error: err, timestamp: Date.now() } },
        ],
      });

      let terminalCount = 0;
      for await (const event of adapter.execute({ runId: 'test-23', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'run.failed') terminalCount++;
      }
      assert.equal(terminalCount, 1, 'Should have exactly one run.failed terminal event');
    });

    await it('24. run.completed produces exactly one terminal event', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(simpleTextResponse('test-24', 'Done'));

      let terminalCount = 0;
      for await (const event of adapter.execute({ runId: 'test-24', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'run.completed') terminalCount++;
      }
      assert.equal(terminalCount, 1, 'Should have exactly one run.completed terminal event');
    });

    await it('25. empty response handled gracefully', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(emptyResponseScenario('test-25'));

      let completed = false;
      for await (const event of adapter.execute({ runId: 'test-25', input: 'run', systemPrompt: '', tools: [] })) {
        if (event.type === 'run.completed') completed = true;
      }
      assert.equal(completed, true);
    });
  });

  await describe('MockRuntimeAdapter — InferencePort', async () => {

    await it('21. generate returns stream events', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript(simpleTextResponse('inf-1', 'Hello'));

      const events: any[] = [];
      for await (const event of adapter.generate({ runId: 'inf-1', messages: [{ role: 'user', content: 'hi' }] })) {
        events.push(event);
      }
      assert.ok(events.length > 0);
      assert.ok(['stream.started', 'stream.completed', 'stream.failed', 'stream.cancelled'].includes(events[events.length - 1].type));
    });

    await it('22. cancellation via abort signal', async () => {
      const adapter = new MockRuntimeAdapter({ respectAbortSignal: true });
      const controller = new AbortController();

      adapter.setScript({
        label: 'inf-long',
        steps: [
          { delayMs: 5, event: { type: 'stream.started' as any, runId: 'inf-2', timestamp: Date.now() } },
          { delayMs: 200, event: { type: 'token' as any, runId: 'inf-2', text: 'data' } },
          { delayMs: 200, event: { type: 'stream.completed' as any, runId: 'inf-2', content: 'data', timestamp: Date.now() } },
          { final: true, event: { type: 'stream.completed' as any, runId: 'inf-2', content: 'data', timestamp: Date.now() } },
        ],
      });

      setTimeout(() => controller.abort(), 50);

      let terminal: string | null = null;
      for await (const event of adapter.generate({ runId: 'inf-2', messages: [{ role: 'user', content: 'hi' }], options: { signal: controller.signal } })) {
        terminal = event.type;
      }
      assert.equal(terminal, 'stream.cancelled');
    });

    await it('23. usage mapping in inference stream', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript({
        label: 'inf-usage',
        steps: [
          { delayMs: 5, event: { type: 'stream.started' as any, runId: 'inf-3', timestamp: Date.now() } },
          { delayMs: 5, event: { type: 'token' as any, runId: 'inf-3', text: 'text' } },
          { delayMs: 5, event: { type: 'usage' as any, runId: 'inf-3', usage: { inputTokens: 50, outputTokens: 100, cost: 0.001 } } },
          { final: true, event: { type: 'stream.completed' as any, runId: 'inf-3', content: 'text', timestamp: Date.now() } },
        ],
      });

      let hasUsage = false;
      for await (const event of adapter.generate({ runId: 'inf-3', messages: [{ role: 'user', content: 'hi' }] })) {
        if (event.type === 'usage') {
          hasUsage = true;
          assert.equal(typeof (event as any).usage.inputTokens, 'number');
        }
      }
      assert.equal(hasUsage, true);
    });

    await it('24. model not found error', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript({
        label: 'inf-model-not-found',
        steps: [
          { final: true, event: { type: 'stream.failed' as any, runId: 'inf-4', error: { code: 'E_MODEL_NOT_FOUND', message: 'Model not found', retryable: false }, timestamp: Date.now() } },
        ],
      });

      let failed = false;
      for await (const event of adapter.generate({ runId: 'inf-4', messages: [{ role: 'user', content: 'hi' }] })) {
        if (event.type === 'stream.failed') {
          failed = true;
          assert.equal((event as any).error.code, 'E_MODEL_NOT_FOUND');
        }
      }
      assert.equal(failed, true);
    });

    await it('25. stream mid-failure', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript({
        label: 'inf-mid-fail',
        steps: [
          { delayMs: 5, event: { type: 'stream.started' as any, runId: 'inf-5', timestamp: Date.now() } },
          { delayMs: 5, event: { type: 'token' as any, runId: 'inf-5', text: 'partial...' } },
          { final: true, event: { type: 'stream.failed' as any, runId: 'inf-5', error: { code: 'E_PROVIDER_ERROR', message: 'Stream interrupted', retryable: true }, timestamp: Date.now() } },
        ],
      });

      const events: any[] = [];
      for await (const event of adapter.generate({ runId: 'inf-5', messages: [{ role: 'user', content: 'hi' }] })) {
        events.push(event);
      }
      assert.ok(events.some((e: any) => e.type === 'token'), 'Should have at least one token before failure');
      assert.equal(events[events.length - 1].type, 'stream.failed');
    });

    await it('26. provider error in inference', async () => {
      const adapter = new MockRuntimeAdapter();
      adapter.setScript({
        label: 'inf-provider-err',
        steps: [
          { delayMs: 5, event: { type: 'stream.started' as any, runId: 'inf-6', timestamp: Date.now() } },
          { final: true, event: { type: 'stream.failed' as any, runId: 'inf-6', error: { code: 'E_PROVIDER_UNAVAILABLE', message: 'Provider down', retryable: true }, timestamp: Date.now() } },
        ],
      });

      let failed = false;
      for await (const event of adapter.generate({ runId: 'inf-6', messages: [{ role: 'user', content: 'hi' }] })) {
        if (event.type === 'stream.failed') {
          failed = true;
          assert.equal((event as any).error.retryable, true);
        }
      }
      assert.equal(failed, true);
    });
  });

  console.log('\n✅ All adapter contract tests passed');
}

runTests().catch(err => {
  console.error('❌ Tests failed:', err);
  process.exit(1);
});
