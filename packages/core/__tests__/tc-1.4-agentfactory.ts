/**
 * TC-1.4 AgentFactory SecurityBoundaryException — 安全边界测试
 */
import { AgentFactory, SecurityBoundaryException } from '../services/AgentFactory.js';

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { console.log('  ❌ ' + m); fail++; } }

console.log('\n📋 TC-1.4 AgentFactory SecurityBoundaryException\n');

const factory = new AgentFactory();

// TC-1.4a: 缺失 identityToken → throw SecurityBoundaryException
try {
  await factory.spawn({
    identityToken: '',
    cgroupQuota: { tokenLimit: 2_000_000, usedTokens: 0 },
    ring: 1,
  });
  ok(false, 'TC-1.4a 应抛出异常');
} catch (e) {
  ok(e instanceof SecurityBoundaryException, 'TC-1.4a 缺失 identityToken → SecurityBoundaryException');
  console.log('  ✓ TC-1.4a:', (e as Error).message);
}

// TC-1.4b: 缺失 cgroupQuota → throw SecurityBoundaryException
try {
  await factory.spawn({
    identityToken: 'test-token',
    cgroupQuota: undefined as any,
    ring: 1,
  });
  ok(false, 'TC-1.4b 应抛出异常');
} catch (e) {
  ok(e instanceof SecurityBoundaryException, 'TC-1.4b 缺失 cgroupQuota → SecurityBoundaryException');
  console.log('  ✓ TC-1.4b:', (e as Error).message);
}

// TC-1.4c: 配额耗尽 (usedTokens >= tokenLimit) → throw SecurityBoundaryException
try {
  await factory.spawn({
    identityToken: 'test-token',
    cgroupQuota: { tokenLimit: 1000, usedTokens: 1000 },
    ring: 1,
  });
  ok(false, 'TC-1.4c 应抛出异常');
} catch (e) {
  ok(e instanceof SecurityBoundaryException, 'TC-1.4c 配额耗尽 → SecurityBoundaryException');
  console.log('  ✓ TC-1.4c:', (e as Error).message);
}

// TC-1.4d: 合法参数 → 返回 AgentHarness 实例
try {
  const harness = await factory.spawn({
    identityToken: 'test-token-morpex-2025',
    cgroupQuota: { tokenLimit: 2_000_000, usedTokens: 0 },
    ring: 1,
    systemPrompt: '测试',
  });
  ok(!!harness, 'TC-1.4d 合法参数 → 返回实例');
  ok(typeof harness.prompt === 'function', 'TC-1.4d 有 prompt 方法');
  console.log('  ✓ TC-1.4d: AgentHarness 创建成功');
} catch (e: any) {
  ok(false, 'TC-1.4d 合法参数应成功: ' + e.message);
}

// TC-2.3a: 配额消耗验证 — 每次 spawn() usedTokens += 1000
console.log('\n📋 TC-2.3a 配额消耗\n');
const quota = { tokenLimit: 2_000_000, usedTokens: 0 };
const h1 = await factory.spawn({
  identityToken: 'test-token',
  cgroupQuota: quota,
  ring: 1,
});
ok(quota.usedTokens === 1000, `TC-2.3a 第1次 spawn 后配额=1000 (实际=${quota.usedTokens})`);
const h2 = await factory.spawn({
  identityToken: 'test-token',
  cgroupQuota: quota,
  ring: 1,
});
ok(quota.usedTokens === 2000, `TC-2.3a 第2次 spawn 后配额=2000 (实际=${quota.usedTokens})`);

// TC-2.3b: 配额耗尽边界
console.log('\n📋 TC-2.3b 配额耗尽边界\n');
const quota2 = { tokenLimit: 2_000_000, usedTokens: 1_999_000 };
try {
  await factory.spawn({ identityToken: 'test-token', cgroupQuota: quota2, ring: 1 });
  ok(quota2.usedTokens === 2_000_000, `TC-2.3b 第1次成功, 配额=${quota2.usedTokens}`);
  // 第2次应耗尽
  await factory.spawn({ identityToken: 'test-token', cgroupQuota: quota2, ring: 1 });
  ok(false, 'TC-2.3b 第2次应耗尽');
} catch (e) {
  ok(e instanceof SecurityBoundaryException, 'TC-2.3b 配额耗尽');
  console.log('  ✓ TC-2.3b:', (e as Error).message);
}

console.log(`\n📊 TC-1.4 + TC-2.3: ${pass} 通过, ${fail} 失败, ${pass+fail} 总`);
process.exit(fail > 0 ? 1 : 0);
