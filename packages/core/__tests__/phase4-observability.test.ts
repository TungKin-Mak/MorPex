/**
 * Phase 4: Observability & Operations Tests
 *
 * v9.2 Phase 4: PrometheusExporter, HealthCheckService, CircuitBreaker event emission
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MetricsCollector } from '../src/observability/MetricsCollector.js'
import { PrometheusExporter } from '../src/observability/PrometheusExporter.js'
import { HealthCheckService } from '../src/observability/HealthCheckService.js'
import { CircuitBreaker } from '../src/common/resilience/CircuitBreaker.js'

// ── PrometheusExporter ──

describe('PrometheusExporter', () => {
  it('text output contains HELP and TYPE lines', () => {
    const mc = new MetricsCollector(100)
    mc.record('test.counter', 42, { tag: 'val' })
    const pe = new PrometheusExporter(mc)
    const result = pe.export()

    assert.match(result.text, /^# HELP .+$/m, 'should have HELP lines')
    assert.match(result.text, /^# TYPE .+$/m, 'should have TYPE lines')
    assert.match(result.text, /process_uptime_seconds/, 'should include uptime')
    assert.match(result.text, /process_memory_heap_bytes/, 'should include memory')
  })

  it('includes system metrics in JSON output', () => {
    const mc = new MetricsCollector(100)
    const pe = new PrometheusExporter(mc)
    const result = pe.export()

    assert.ok(result.json['process.uptime_seconds'] >= 0, 'uptime >= 0')
    assert.ok(result.json['process.memory_heap_used'] > 0, 'heap used > 0')
    assert.ok(typeof result.json['process.cpu_percent'] === 'number', 'cpu percent is number')
  })

  it('v9 JSON via exportV9Json() returns structured metrics', () => {
    const mc = new MetricsCollector(100)
    mc.recordTeamFormation(1500, 3)
    mc.recordSharedMemoryConflict('key1')
    mc.recordMarketplaceBid('listing_1', true)
    mc.recordCircuitBreakerTrip('cb1')
    mc.recordDistributedMessage('node-a', 'node-b', 45)

    const pe = new PrometheusExporter(mc)
    const v9 = pe.exportV9Json()

    assert.ok(typeof v9.teamFormations.avgDurationMs === 'number')
    assert.ok(v9.teamFormations.count >= 1)
    assert.ok(v9.sharedMemory.conflicts >= 1)
    assert.ok(v9.marketplace.wonBids >= 1)
    assert.ok(v9.distributed.messagesSent >= 1)
    assert.ok(v9.resilience.circuitBreakerTrips >= 1)
  })

  it('export() includes business metrics from MetricsCollector', () => {
    const mc = new MetricsCollector(100)
    mc.record('business.order_count', 10)
    mc.record('business.revenue', 999.50)

    const pe = new PrometheusExporter(mc)
    const result = pe.export()

    assert.match(result.text, /business_order_count/, 'should include business metric')
    assert.match(result.text, /business_revenue/, 'should include revenue metric')
    assert.ok(result.json['business.order_count'] === 10)
    assert.ok(result.json['business.revenue'] === 999.5)
  })
})

// ── HealthCheckService ──

describe('HealthCheckService', () => {
  it('register + run returns healthy when all checks pass', async () => {
    const hcs = new HealthCheckService('1.0.0')
    hcs.register({
      name: 'ok_check',
      check: async () => ({ status: 'ok', detail: 'all good' }),
    })
    hcs.register({
      name: 'ok_check2',
      check: async () => ({ status: 'ok' }),
    })

    const status = await hcs.run()
    assert.equal(status.status, 'healthy')
    assert.ok(Object.keys(status.checks).length === 2)
    assert.equal(status.version, '1.0.0')
    assert.ok(status.uptimeMs >= 0, 'uptimeMs >= 0')
  })

  it('degraded when one check returns non-ok', async () => {
    const hcs = new HealthCheckService()
    hcs.register({ name: 'good', check: async () => ({ status: 'ok' }) })
    hcs.register({ name: 'warn', check: async () => ({ status: 'warning', detail: 'high memory' }) })

    const status = await hcs.run()
    assert.equal(status.status, 'degraded')
    assert.equal(status.checks['warn']?.status, 'warning')
  })

  it('unhealthy when all checks fail', async () => {
    const hcs = new HealthCheckService()
    hcs.register({ name: 'fail1', check: async () => { throw new Error('down') } })
    hcs.register({ name: 'fail2', check: async () => { throw new Error('offline') } })

    const status = await hcs.run()
    assert.equal(status.status, 'unhealthy')
    assert.match(status.checks['fail1']?.detail || '', /down/)
  })

  it('check timeout produces error status (degraded)', async () => {
    const hcs = new HealthCheckService()
    hcs.register({
      name: 'slow',
      check: async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return { status: 'ok' }
      },
      timeoutMs: 50,
    })

    const status = await hcs.run()
    assert.equal(status.status, 'degraded')
    assert.match(status.checks['slow']?.detail || '', /timeout/)
  })

  it('healthy recovers after fixing a failing check', async () => {
    const hcs = new HealthCheckService()
    let fail = true
    hcs.register({
      name: 'flaky',
      check: async () => {
        if (fail) throw new Error('not ready')
        return { status: 'ok' }
      },
    })

    let status = await hcs.run()
    assert.equal(status.status, 'unhealthy')

    fail = false
    status = await hcs.run()
    assert.equal(status.status, 'healthy')
  })
})

// ── CircuitBreaker event emission ──

describe('CircuitBreaker events', () => {
  it('emits circuit.open when threshold reached', async () => {
    const events: any[] = []
    const cb = new CircuitBreaker('test-cb', { failureThreshold: 3, openTimeoutMs: 60000 }, {
      emit: (type, payload) => events.push({ type, payload }),
    })

    for (let i = 0; i < 3; i++) {
      cb.recordFailure()
    }
    await new Promise(r => setTimeout(r, 5))

    const openEvents = events.filter(e => e.type === 'circuit.open')
    assert.equal(openEvents.length, 1)
    assert.equal(openEvents[0].payload.name, 'test-cb')
    assert.ok(openEvents[0].payload.failureCount >= 3)
  })

  it('emits circuit.half_open on state transition', async () => {
    const events: any[] = []
    const cb = new CircuitBreaker('cb-halftest',
      { failureThreshold: 2, openTimeoutMs: 10 },
      { emit: (type, p) => events.push({ type, ...p }) }
    )

    // Trip to OPEN using recordFailure
    for (let i = 0; i < 2; i++) {
      cb.recordFailure()
    }
    // Wait for HALF_OPEN timeout
    await new Promise(r => setTimeout(r, 20))
    // Trigger HALF_OPEN evaluation via getState() which calls evaluateState()
    const state = cb.getState()
    assert.equal(state, 'HALF_OPEN', 'should transition to HALF_OPEN after timeout')
    await new Promise(r => setTimeout(r, 5))

    const halfOpenEvents = events.filter(e => e.type === 'circuit.half_open')
    assert.ok(halfOpenEvents.length >= 1, 'should emit half_open')
    assert.ok(halfOpenEvents[0].name === 'cb-halftest', 'event has breaker name')
  })

  it('multiple transitions produce multiple events', async () => {
    const events: any[] = []
    const cb = new CircuitBreaker('multi',
      { failureThreshold: 2, openTimeoutMs: 50000 },
      { emit: (type, p) => events.push({ type, ...p }) }
    )

    // Trip to OPEN using recordFailure directly (avoids async microtask timing)
    for (let i = 0; i < 2; i++) {
      cb.recordFailure()
    }
    // Reset to CLOSED
    await new Promise(r => setTimeout(r, 5))
    cb.reset()

    // Trip again
    for (let i = 0; i < 2; i++) {
      cb.recordFailure()
    }
    await new Promise(r => setTimeout(r, 5))

    const openEvents = events.filter(e => e.type === 'circuit.open')
    assert.equal(openEvents.length, 2, 'should emit open twice')
  })
})

// ── Integration: Metrics → PrometheusExporter → HealthCheck ──

describe('Integration chain', () => {
  it('MetricsCollector → PrometheusExporter full chain', () => {
    const mc = new MetricsCollector(100)
    mc.record('test.val', 1)
    mc.recordTeamFormation(500, 2)

    const pe = new PrometheusExporter(mc)
    const result = pe.export()

    assert.match(result.text, /test_val/)
    assert.ok(result.json['test.val'] === 1)
  })

  it('PrometheusExporter + HealthCheckService coexist', async () => {
    const mc = new MetricsCollector(100)
    mc.record('health.test', 1)
    const pe = new PrometheusExporter(mc)
    const hcs = new HealthCheckService()

    hcs.register({
      name: 'metrics_check',
      check: async () => {
        const result = pe.export()
        return result.json['health.test'] === 1
          ? { status: 'ok', detail: 'metrics available' }
          : { status: 'error', detail: 'missing metrics' }
      },
    })

    const status = await hcs.run()
    assert.equal(status.status, 'healthy')
  })
})
