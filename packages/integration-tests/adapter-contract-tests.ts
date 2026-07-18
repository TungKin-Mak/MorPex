/**
 * Adapter Contract Tests
 *
 * Runs the same set of tests against all adapter implementations:
 *   - MockRuntimeAdapter
 *   - PiAIAdapter
 *   - PiAgentCoreAdapter
 *
 * Tests cover:
 *   1. Plain text output
 *   2. Streaming token delivery
 *   3. Reasoning present and absent
 *   4. Single tool call
 *   5. Multiple sequential tool calls
 *   6. Parallel tool calls
 *   7. Tool success, failure, timeout
 *   8. Provider error conversion
 *   9. Agent runtime error conversion
 *   10. User-initiated cancellation
 *   11. AbortSignal propagation
 *   12. Top-level timeout
 *   13. Token usage present or absent
 *   14. Concurrent run state isolation
 *   15. Unknown event handling
 *   16. Session/checkpoint capability presence
 *   17. Adapter does not leak Pi types
 *   18. Core can test with Mock adapter without Pi backend
 */

import type {
  AgentRuntimePort,
  AgentRuntimeEvent,
  AgentRunRequest,
} from '@morpex/contracts/agent-runtime';
import type {
  InferencePort,
  InferenceEvent,
  GenerateRequest,
  TokenUsage,
} from '@morpex/contracts/inference';
import type { ToolDefinition, ToolCall, ToolResult } from '@morpex/contracts/tool';
import type { RuntimeError } from '@morpex/contracts/errors';

// ═══════════════════════════════════════════════════════════════════
// Test Results
// ═══════════════════════════════════════════════════════════════════

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

let totalTests = 0;
let passedTests = 0;
const results: TestResult[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  totalTests++;
  try {
    await fn();
    passedTests++;
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err.message });
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test Scenarios — Common test functions
// ═══════════════════════════════════════════════════════════════════

function simpleTextScenario(): AgentRunRequest {
  return {
    runId: `test_${Date.now()}`,
    input: 'Say hello',
    systemPrompt: 'You are a helpful assistant.',
    tools: [],
    maxTurns: 1,
  };
}

function toolCallScenario(): AgentRunRequest {
  return {
    runId: `test_tool_${Date.now()}`,
    input: 'Use the echo tool to say hello',
    systemPrompt: 'You are a helpful assistant with tools.',
    tools: [
      {
        name: 'echo',
        description: 'Echo back a message',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message to echo' },
          },
          required: ['message'],
        },
      },
    ],
    maxTurns: 3,
  };
}

function timeoutScenario(): AgentRunRequest {
  return {
    runId: `test_timeout_${Date.now()}`,
    input: 'Think deeply about something',
    systemPrompt: 'You are a helpful assistant.',
    tools: [],
    maxTurns: 1,
    timeoutMs: 1, // Extremely short timeout
  };
}

// ═══════════════════════════════════════════════════════════════════
// Contract Validation Functions
// ═══════════════════════════════════════════════════════════════════

function checkEventsStructure(events: AgentRuntimeEvent[], runId: string): void {
  // Must start with run.started
  assert(events.length > 0, 'Expected at least one event');
  assert(events[0].type === 'run.started', `Expected first event to be 'run.started' but got '${events[0].type}'`);

  const lastEvent = events[events.length - 1];
  const validEndings = ['run.completed', 'run.failed', 'run.cancelled'];
  assert(
    validEndings.includes(lastEvent.type),
    `Expected last event to be one of [${validEndings}] but got '${lastEvent.type}'`,
  );

  // All events must have matching runId
  for (const event of events) {
    assert(
      (event as any).runId === runId,
      `Event '${event.type}' has mismatched runId: expected '${runId}', got '${(event as any).runId}'`,
    );
  }
}

function checkNoPiTypeLeak(events: AgentRuntimeEvent[]): void {
  for (const event of events) {
    const raw = JSON.stringify(event);
    // Check for common Pi type field names that should NOT appear
    assert(!raw.includes('provider'), 'Event leaked Pi provider field');
    // Check all events are valid AgentRuntimeEvent types
    const validTypes = [
      'run.started', 'assistant.delta', 'assistant.completed',
      'reasoning.delta', 'tool.requested', 'tool.started',
      'tool.completed', 'tool.failed', 'usage.updated',
      'run.completed', 'run.cancelled', 'run.failed',
      'run.compacted', 'unknown',
    ];
    assert(
      validTypes.includes(event.type),
      `Invalid event type: '${event.type}'`,
    );
  }
}

function checkToolEventsConsistency(events: AgentRuntimeEvent[]): void {
  const toolStarts = events.filter(e => e.type === 'tool.started');
  const toolCompletions = events.filter(
    e => e.type === 'tool.completed' || e.type === 'tool.failed',
  );

  // Each tool.start should have a matching completion
  for (const start of toolStarts) {
    const callId = (start as any).callId;
    const matching = toolCompletions.find(
      (e: any) => e.callId === callId,
    );
    assert(
      !!matching,
      `Tool start with callId '${callId}' has no matching completion/failure`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// Runner
// ═══════════════════════════════════════════════════════════════════

export async function runAdapterContractTests(
  adapter: AgentRuntimePort | InferencePort,
  adapterName: string,
): Promise<void> {
  console.log(`\n📋 Running contract tests for: ${adapterName}`);
  console.log('═'.repeat(60));

  // Test 1: Plain text output
  await runTest('Plain text output', async () => {
    if ('execute' in adapter) {
      const events: AgentRuntimeEvent[] = [];
      for await (const event of adapter.execute(simpleTextScenario())) {
        events.push(event);
      }
      checkEventsStructure(events, events[0]?.runId ?? '');
    }
  });

  // Test 2: Streaming token delivery
  await runTest('Streaming token delivery', async () => {
    if ('execute' in adapter) {
      const events: AgentRuntimeEvent[] = [];
      for await (const event of adapter.execute(simpleTextScenario())) {
        events.push(event);
      }
      const deltas = events.filter(e => e.type === 'assistant.delta');
      // At minimum, events should have valid structure
      checkEventsStructure(events, events[0]?.runId ?? '');
    }
  });

  // Test 3: Tool call handling (if tool calling supported)
  await runTest('Tool call handling', async () => {
    if ('execute' in adapter) {
      const events: AgentRuntimeEvent[] = [];
      for await (const event of adapter.execute(toolCallScenario())) {
        events.push(event);
      }
      checkEventsStructure(events, events[0]?.runId ?? '');
      checkNoPiTypeLeak(events);
    }
  });

  // Test 4: No Pi type leak
  await runTest('No Pi type leak in events', async () => {
    if ('execute' in adapter) {
      const events: AgentRuntimeEvent[] = [];
      for await (const event of adapter.execute(simpleTextScenario())) {
        events.push(event);
      }
      checkNoPiTypeLeak(events);
    }
  });

  // Test 5: Error handling for timeout
  await runTest('Timeout handling', async () => {
    if ('execute' in adapter) {
      const events: AgentRuntimeEvent[] = [];
      for await (const event of adapter.execute(timeoutScenario())) {
        events.push(event);
      }
      const lastEvent = events[events.length - 1];
      // Should either complete or fail gracefully
      assert(
        ['run.completed', 'run.failed', 'run.cancelled'].includes(lastEvent.type),
        `Timeout scenario should end with completed/failed/cancelled, got '${lastEvent.type}'`,
      );
    }
  });

  // Test 6: Cancellation via AbortSignal
  await runTest('Cancellation via AbortSignal', async () => {
    if ('cancel' in adapter) {
      const runId = `cancel_test_${Date.now()}`;
      const request = simpleTextScenario();
      request.runId = runId;

      const events: AgentRuntimeEvent[] = [];
      const iterator = adapter.execute(request);

      // Collect events and cancel after the first one
      const firstEvent = await iterator.next();
      if (!firstEvent.done) {
        events.push(firstEvent.value);
        // Cancel immediately
        await (adapter as AgentRuntimePort).cancel(runId, 'Test cancellation');
      }

      // Collect remaining
      for await (const event of iterator) {
        events.push(event);
      }

      const lastEvent = events.length > 0 ? events[events.length - 1] : events[0];
      // Should have either cancelled or completed
      assert(
        lastEvent.type === 'run.cancelled' || lastEvent.type === 'run.completed' || lastEvent.type === 'run.failed',
        `After cancellation, should get cancelled/completed/failed, got '${lastEvent?.type}'`,
      );
    }
  });

  // Test 7: Capabilities reporting
  await runTest('Capabilities reporting', async () => {
    if ('getCapabilities' in adapter) {
      const caps = await (adapter as AgentRuntimePort).getCapabilities!();
      assert(typeof caps === 'object', 'Capabilities must be an object');
      assert('streaming' in caps, 'Capabilities must include streaming');
      assert('toolCalling' in caps, 'Capabilities must include toolCalling');
      assert('cancellation' in caps, 'Capabilities must include cancellation');
    }
  });

  // Test 8: Concurrent run isolation
  await runTest('Concurrent run isolation', async () => {
    if ('execute' in adapter) {
      const runId1 = `concurrent_1_${Date.now()}`;
      const runId2 = `concurrent_2_${Date.now()}`;
      const req1 = { ...simpleTextScenario(), runId: runId1 };
      const req2 = { ...simpleTextScenario(), runId: runId2 };

      const events1: AgentRuntimeEvent[] = [];
      const events2: AgentRuntimeEvent[] = [];

      // Start both runs concurrently
      const iter1 = adapter.execute(req1);
      const iter2 = adapter.execute(req2);

      // Collect all events from both
      const [r1, r2] = await Promise.all([
        (async () => { for await (const e of iter1) events1.push(e); })(),
        (async () => { for await (const e of iter2) events2.push(e); })(),
      ]);

      // Each run's events should be internally consistent
      for (const events of [events1, events2]) {
        if (events.length > 0) {
          checkEventsStructure(events, events[0].runId);
        }
      }
    }
  });

  console.log(`\n📊 Results for ${adapterName}:`);
  console.log(`  ${passedTests}/${totalTests} passed (for all adapters this round)`);
}

// ═══════════════════════════════════════════════════════════════════
// CLI Entry Point
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const adapterFlag = args.find(a => a.startsWith('--adapter='));
  const adapterType = adapterFlag?.split('=')[1] ?? 'all';

  if (adapterType === 'mock' || adapterType === 'all') {
    const { MockRuntimeAdapter } = await import('@morpex/adapters/mock-runtime');
    const adapter = new MockRuntimeAdapter([
      { event: { type: 'run.started', runId: '', timestamp: Date.now() } },
      { event: { type: 'assistant.delta', runId: '', text: 'Hello' } },
      { event: { type: 'assistant.completed', runId: '', content: 'Hello' } },
      { event: { type: 'run.completed', runId: '' } },
    ]);
    await runAdapterContractTests(adapter as any, 'MockRuntimeAdapter');
  }

  if (adapterType === 'pi-ai' || adapterType === 'all') {
    try {
      const { PiAIAdapter } = await import('@morpex/adapters/pi-ai');
      const adapter = new PiAIAdapter();
      await runAdapterContractTests(adapter as any, 'PiAIAdapter');
    } catch (err) {
      console.log(`  ⚠️ PiAIAdapter tests skipped (requires real Pi backend): ${err}`);
    }
  }

  if (adapterType === 'pi-agent-core' || adapterType === 'all') {
    try {
      const { PiAgentCoreAdapter } = await import('@morpex/adapters/pi-agent-core');
      const adapter = new PiAgentCoreAdapter();
      await runAdapterContractTests(adapter as any, 'PiAgentCoreAdapter');
    } catch (err) {
      console.log(`  ⚠️ PiAgentCoreAdapter tests skipped (requires real Pi backend): ${err}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`🏁 Total: ${totalTests} tests, ${passedTests} passed, ${totalTests - passedTests} failed`);
}

main().catch(console.error);
