/**
 * schema.ts — MemoryWiki SQLite Schema
 *
 * 按领域分表设计，替代 31 个 JSONL 文件。
 * 每张表对应一个现有记忆功能模块。
 */

// ═══════════════════════════════════════════════════════════════
// DDL
// ═══════════════════════════════════════════════════════════════

export const MEMORY_WIKI_SCHEMA = `
  -- ═══ Layer 2: 情节记忆 (Episodic) ═══

  -- PlanExperienceStore.records → 计划执行记录
  CREATE TABLE IF NOT EXISTS plan_records (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    task_id TEXT,
    round INTEGER,
    user_input TEXT,
    input_tags TEXT,
    s3_method TEXT CHECK(s3_method IN ('hierarchical', 'llm', 'fallback')),
    s3_tokens_used INTEGER DEFAULT 0,
    s3_candidates INTEGER DEFAULT 0,
    s4_survival_probability REAL DEFAULT 0,
    s4_topology_explored INTEGER DEFAULT 0,
    s5_winner TEXT CHECK(s5_winner IN ('aggressive', 'defensive', 'fallback')),
    s5_winner_score REAL DEFAULT 0,
    s5_risk_appetite TEXT,
    execution_success INTEGER DEFAULT 1,
    duration_ms INTEGER DEFAULT 0,
    total_tokens_used INTEGER DEFAULT 0,
    artifact_count INTEGER DEFAULT 0,
    artifact_uris TEXT,
    plan_score REAL DEFAULT 0,
    deviations_triggered INTEGER DEFAULT 0,
    replan_triggered INTEGER DEFAULT 0,
    errors_json TEXT,
    events_json TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_pr_task ON plan_records(task_id, round);
  CREATE INDEX IF NOT EXISTS idx_pr_tags ON plan_records(input_tags);
  CREATE INDEX IF NOT EXISTS idx_pr_method ON plan_records(s3_method);
  CREATE INDEX IF NOT EXISTS idx_pr_score ON plan_records(plan_score);

  -- PlanExperienceStore.templates → 计划模板
  CREATE TABLE IF NOT EXISTS plan_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    success_rate REAL DEFAULT 0,
    avg_duration_ms INTEGER DEFAULT 0,
    avg_tokens_used INTEGER DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    source_execution_ids TEXT,
    version INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_pt_tags ON plan_templates(tags);

  -- TemplateManager.lineages → 模板血统
  CREATE TABLE IF NOT EXISTS template_lineages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id TEXT NOT NULL,
    parent_template_id TEXT,
    evolution_type TEXT CHECK(evolution_type IN ('CAPTURED', 'DERIVED', 'FIXED')),
    evolution_reason TEXT,
    timestamp INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_tl_template ON template_lineages(template_id);

  -- HistoryStore → 历史记录
  CREATE TABLE IF NOT EXISTS history_records (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('cycle', 'task', 'execution')),
    execution_id TEXT,
    task_id TEXT,
    round INTEGER,
    data_json TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_hr_exec ON history_records(execution_id);
  CREATE INDEX IF NOT EXISTS idx_hr_type ON history_records(type);

  -- ═══ Layer 3: 程序记忆 (Procedural) ═══

  -- ToolQualityManager → 工具质量记录
  CREATE TABLE IF NOT EXISTS tool_quality (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    call_success INTEGER DEFAULT 1,
    latency_ms INTEGER DEFAULT 0,
    error_message TEXT,
    degradation_alert INTEGER DEFAULT 0,
    timestamp INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_tq_tool ON tool_quality(tool_name);
  CREATE INDEX IF NOT EXISTS idx_tq_time ON tool_quality(timestamp);

  -- PlanningIntelligenceEngine → 学习状态
  CREATE TABLE IF NOT EXISTS intelligence_state (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    execution_count INTEGER DEFAULT 0,
    score_history TEXT,
    weights_json TEXT,
    last_weight_tuning_at INTEGER,
    last_template_evolution_at INTEGER,
    updated_at INTEGER DEFAULT (unixepoch())
  );

  -- ═══ Layer 4: 工作记忆 (Working) ═══

  -- CheckpointManager → DAG 检查点
  CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    dag_snapshot TEXT NOT NULL,
    node_states TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_cp_exec ON checkpoints(execution_id);

  -- ═══ Layer 5: 元记忆 (Meta) ═══

  -- SessionErrorExtractor → 错误日志
  CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    execution_id TEXT,
    node_id TEXT,
    error_type TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    healing_attempted INTEGER DEFAULT 0,
    healing_succeeded INTEGER DEFAULT 0,
    timestamp INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_el_type ON error_logs(error_type);
  CREATE INDEX IF NOT EXISTS idx_el_time ON error_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_el_session ON error_logs(session_id);

  -- 错误报告
  CREATE TABLE IF NOT EXISTS error_reports (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    total_errors INTEGER DEFAULT 0,
    categories_json TEXT,
    root_cause TEXT,
    suggestions_json TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  -- PipelineExecutor S6 → 决策追溯
  CREATE TABLE IF NOT EXISTS decision_traces (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    winner_strategy TEXT,
    winner_score REAL,
    eliminated_candidates TEXT,
    selection_reason TEXT,
    risk_appetite TEXT,
    timestamp INTEGER DEFAULT (unixepoch())
  );

  -- DeviationGuard → 偏差记录
  CREATE TABLE IF NOT EXISTS deviation_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    execution_id TEXT,
    deviation_type TEXT,
    count INTEGER DEFAULT 1,
    circuit_broken INTEGER DEFAULT 0,
    timestamp INTEGER DEFAULT (unixepoch())
  );

  -- ═══ 通用: 知识图谱 ═══

  CREATE TABLE IF NOT EXISTS kg_entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    domain TEXT,
    tags TEXT,
    data_json TEXT,
    importance REAL DEFAULT 0.5,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_kg_type ON kg_entities(type);
  CREATE INDEX IF NOT EXISTS idx_kg_domain ON kg_entities(domain);

  CREATE TABLE IF NOT EXISTS kg_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    type TEXT NOT NULL,
    properties_json TEXT,
    strength REAL DEFAULT 1.0,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_kg_rel_from ON kg_relations(from_id);
  CREATE INDEX IF NOT EXISTS idx_kg_rel_to ON kg_relations(to_id);

  -- ═══ 通用: MemoryBus 记忆条目 ═══

  CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY,
    mem_type TEXT NOT NULL,
    content TEXT,
    source TEXT,
    source_id TEXT,
    tags TEXT,
    importance INTEGER DEFAULT 3,
    score REAL DEFAULT 0,
    pool TEXT DEFAULT 'main' CHECK(pool IN ('main', 'archive', 'temp')),
    created_at INTEGER DEFAULT (unixepoch()),
    last_accessed_at INTEGER DEFAULT (unixepoch()),
    access_count INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_me_type ON memory_entries(mem_type);
  CREATE INDEX IF NOT EXISTS idx_me_pool ON memory_entries(pool);

  -- ═══ 通用: 事件日志 ═══

  CREATE TABLE IF NOT EXISTS event_log (
    id TEXT PRIMARY KEY,
    entity_id TEXT,
    event_type TEXT NOT NULL,
    data_json TEXT,
    timestamp INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_ev_entity ON event_log(entity_id);
  CREATE INDEX IF NOT EXISTS idx_ev_time ON event_log(timestamp);

  -- ═══ 性能优化 ═══
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;
  PRAGMA cache_size=-64000;
  PRAGMA busy_timeout=5000;
  PRAGMA foreign_keys=ON;
`;

// ═══════════════════════════════════════════════════════════════
// 表名常量（供 migrate / MemoryWiki 使用）
// ═══════════════════════════════════════════════════════════════

export const TABLES = {
  PLAN_RECORDS: 'plan_records',
  PLAN_TEMPLATES: 'plan_templates',
  TEMPLATE_LINEAGES: 'template_lineages',
  HISTORY_RECORDS: 'history_records',
  TOOL_QUALITY: 'tool_quality',
  INTELLIGENCE_STATE: 'intelligence_state',
  CHECKPOINTS: 'checkpoints',
  ERROR_LOGS: 'error_logs',
  ERROR_REPORTS: 'error_reports',
  DECISION_TRACES: 'decision_traces',
  DEVIATION_LOGS: 'deviation_logs',
  KG_ENTITIES: 'kg_entities',
  KG_RELATIONS: 'kg_relations',
  MEMORY_ENTRIES: 'memory_entries',
  EVENT_LOG: 'event_log',
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];
