#!/usr/bin/env tsx
/**
 * migrate.ts — SQLite Schema Migration CLI
 *
 * 用法:
 *   npx tsx scripts/migrate.ts                    # 使用默认 DB 路径
 *   npx tsx scripts/migrate.ts --db ./custom.db   # 指定 DB 路径
 *   npx tsx scripts/migrate.ts --dry-run          # 仅预览
 *
 * 环境变量:
 *   MORPEX_DB_PATH    — SQLite 数据库路径（默认 ./data/morpex-events.db）
 */

import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ── 默认迁移列表 ──
// 新迁移追加到数组末尾，version 必须单调递增
const MIGRATIONS = [
  {
    version: 1,
    description: 'v9.2 Stage 0: Core events + agent tables',
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, type TEXT NOT NULL,
        timestamp INTEGER NOT NULL, execution_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}',
        aggregate_id TEXT, version INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_events_sequence ON events(sequence);
      CREATE INDEX IF NOT EXISTS idx_events_execution ON events(execution_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

      CREATE TABLE IF NOT EXISTS events_decision (
        id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, timestamp INTEGER NOT NULL,
        execution_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',
        input TEXT NOT NULL DEFAULT '{}', reasoning TEXT NOT NULL DEFAULT '',
        evidence TEXT NOT NULL DEFAULT '[]', decision TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0, twin_version INTEGER NOT NULL DEFAULT 0,
        metadata TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
        description TEXT
      );
    `,
  },
  {
    version: 2,
    description: 'v9.2 Stage 1: Context + Artifact + Agent governance',
    sql: `
      CREATE TABLE IF NOT EXISTS context_snapshots (
        context_id TEXT NOT NULL, version INTEGER NOT NULL, mission_id TEXT NOT NULL,
        schema_version TEXT NOT NULL DEFAULT '1.0', base_data TEXT NOT NULL DEFAULT '{}',
        session_data TEXT NOT NULL DEFAULT '{}', ephemeral_data TEXT NOT NULL DEFAULT '{}',
        fragments_json TEXT NOT NULL DEFAULT '[]', change_description TEXT,
        assembled_at INTEGER NOT NULL, PRIMARY KEY (context_id, version)
      );

      CREATE TABLE IF NOT EXISTS artifacts_v2 (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1,
        content TEXT, content_hash TEXT, created_by TEXT, source TEXT,
        metadata_json TEXT DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifact_versions_v2 (
        id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, version INTEGER NOT NULL,
        content TEXT, content_hash TEXT, change_log TEXT, staged_by TEXT,
        verified_at INTEGER, committed_at INTEGER, created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifact_staging_v2 (
        stage_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, new_content TEXT,
        new_content_hash TEXT, staged_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'staged',
        staged_at INTEGER NOT NULL, expires_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS agent_capabilities (
        agent_id TEXT NOT NULL, capability_name TEXT NOT NULL,
        level INTEGER DEFAULT 3, success_rate REAL DEFAULT 1.0, cost REAL DEFAULT 0.5,
        last_used_at INTEGER, PRIMARY KEY (agent_id, capability_name)
      );

      CREATE TABLE IF NOT EXISTS agent_governance_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL, decision TEXT, reason TEXT,
        details_json TEXT DEFAULT '{}', recorded_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_collaborations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL,
        collaborator_id TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'unknown',
        mission_id TEXT, duration_ms INTEGER, recorded_at INTEGER NOT NULL
      );

      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
    `,
  },
  {
    version: 3,
    description: 'v9.2 Stage 2: Learning + Governance + Marketplace + Distributed + Teams + Shared Memory',
    sql: `
      CREATE TABLE IF NOT EXISTS shared_experiences (
        id TEXT PRIMARY KEY, category TEXT NOT NULL, problem_pattern TEXT NOT NULL,
        solution TEXT NOT NULL, success_rate REAL DEFAULT 0, avg_latency REAL DEFAULT 0,
        cost_savings REAL DEFAULT 0, source_agent_type TEXT, source_mission_ids TEXT,
        positive_feedback INTEGER DEFAULT 0, negative_feedback INTEGER DEFAULT 0,
        weight REAL DEFAULT 0, tags TEXT, visible_to TEXT, created_at INTEGER NOT NULL,
        last_validated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS org_policies (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, priority INTEGER DEFAULT 0,
        action TEXT NOT NULL, rule_condition TEXT, override_by TEXT,
        enabled INTEGER DEFAULT 1, created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS team_governance (
        team_id TEXT PRIMARY KEY, team_name TEXT NOT NULL, member_roles TEXT,
        max_concurrent_collabs INTEGER DEFAULT 5, budget_allocation REAL DEFAULT 0,
        allow_external INTEGER DEFAULT 0, require_approval INTEGER DEFAULT 0,
        escalation_path TEXT, created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS marketplace_listings (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, capability TEXT NOT NULL,
        price_per_task REAL DEFAULT 0, availability INTEGER DEFAULT 1,
        reputation REAL DEFAULT 0, total_tasks INTEGER DEFAULT 0, success_rate REAL DEFAULT 1,
        metadata_json TEXT DEFAULT '{}', listed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS marketplace_contracts (
        id TEXT PRIMARY KEY, bid_id TEXT, provider_id TEXT NOT NULL,
        consumer_id TEXT NOT NULL, capability TEXT NOT NULL, price REAL NOT NULL,
        status TEXT DEFAULT 'active', terms_json TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL, completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS agent_instances (
        node_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT DEFAULT 'online',
        last_heartbeat INTEGER NOT NULL, address TEXT, capabilities_json TEXT DEFAULT '[]',
        load REAL DEFAULT 0, PRIMARY KEY (node_id, agent_id)
      );

      CREATE TABLE IF NOT EXISTS remote_messages (
        id TEXT PRIMARY KEY, from_node TEXT NOT NULL, to_node TEXT NOT NULL,
        correlation_id TEXT, type TEXT NOT NULL, payload TEXT DEFAULT '{}',
        status TEXT DEFAULT 'sent', sent_at INTEGER NOT NULL, received_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS agent_teams (
        team_id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, status TEXT DEFAULT 'forming',
        leader_id TEXT, composition_json TEXT DEFAULT '{}', context_json TEXT DEFAULT '{}',
        formed_at INTEGER NOT NULL, dissolved_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS shared_memory_entries (
        "key" TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER DEFAULT 1,
        lock_owner TEXT, lock_expires_at INTEGER, consensus_version INTEGER DEFAULT 1,
        created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
    `,
  },
];

// ── CLI ──

function parseArgs(): { dbPath: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let dbPath = process.env.MORPEX_DB_PATH || './data/morpex-events.db';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      dbPath = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { dbPath, dryRun };
}

async function main() {
  const { dbPath, dryRun } = parseArgs();
  const resolvedPath = path.resolve(dbPath);

  console.log(`🔧 Migration CLI`);
  console.log(`   DB: ${resolvedPath}`);
  console.log(`   Dry-run: ${dryRun}`);
  console.log('');

  if (!fs.existsSync(path.dirname(resolvedPath))) {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');

  if (dryRun) {
    console.log('📋 Pending migrations:');
    const current = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number | null };
    const currentVersion = current?.v ?? 0;
    for (const m of MIGRATIONS) {
      if (m.version > currentVersion) {
        console.log(`   [v${m.version}] ${m.description}`);
      }
    }
    console.log('\n✅ Dry-run complete. Use without --dry-run to apply.');
    db.close();
    return;
  }

  const { MigrationRunner } = await import('../packages/core/src/protocol/events/store/MigrationRunner.js');
  const runner = new MigrationRunner(db);
  const applied = runner.run(MIGRATIONS);

  if (applied > 0) {
    console.log(`✅ Applied ${applied} migration(s):`);
    const history = runner.getHistory();
    for (const h of history.slice(-applied)) {
      console.log(`   [v${h.version}] ${h.description}`);
    }
  } else {
    console.log('✅ Schema is up to date (no migrations needed).');
  }

  db.close();
}

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
