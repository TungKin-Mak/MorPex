/**
 * MorPex k6 Load Test Suite
 * 
 * 覆盖场景:
 *   1. Agent 并发执行 (阶梯式加压 1→10→50→100 VU)
 *   2. EventBus 发布压力测试
 *   3. Mission 提交尖峰测试
 *   4. Pipeline 执行并发测试
 *   5. Health Check 基线
 * 
 * 目标:
 *   - P95 < 2s
 *   - 错误率 < 0.5%
 * 
 * 用法:
 *   k6 run scripts/k6-load-test.js
 *   k6 run --vus 50 --duration 60s scripts/k6-load-test.js
 *   k6 run --out json=results.json scripts/k6-load-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ═══════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3100';
const API_URL = __ENV.API_URL || 'http://localhost:3001';

// Custom metrics
const missionSuccessRate = new Rate('mission_success');
const eventPublishRate = new Rate('event_publish_success');
const pipelineDuration = new Trend('pipeline_duration_ms');
const missionDuration = new Trend('mission_duration_ms');
const eventLatency = new Trend('event_latency_ms');
const errors = new Counter('errors');

// Thresholds
export const options = {
  // ── Stage 1: Warm-up (10 VU, 30s) ──
  // ── Stage 2: Baseline load (50 VU, 60s) ──
  // ── Stage 3: Stress (100 VU, 60s) ──
  // ── Stage 4: Spike (200 VU, 30s) ──
  // ── Stage 5: Cool-down (10 VU, 30s) ──
  stages: [
    { duration: '30s', target: 10 },   // warm-up
    { duration: '30s', target: 50 },   // ramp to baseline
    { duration: '60s', target: 50 },   // baseline steady
    { duration: '30s', target: 100 },  // ramp to stress
    { duration: '60s', target: 100 },  // stress steady
    { duration: '30s', target: 200 },  // spike
    { duration: '30s', target: 200 },  // hold spike
    { duration: '30s', target: 10 },   // cool-down
  ],

  thresholds: {
    // P95 latency < 2s
    'http_req_duration{name:pipeline-execute}': ['p(95)<2000'],
    'http_req_duration{name:mission-create}': ['p(95)<2000'],
    'http_req_duration{name:event-publish}': ['p(95)<500'],
    'http_req_duration{name:health-check}': ['p(95)<500'],
    
    // Error rate < 0.5%
    http_req_failed: ['rate<0.005'],
    
    // Custom metrics
    'mission_success': ['rate>0.95'],
    'event_publish_success': ['rate>0.99'],
    'errors': ['count<50'],
  },

  // Graceful degradation
  noConnectionReuse: false,
  discardResponseBodies: false,
};

// ═══════════════════════════════════════════════════════════
// Setup & Teardown
// ═══════════════════════════════════════════════════════════

export function setup() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  MorPex k6 Load Test — Starting         ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  API URL:  ${API_URL}`);
  console.log(`  VUs:      ${__VU}`);
  console.log('');

  // Pre-flight health check
  const healthResp = http.get(`${BASE_URL}/health`, {
    timeout: '5s',
    tags: { name: 'health-check' },
  });

  check(healthResp, {
    'Health check responds 200': (r) => r.status === 200,
  }) || console.warn('⚠️ Health check failed — system may be down');

  return {
    startTime: Date.now(),
  };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  MorPex k6 Load Test — Complete         ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Duration: ${duration.toFixed(1)}s`);
}

// ═══════════════════════════════════════════════════════════
// Test Scenarios
// ═══════════════════════════════════════════════════════════

export default function () {
  // Distribute load across scenarios
  const scenario = Math.random();

  if (scenario < 0.30) {
    // 30%: Mission creation + execution
    testMissionLifecycle();
  } else if (scenario < 0.55) {
    // 25%: EventBus publish stress
    testEventBusPublish();
  } else if (scenario < 0.75) {
    // 20%: Pipeline execution
    testPipelineExecution();
  } else if (scenario < 0.90) {
    // 15%: Health check baseline
    testHealthCheck();
  } else {
    // 10%: Mixed read queries
    testReadQueries();
  }

  // Think time: 100ms ~ 500ms (simulates real user pacing)
  sleep(Math.random() * 0.4 + 0.1);
}

// ═══════════════════════════════════════════════════════════
// Scenario 1: Mission Lifecycle (30%)
// ═══════════════════════════════════════════════════════════

function testMissionLifecycle() {
  const missionId = `load_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  group('Mission Lifecycle', function () {
    // Step 1: Create mission
    const createPayload = JSON.stringify({
      id: missionId,
      goal: `Load test mission — ${missionId}`,
      context: { priority: 'normal', source: 'k6-load-test' },
      metadata: { vu: __VU, iteration: __ITER },
    });

    const createResp = http.post(`${API_URL}/missions`, createPayload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: '5s',
      tags: { name: 'mission-create' },
    });

    const created = check(createResp, {
      'Mission created (2xx)': (r) => r.status >= 200 && r.status < 300,
    });

    if (!created) {
      errors.add(1);
      missionSuccessRate.add(false);
      return;
    }

    missionDuration.add(createResp.timings.duration);

    // Step 2: Execute mission
    const execPayload = JSON.stringify({
      action: 'execute',
      missionId: missionId,
    });

    const execResp = http.post(`${API_URL}/missions/${missionId}/execute`, execPayload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: '10s',
      tags: { name: 'mission-execute' },
    });

    const executed = check(execResp, {
      'Mission executed (2xx)': (r) => r.status >= 200 && r.status < 300,
    });

    if (executed) {
      missionSuccessRate.add(true);
      missionDuration.add(execResp.timings.duration);
    } else {
      missionSuccessRate.add(false);
      errors.add(1);
    }

    // Step 3: Get mission status
    const statusResp = http.get(`${API_URL}/missions/${missionId}`, {
      timeout: '3s',
      tags: { name: 'mission-status' },
    });

    check(statusResp, {
      'Mission status retrieved': (r) => r.status === 200,
    });
  });
}

// ═══════════════════════════════════════════════════════════
// Scenario 2: EventBus Publish Stress (25%)
// ═══════════════════════════════════════════════════════════

function testEventBusPublish() {
  const eventTypes = [
    'mission.created',
    'mission.updated',
    'agent.assigned',
    'execution.started',
    'execution.completed',
    'agent.status_changed',
    'memory.stored',
    'knowledge.updated',
    'artifact.created',
    'learning.experience_extracted',
  ];

  const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];

  group('EventBus Publish', function () {
    const payload = JSON.stringify({
      type: eventType,
      timestamp: Date.now(),
      source: 'k6-load-test',
      payload: {
        testId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        value: Math.random(),
        iteration: __ITER,
      },
    });

    const resp = http.post(`${API_URL}/events`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: '3s',
      tags: { name: 'event-publish' },
    });

    const success = check(resp, {
      'Event published (2xx)': (r) => r.status >= 200 && r.status < 300,
    });

    if (success) {
      eventPublishRate.add(true);
      eventLatency.add(resp.timings.duration);
    } else {
      eventPublishRate.add(false);
      errors.add(1);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// Scenario 3: Pipeline Execution (20%)
// ═══════════════════════════════════════════════════════════

function testPipelineExecution() {
  group('Pipeline Execution', function () {
    const payload = JSON.stringify({
      mission: `Pipeline test — ${Date.now()}`,
      context: {
        maxSteps: 3,
        strategy: 'sequential',
        riskTolerance: 0.3,
      },
      stages: ['planning', 'execution', 'verification'],
    });

    const resp = http.post(`${API_URL}/pipeline/execute`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: '15s',
      tags: { name: 'pipeline-execute' },
    });

    check(resp, {
      'Pipeline executed (2xx)': (r) => r.status >= 200 && r.status < 300,
    });

    pipelineDuration.add(resp.timings.duration);

    if (resp.status >= 400) {
      errors.add(1);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// Scenario 4: Health Check Baseline (15%)
// ═══════════════════════════════════════════════════════════

function testHealthCheck() {
  group('Health Check', function () {
    const resp = http.get(`${BASE_URL}/health`, {
      timeout: '3s',
      tags: { name: 'health-check' },
    });

    check(resp, {
      'Health check OK': (r) => r.status === 200,
    });

    // Also check API health
    const apiHealth = http.get(`${API_URL}/health`, {
      timeout: '3s',
      tags: { name: 'api-health' },
    });

    check(apiHealth, {
      'API health OK': (r) => r.status === 200,
    });
  });
}

// ═══════════════════════════════════════════════════════════
// Scenario 5: Mixed Read Queries (10%)
// ═══════════════════════════════════════════════════════════

function testReadQueries() {
  const queries = [
    { method: 'GET', path: '/agents', name: 'list-agents' },
    { method: 'GET', path: '/missions', name: 'list-missions' },
    { method: 'GET', path: '/memory/stats', name: 'memory-stats' },
    { method: 'GET', path: '/knowledge/graph', name: 'knowledge-graph' },
    { method: 'GET', path: '/artifacts', name: 'list-artifacts' },
  ];

  const query = queries[Math.floor(Math.random() * queries.length)];

  group('Read Queries', function () {
    const resp = http.get(`${API_URL}${query.path}`, {
      timeout: '5s',
      tags: { name: query.name },
    });

    check(resp, {
      [`Query ${query.name} OK`]: (r) => r.status === 200 || r.status === 404,
    });
  });
}

// ═══════════════════════════════════════════════════════════
// Utility: Generate random payloads for testing
// ═══════════════════════════════════════════════════════════

export function generateRandomMission() {
  const goals = [
    'Analyze market data for Q3 trends',
    'Generate weekly progress report',
    'Optimize database query performance',
    'Review and merge pending PRs',
    'Schedule team sync meeting',
    'Validate security compliance',
    'Extract key insights from logs',
    'Create deployment checklist',
  ];

  return {
    goal: goals[Math.floor(Math.random() * goals.length)],
    priority: Math.random() > 0.7 ? 'high' : 'normal',
    context: {
      urgency: Math.random(),
      complexity: Math.random(),
    },
  };
}
