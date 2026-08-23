/**
 * storage/MemoryWeightStore — T7 记忆权重与沉淀体系
 *
 * 职责：给每条长期记忆实体维护 { tier, weight, mentionCount, lastSeen }，
 *       支撑「30 天内多次提及 → 沉淀永久记忆；久未提及 → 衰减归档」的生命周期。
 *
 * 存储：独立 SQLite（data/sessions/memory-weights.db），只存元数据不存事实正文
 *       （正文真相源在 cognee 图 / transcript jsonl——铁律 5 真相源优先）。
 *       better-sqlite3 同步 API，单进程访问（与 ConfirmationQueue 同款模式）。
 *
 * 纯函数 computePromotion/computeDecay 导出供单测与 memory-consolidate 脚本复用。
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type MemoryTier = 'project' | 'permanent';

export interface MemoryWeightRow {
  name: string;
  tier: MemoryTier;
  weight: number;
  mentionCount: number;
  /** 最近一次被召回/提及的 epoch ms */
  lastSeen: number;
  source: string;
}

/** 晋升阈值：30 天窗口内提及 ≥3 次或 weight 达标 → permanent（免疫衰减） */
export const PROMOTE_MENTION_COUNT = 3;
export const PROMOTE_WEIGHT = 0.95;
/** 晋升考察窗（毫秒） */
export const PROMOTE_WINDOW_MS = 30 * 24 * 3600_000;
/** 衰减周期：非永久层超过该时长未被提及 → weight 减半 */
export const DECAY_IDLE_MS = 30 * 24 * 3600_000;
/** 低于此权重的非永久条目归档（从表中删除；事实正文仍留在图内由既有 invalidate 语义管理） */
export const ARCHIVE_WEIGHT = 0.2;

/**
 * 晋升判定（纯函数）：project 层 + 近 30 天提及达标/权重达标 → permanent
 */
export function computePromotion(
  row: Pick<MemoryWeightRow, 'tier' | 'weight' | 'mentionCount' | 'lastSeen'>,
  now = Date.now(),
): boolean {
  if (row.tier === 'permanent') return false;
  if (now - row.lastSeen > PROMOTE_WINDOW_MS) return false; // 窗口外的老提及不算数
  return row.mentionCount >= PROMOTE_MENTION_COUNT || row.weight >= PROMOTE_WEIGHT;
}

/**
 * 衰减判定（纯函数）：返回新 weight 或 null=归档。permanent 永不衰减。
 * 非 permanent 且闲置超期 → 权重减半；低于 ARCHIVE_WEIGHT → 归档。
 */
export function computeDecay(
  row: Pick<MemoryWeightRow, 'tier' | 'weight' | 'lastSeen'>,
  now = Date.now(),
): { weight: number; archived: boolean } | null {
  if (row.tier === 'permanent') return null; // 免疫衰减
  if (now - row.lastSeen <= DECAY_IDLE_MS) return null; // 未到期，不动
  const halved = Math.max(0.05, row.weight / 2);
  return { weight: halved, archived: halved < ARCHIVE_WEIGHT };
}

/** 来源 → 基础权重（写入时定档）：显式指令 ＞ 用户纠正/澄清 ＞ LLM 提取 */
export function baseWeightFor(source: string, kind?: string): number {
  if (source === 'explicit') return 1.0;
  if (kind === 'correction' || kind === 'clarification') return 0.8;
  return 0.6;
}

export class MemoryWeightStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_weights (
        name          TEXT PRIMARY KEY,
        tier          TEXT NOT NULL DEFAULT 'project' CHECK (tier IN ('project','permanent')),
        weight        REAL NOT NULL DEFAULT 0.6,
        mention_count INTEGER NOT NULL DEFAULT 0,
        last_seen     INTEGER NOT NULL,
        source        TEXT NOT NULL DEFAULT 'llm',
        updated_at    INTEGER NOT NULL
      ) STRICT;
    `);
  }

  /** 写入侧登记：不存在则以基础分建档（幂等——已存在不重置权重） */
  ensure(name: string, source: string, kind?: string): void {
    this.db
      .prepare(
        `INSERT INTO memory_weights (name, tier, weight, mention_count, last_seen, source, updated_at)
         VALUES (?, 'project', ?, 0, ?, ?, ?)
         ON CONFLICT(name) DO NOTHING`,
      )
      .run(name, baseWeightFor(source, kind), Date.now(), source, Date.now());
  }

  /** 召回命中即计一次提及（mention_count++ / last_seen 刷新） */
  recordMention(name: string): void {
    this.db
      .prepare(
        `UPDATE memory_weights
         SET mention_count = mention_count + 1, last_seen = ?, updated_at = ?
         WHERE name = ?`,
      )
      .run(Date.now(), Date.now(), name);
  }

  /**
   * 批量按召回内容计提及：实体名出现在任一 hit 文本中即算命中。
   * （hit 是自由文本不含结构化实体名，子串包含是最简可靠对齐方式；
   *   这是记账簿记而非触发机制，不受"禁匹配"原则约束）
   */
  recordMentionsFromContents(contents: string[]): number {
    const rows = this.db.prepare('SELECT name FROM memory_weights').all() as Array<{ name: string }>;
    let n = 0;
    for (const { name } of rows) {
      if (contents.some((c) => c.includes(name))) {
        this.recordMention(name);
        n += 1;
      }
    }
    return n;
  }

  getByName(name: string): MemoryWeightRow | undefined {
    const r = this.db.prepare('SELECT * FROM memory_weights WHERE name = ?').get(name) as
      | Record<string, unknown>
      | undefined;
    return r ? this.toRow(r) : undefined;
  }

  listAll(): MemoryWeightRow[] {
    return (this.db.prepare('SELECT * FROM memory_weights').all() as Array<Record<string, unknown>>).map(
      (r) => this.toRow(r),
    );
  }

  /** 应用晋升（consolidate 脚本调用） */
  applyPromotions(now = Date.now()): string[] {
    const promoted: string[] = [];
    for (const row of this.listAll()) {
      if (computePromotion(row, now)) {
        this.db
          .prepare(`UPDATE memory_weights SET tier='permanent', updated_at=? WHERE name=?`)
          .run(now, row.name);
        promoted.push(row.name);
      }
    }
    return promoted;
  }

  /** 应用衰减（consolidate 脚本调用）。返回 { decayed, archived } 名单 */
  applyDecays(now = Date.now()): { decayed: string[]; archived: string[] } {
    const decayed: string[] = [];
    const archived: string[] = [];
    for (const row of this.listAll()) {
      const r = computeDecay(row, now);
      if (!r) continue;
      if (r.archived) {
        this.db.prepare('DELETE FROM memory_weights WHERE name = ?').run(row.name);
        archived.push(row.name);
      } else {
        this.db
          .prepare('UPDATE memory_weights SET weight=?, updated_at=? WHERE name=?')
          .run(r.weight, now, row.name);
        decayed.push(row.name);
      }
    }
    return { decayed, archived };
  }

  close(): void {
    this.db.close();
  }

  private toRow(r: Record<string, unknown>): MemoryWeightRow {
    return {
      name: String(r.name),
      tier: r.tier as MemoryTier,
      weight: Number(r.weight),
      mentionCount: Number(r.mention_count),
      lastSeen: Number(r.last_seen),
      source: String(r.source),
    };
  }
}
