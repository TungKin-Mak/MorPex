/**
 * MorPex k6 Smoke Test — 针对 StudioServer 真实端点（:8080 /api/*）
 *
 * 轻量只读冒烟：验证后端在并发下可稳定响应核心只读端点。
 * 不触碰 /api/execute（避免负载测试触发 LLM/执行链）。
 *
 * 用法:
 *   k6 run --vus 5 --duration 30s scripts/k6-smoke.js
 *   bash scripts/run-k6-test.sh --smoke
 *
 * 目标:
 *   - P95 < 500ms（只读端点）
 *   - 错误率 < 0.5%
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const API_URL = __ENV.API_URL || BASE_URL;

const errorRate = new Rate('smoke_error_rate');

export const options = {
  vus: __ENV.SMOKE_VUS ? parseInt(__ENV.SMOKE_VUS, 10) : 5,
  duration: __ENV.SMOKE_DURATION || '30s',
  thresholds: {
    'http_req_duration{name:health}': ['p(95)<500'],
    'http_req_duration{name:status}': ['p(95)<500'],
    'http_req_duration{name:artifacts}': ['p(95)<500'],
    http_req_failed: ['rate<0.005'],
  },
  discardResponseBodies: false,
};

export function setup() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  MorPex k6 Smoke — StudioServer (:8080)      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  BASE_URL: ${BASE_URL}`);
  console.log(`  VUs: ${options.vus} / Duration: ${options.duration}`);
  // 预检：后端必须在线
  const pre = http.get(`${BASE_URL}/api/health`, { tags: { name: 'health' } });
  if (pre.status !== 200) {
    throw new Error(`后端未就绪: ${BASE_URL}/api/health → ${pre.status}. 请先启动: npx tsx scripts/start.ts`);
  }
  console.log('  ✅ 后端在线，开始负载…');
}

export default function () {
  group('read endpoints', () => {
    const health = http.get(`${BASE_URL}/api/health`, { tags: { name: 'health' } });
    check(health, { 'health 200': (r) => r.status === 200 && r.json().ok === true }) || errorRate.add(1);

    const status = http.get(`${BASE_URL}/api/status`, { tags: { name: 'status' } });
    check(status, { 'status 200': (r) => r.status === 200 }) || errorRate.add(1);

    const artifacts = http.get(`${API_URL}/api/artifacts`, { tags: { name: 'artifacts' } });
    check(artifacts, { 'artifacts 200': (r) => r.status === 200 && Array.isArray(r.json().artifacts) }) || errorRate.add(1);

    sleep(0.1);
  });
}
