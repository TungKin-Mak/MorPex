// 回跳语义冒烟测试：b 首跑失败 → on_failure:backjump:a → 重置 a/b 重跑 → 成功
import { DomainPrimitiveRegistry } from '../packages/core/src/infrastructure/tools/DomainPrimitiveRegistry.ts';
import type { ActionPrimitive, ActionResult } from '../packages/core/src/infrastructure/tools/primitives/types.ts';
import { YamlWorkflowRuntime } from '../packages/core/src/execution/runtime/manual/YamlWorkflowRuntime.ts';

let aCalls = 0;
const echoA: ActionPrimitive = {
  name: 'test.a',
  description: 'step A',
  inputSchema: { type: 'object' },
  canHandle: () => 0,
  async execute(): Promise<ActionResult> {
    aCalls++;
    return { success: true, data: { token: 'T' + aCalls } };
  },
};
let bCalls = 0;
const flakyB: ActionPrimitive = {
  name: 'test.b',
  description: 'step B (fails on first attempt)',
  inputSchema: { type: 'object' },
  canHandle: () => 0,
  async execute(params): Promise<ActionResult> {
    bCalls++;
    const token = (params as any).token;
    if (token === 'T1') return { success: false, error: '模拟：首跑失败（token 过期）' };
    return { success: true, data: { done: true, usedToken: token } };
  },
};
DomainPrimitiveRegistry.registerMultiple([echoA, flakyB]);

const llmCalls: string[] = [];
const runtime = new YamlWorkflowRuntime({
  manual: {
    name: 'backjump-smoke', version: 1,
    steps: [
      { id: 'a', action: 'test.a', description: 'produce token', outputs: ['token'] },
      { id: 'b', action: 'test.b', description: 'consume token',
        inputs: { token: '${steps.a.outputs.token}' },
        depends_on: ['a'], on_failure: 'backjump:a', outputs: ['done'] },
      { id: 'c', action: 'llm', description: 'summarize ${steps.b.outputs.done}',
        depends_on: ['b'], outputs: ['report'] },
    ],
  } as any,
  stepExecutor: {
    async executeStep(node) {
      llmCalls.push(node.name);
      return { success: true, output: '报告完成' };
    },
  },
});

const r = await runtime.run({});
console.log('success:', r.success, '| backjumps:', r.backjumps, '| aCalls:', aCalls, '| bCalls:', bCalls);
console.log('llm steps ran:', llmCalls.join(','));
console.log('outputs.b.done:', JSON.stringify(r.outputs.get('b')?.get('done')));
if (!r.success || r.backjumps !== 1 || aCalls !== 2 || bCalls !== 2) {
  console.error('SMOKE FAIL'); process.exit(1);
}
console.log('BACKJUMP SMOKE PASS');
