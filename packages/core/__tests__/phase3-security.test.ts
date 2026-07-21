/**
 * Phase 3: Security & Governance Tests
 */

let pass = 0; let fail = 0
function ok(c: boolean, m: string) { if (c) pass++; else { console.error(`  ❌ ${m}`); fail++; } }
function eq<T>(a: T, b: T, m: string) { if (a === b) pass++; else { console.error(`  ❌ ${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); fail++; } }

const TEST_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0'

async function main() {
  console.log('\n═══════════════════════════════════════════════')
  console.log('   Phase 3: Security & Governance')
  console.log('═══════════════════════════════════════════════\n')

  // ══════════════════════════════════════
  // 1. EncryptionService
  // ══════════════════════════════════════
  console.log('\n📋 1. EncryptionService\n')

  process.env.MORPEX_ENCRYPTION_KEY = TEST_KEY

  let EncryptionService: any
  try {
    const mod = await import('../src/common/EncryptionService.js')
    EncryptionService = mod.EncryptionService
    ok(true, 'EncryptionService module loaded')
  } catch (e: any) {
    ok(false, `Module load: ${e.message}`)
  }

  if (EncryptionService) {
    // Round-trip encrypt/decrypt
    try {
      const enc = new EncryptionService()
      const plaintext = '{"apiKey":"sk-test-123","secret":"my-secret-data"}'
      const encrypted = enc.encrypt(plaintext)
      ok(typeof encrypted === 'string', 'encrypt returns string')
      ok(encrypted.includes(':'), 'encrypted has iv:tag:ciphertext format')
      const parts = encrypted.split(':')
      eq(parts.length, 3, 'encrypted has 3 parts (iv, tag, ciphertext)')
      const decrypted = enc.decrypt(encrypted)
      eq(decrypted, plaintext, 'decrypt(encrypt(plaintext)) === plaintext')
    } catch (e: any) {
      ok(false, `Encrypt/decrypt: ${e.message}`)
    }

    // IV randomization
    try {
      const enc = new EncryptionService()
      const e1 = enc.encrypt('same-text')
      const e2 = enc.encrypt('same-text')
      ok(e1 !== e2, 'same plaintext produces different ciphertext (IV randomization)')
    } catch (e: any) {
      ok(false, `IV randomization: ${e.message}`)
    }

    // Wrong key throws
    try {
      const enc = new EncryptionService()
      const encrypted = enc.encrypt('test-data')
      process.env.MORPEX_ENCRYPTION_KEY = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      const enc2 = new EncryptionService()
      try {
        enc2.decrypt(encrypted)
        ok(false, 'Wrong key should have thrown')
      } catch {
        ok(true, 'decrypt with wrong key throws')
      }
      process.env.MORPEX_ENCRYPTION_KEY = TEST_KEY
    } catch (e: any) {
      ok(false, `Wrong key test: ${e.message}`)
    }

    // Missing key throws
    try {
      const oldKey = process.env.MORPEX_ENCRYPTION_KEY
      delete process.env.MORPEX_ENCRYPTION_KEY
      new EncryptionService()
      ok(false, 'Missing key should have thrown')
      process.env.MORPEX_ENCRYPTION_KEY = oldKey
    } catch {
      ok(true, 'constructor with missing key throws')
      process.env.MORPEX_ENCRYPTION_KEY = TEST_KEY
    }
  }

  // ══════════════════════════════════════
  // 2. SandboxManager
  // ══════════════════════════════════════
  console.log('\n📋 2. SandboxManager — Third-party & Behavior\n')

  let SandboxManager: any
  try {
    const mod = await import('../src/runtime/sandbox/SandboxManager.js')
    SandboxManager = mod.SandboxManager
    ok(true, 'SandboxManager module loaded')
  } catch (e: any) {
    ok(false, `Module load: ${e.message}`)
  }

  if (SandboxManager) {
    const sm = new SandboxManager()

    // Third-party context
    const tpc = sm.getThirdPartySandboxContext()
    eq(tpc.network, false, 'third-party context: no network')
    eq(tpc.filesystem, 'readonly', 'third-party context: readonly fs')
    eq(tpc.timeout, 60000, 'third-party context: 60s timeout')
    eq(tpc.cpuLimit, 1, 'third-party context: CPU 1')
    eq(tpc.memoryLimit, 256, 'third-party context: 256MB memory')

    // Risky agent behavior
    sm.registerAgentBehavior('agent-risky-1', 'delete_file')
    sm.registerAgentBehavior('agent-risky-1', 'exec_script')
    sm.registerAgentBehavior('agent-risky-1', 'read_file')

    const riskScore = sm.getAgentRiskScore('agent-risky-1')
    ok(riskScore > 0, 'risky agent has non-zero risk score')
    ok(riskScore <= 1, 'risk score capped at 1')

    // Low-risk agent (only safe actions)
    sm.registerAgentBehavior('agent-safe-1', 'read_file')
    sm.registerAgentBehavior('agent-safe-1', 'analyze_data')

    const safeScore = sm.getAgentRiskScore('agent-safe-1')
    // Safe agent: no risky actions, but might have recency penalty
    // recencyPenalty = 0.2 * min(1, 2/5) = 0.08
    ok(safeScore < 0.15, `safe agent has low risk score: ${safeScore}`)

    // High-risk agent detection
    const highRisk = sm.getHighRiskAgentIds(0.5)
    ok(highRisk.includes('agent-risky-1'), 'high-risk agent detected')
    ok(!highRisk.includes('agent-safe-1'), 'safe agent not in high-risk list')

    // Unknown agent
    eq(sm.getAgentRiskScore('unknown-agent'), 0, 'unknown agent returns 0 risk')
  }

  // ══════════════════════════════════════
  // 3. PermissionModel — Agent Extensions
  // ══════════════════════════════════════
  console.log('\n📋 3. PermissionModel — Agent Extensions\n')

  let PermissionModel: any
  try {
    const mod = await import('../src/control/PermissionModel.js')
    PermissionModel = mod.PermissionModel
    ok(true, 'PermissionModel module loaded')
  } catch (e: any) {
    ok(false, `Module load: ${e.message}`)
  }

  if (PermissionModel) {
    const pm = new PermissionModel()

    // Setup agent with shared memory access
    pm.setPermissions({
      userId: 'planner-001',
      permissions: ['read', 'write', 'agent_access_shared_memory'],
      allowedDomains: ['*'],
      allowedTools: ['*'],
      maxRiskLevel: 'medium',
      allowedSharedMemory: ['project_alpha/*', 'team_shared/*'],
    })

    // Setup agent without shared memory access
    pm.setPermissions({
      userId: 'executor-001',
      permissions: ['read', 'write'],
      allowedDomains: ['*'],
      allowedTools: ['*'],
      maxRiskLevel: 'medium',
    })

    // Setup evolve agent
    pm.setPermissions({
      userId: 'evolver-001',
      permissions: ['read', 'write', 'agent_evolve'],
      allowedDomains: ['*'],
      allowedTools: ['*'],
      maxRiskLevel: 'low',
    })

    // canAccessSharedMemory with matching pattern
    const check1 = pm.canAccessSharedMemory('planner-001', 'team_alpha', 'project_alpha/config')
    ok(check1.allowed, 'planner can access project_alpha/config (wildcard match)')

    // canAccessSharedMemory with non-matching pattern
    const check2 = pm.canAccessSharedMemory('planner-001', 'team_alpha', 'secret_data/password')
    ok(!check2.allowed, 'planner cannot access non-matching key')

    // canAccessSharedMemory without permission
    const check3 = pm.canAccessSharedMemory('executor-001', 'team_alpha', 'project_alpha/config')
    ok(!check3.allowed, 'executor without shared memory permission denied')
    ok(check3.missingPermissions.includes('agent_access_shared_memory'), 'denied due to missing permission')

    // canAgentEvolve — allowed
    const evolveCheckAllowed = pm.canAgentEvolve('evolver-001')
    ok(evolveCheckAllowed.allowed, 'evolver can self-evolve')

    // canAgentEvolve — denied
    const evolveCheckDenied = pm.canAgentEvolve('executor-001')
    ok(!evolveCheckDenied.allowed, 'executor cannot self-evolve')
    ok(evolveCheckDenied.missingPermissions.includes('agent_evolve'), 'denied due to missing evolve permission')
  }

  // ══════════════════════════════════════
  // Summary
  // ══════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════')
  console.log(`   Phase 3: ${pass} passed, ${fail} failed`)
  console.log('═══════════════════════════════════════════════\n')
  process.exit(fail > 0 ? 1 : 0)
}

main()
