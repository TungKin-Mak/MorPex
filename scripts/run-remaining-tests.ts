// Quick runner for remaining tests
(async () => {
  const files = [
    ['Integration: Intent→Planning', '../tests/integration/intent-to-planning.test.ts'],
    ['Integration: Planning→Runtime', '../tests/integration/planning-to-runtime.test.ts'],
    ['Integration: Runtime→Harness', '../tests/integration/runtime-to-harness.test.ts'],
    ['Integration: Artifact→Knowledge', '../tests/integration/artifact-to-knowledge.test.ts'],
    ['Integration: Execution→Learning', '../tests/integration/execution-to-learning.test.ts'],
    ['Scenario: Simple Task', '../tests/scenarios/simple-task.test.ts'],
    ['Scenario: Multi-step Task', '../tests/scenarios/multi-step-task.test.ts'],
    ['Scenario: Failure Recovery', '../tests/scenarios/failure-recovery.test.ts'],
    ['Scenario: Learning Improvement', '../tests/scenarios/learning-improvement.test.ts'],
    ['Chaos: Agent Crash', '../tests/chaos/agent-crash.test.ts'],
    ['Chaos: Tool Failure', '../tests/chaos/tool-failure.test.ts'],
  ];
  for (const [name, fp] of files) {
    try {
      const mod = await import(fp);
      const r = await (mod.run || mod.default)();
      console.log(r.passed ? '✅' : '❌', name, '-', r.assertionsPassed + '/' + r.assertions);
      if (!r.passed) for (const e of r.errors) console.log('   ', e);
    } catch (e: any) {
      console.log('❌', name, '- CRASHED:', e.message.slice(0, 80));
    }
  }
})();
