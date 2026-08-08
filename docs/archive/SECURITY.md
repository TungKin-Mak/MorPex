# MorPex v9.2 Security Guide

## Encryption

Sensitive fields in the database (e.g., API keys, user credentials) can be encrypted using `EncryptionService`:

```typescript
import { EncryptionService } from './common/EncryptionService.js'

// Initialize with 32-byte hex key from environment
const crypto = new EncryptionService(process.env.MORPEX_ENCRYPTION_KEY)

// Encrypt before storing
const encrypted = crypto.encrypt(sensitiveData)

// Decrypt on read
const plaintext = crypto.decrypt(encrypted)
```

### Key Management

- Generate key: `openssl rand -hex 32`
- Store in environment variable `MORPEX_ENCRYPTION_KEY`
- Never commit to version control
- Rotate keys by re-encrypting data with the new key

## Sandbox Isolation

Third-party Agent execution uses restricted sandbox contexts:

| Profile | Network | Filesystem | Timeout | CPU | Memory |
|---------|---------|------------|---------|-----|--------|
| Third-party | disabled | readonly | 60s | 0.5 core | 256MB |
| Coding | disabled | isolated | 300s | 2 cores | 2GB |
| Finance | disabled | readonly | 120s | 1 core | 512MB |
| Deployment | enabled | isolated | 600s | 1 core | 1GB |

Each Agent's actions are tracked via `SandboxManager.registerAgentBehavior()`. Agents with risk scores > 0.7 are flagged for review.

## Access Control

### Permission Levels

| Permission | Agent | User | Description |
|------------|-------|------|-------------|
| `read` | ✓ | ✓ | View artifacts, missions, context |
| `write` | ✓ | ✓ | Create/update artifacts |
| `execute` | ✓ | ✓ | Run missions, tasks |
| `delete` | ✗ | ✓ | Remove artifacts |
| `agent_collaborate` | ✓ | — | Initiate cross-agent collaboration |
| `agent_access_shared_memory` | ✓ | — | Read/write shared memory |
| `agent_evolve` | ✓ | — | Allow capability evolution |
| `admin` | ✗ | ✓ | All operations |

### Team-Level Access

```typescript
permissionModel.canAccessSharedMemory(agentId, teamId, sharedKey)
// Returns PermissionCheck with allowed: true/false
```

Agents must be team members to access team shared memory. Cross-team collaboration requires `agent_collaborate` permission and Organization Policy approval.

## Trust Verification

TrustVerifier evaluates Agent trustworthiness using two dimensions:

1. **Static trust** (60% weight): successRate, totalTasks, recency, availability
2. **Behavior baseline** (40% weight): historical action risk scores, weighted toward recent

External (third-party) agents start with trust score 0.3 and are auto-rejected if behavior baseline falls below 0.3.

## Audit Trail

All governance decisions are recorded in the `agent_governance_log` table:

| Event Type | Trigger | Example |
|------------|---------|---------|
| `lifecycle_transition` | Agent status change | ACTIVE→SUSPENDED |
| `risk_assessment` | Mission risk analysis | score=75, level=high |
| `policy_check` | Organization policy evaluation | allow/deny/escalate |
| `trust_update` | Agent trust level change | 0.5→0.7 after successful tasks |

## Network Security

- All internal gRPC/WebSocket communication uses the configured transport (default: in-memory)
- In distributed mode, consider:
  - TLS encryption for gRPC
  - Authentication tokens between nodes
  - Firewall rules limiting node communication to trusted IPs

## Recommended Production Checklist

- [ ] Set `MORPEX_ENCRYPTION_KEY` (32-byte hex)
- [ ] Enable `MORPEX_DISTRIBUTED_ENABLED=false` unless multi-node
- [ ] Enable `MORPEX_MARKETPLACE_ENABLED=false` unless needed
- [ ] Review `OrganizationPolicyEngine` rules for cross-team collaboration
- [ ] Set `compaction.autoRunIntervalMs` in config for database maintenance
- [ ] Run `npm run depcheck` to verify dependency boundaries
- [ ] Review `.env` file permissions (chmod 600)
