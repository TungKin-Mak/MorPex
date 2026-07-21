# MorPex v9.2 Monitoring Guide

## Metrics Endpoint

The Prometheus-formatted metrics endpoint aggregates all system and business metrics:

```
GET /metrics → Prometheus text format
GET /health  → JSON health status
GET /metrics/v9 → JSON v9.2 metrics
```

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `process_uptime_seconds` | gauge | Time since process start |
| `process_memory_heap_used` | gauge | Heap memory usage (bytes) |
| `process_cpu_percent` | gauge | Approximate CPU usage |
| `team_formation.duration` | gauge | Most recent team formation latency (ms) |
| `team_formation.count` | gauge | Total team formations |
| `shared_memory.conflict` | gauge | Shared memory conflict count |
| `marketplace.bid` | gauge | Marketplace bid outcome (1=won, 0=lost) |
| `distributed.message.latency` | gauge | Cross-node message latency (ms) |
| `distributed.message.count` | gauge | Total distributed messages |
| `resilience.circuit_breaker_trip` | gauge | Circuit breaker trip count |

### Prometheus Configuration

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'morpex'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:8080']
```

## Health Check Endpoint

`GET /health` returns:

```json
{
  "status": "healthy",
  "checks": {
    "sqlite_ping": { "status": "ok", "latencyMs": 1 },
    "event_store": { "status": "ok", "detail": "sequence=12345", "latencyMs": 2 }
  },
  "version": "9.2.0",
  "uptimeMs": 3600000,
  "timestamp": 1704067200000
}
```

Status levels:
- `healthy` — all checks pass
- `degraded` — non-critical checks failing (timeout, warning)
- `unhealthy` — critical checks failing

## Alerting Recommendations

| Condition | Severity | Action |
|-----------|----------|--------|
| Circuit breaker OPEN > 5 min | warning | Check downstream service health |
| Memory > 500MB | warning | Consider compaction: `GET /admin/compact` |
| Event count > 100k without compaction | info | Auto-compaction should trigger |
| Marketplace bid win rate < 20% | info | Review agent pricing/capabilities |
| Distributed message latency > 1s | warning | Check network between nodes |
| Health check degraded > 10 min | critical | Page on-call |

## Logs

Logs are written to stdout/stderr. In PM2:

```bash
pm2 logs                 # tail all logs
pm2 logs morpex-core     # filter by process name
pm2 flush                # clear all logs
```

In Docker:

```bash
docker logs morpex-node1
docker compose logs -f
```
