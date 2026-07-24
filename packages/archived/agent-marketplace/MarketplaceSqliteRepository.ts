/**
 * MarketplaceSqliteRepository — Agent 市场 SQLite 持久化
 *
 * v9.2 Stage 2: 列表、投标、合约的持久化。
 */
import type Database from 'better-sqlite3';

export class MarketplaceSqliteRepository {
  constructor(private db: Database.Database) {}

  // ── Listings ──
  saveListing(l: any): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO marketplace_listings (id, agent_id, capability, price_per_task,
        availability, reputation, total_tasks, success_rate, metadata_json, listed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(l.id, l.agentId, l.capability, l.pricePerTask ?? 0, l.availability ?? 1,
      l.reputation ?? 0, l.totalTasks ?? 0, l.successRate ?? 1,
      JSON.stringify(l.metadata ?? {}), l.listedAt ?? Date.now());
  }
  getListing(id: string): any | undefined {
    const row = this.db.prepare('SELECT * FROM marketplace_listings WHERE id = ?').get(id) as any;
    return row ? { ...row, metadata: JSON.parse(row.metadata_json || '{}') } : undefined;
  }
  searchListings(capability?: string, minReputation?: number): any[] {
    let sql = 'SELECT * FROM marketplace_listings WHERE availability = 1';
    const params: any[] = [];
    if (capability) { sql += ' AND capability LIKE ?'; params.push(`%${capability}%`); }
    if (minReputation) { sql += ' AND reputation >= ?'; params.push(minReputation); }
    sql += ' ORDER BY reputation DESC';
    return (this.db.prepare(sql).all(...params) as any[]).map(r => ({ ...r, metadata: JSON.parse(r.metadata_json || '{}') }));
  }
  updateAvailability(id: string, available: boolean): void {
    this.db.prepare('UPDATE marketplace_listings SET availability = ? WHERE id = ?').run(available ? 1 : 0, id);
  }

  // ── Bids ──
  placeBid(b: any): void {
    this.db.prepare(`
      INSERT INTO marketplace_bids (id, listing_id, bidder_id, price, estimated_duration, confidence, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(b.id, b.listingId, b.bidderId, b.price, b.estimatedDuration ?? null, b.confidence ?? 0.5, b.createdAt ?? Date.now());
  }
  getBids(listingId: string): any[] {
    return this.db.prepare('SELECT * FROM marketplace_bids WHERE listing_id = ? ORDER BY price ASC').all(listingId);
  }
  awardBid(bidId: string): void {
    this.db.prepare("UPDATE marketplace_bids SET status = 'awarded', awarded_at = ? WHERE id = ?").run(Date.now(), bidId);
  }
  rejectOtherBids(listingId: string, awardedBidId: string): void {
    this.db.prepare("UPDATE marketplace_bids SET status = 'rejected' WHERE listing_id = ? AND id != ? AND status = 'pending'").run(listingId, awardedBidId);
  }

  // ── Contracts ──
  createContract(c: any): void {
    this.db.prepare(`
      INSERT INTO marketplace_contracts (id, bid_id, provider_id, consumer_id, capability, price, status, terms_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(c.id, c.bidId ?? null, c.providerId, c.consumerId, c.capability, c.price, JSON.stringify(c.terms ?? {}), c.createdAt ?? Date.now());
  }
  getContract(id: string): any | undefined {
    const row = this.db.prepare('SELECT * FROM marketplace_contracts WHERE id = ?').get(id) as any;
    return row ? { ...row, terms: JSON.parse(row.terms_json || '{}') } : undefined;
  }
  updateContractStatus(id: string, status: string): void {
    this.db.prepare('UPDATE marketplace_contracts SET status = ?, completed_at = CASE WHEN ? IN (\'completed\',\'cancelled\') THEN ? ELSE completed_at END WHERE id = ?')
      .run(status, status, Date.now(), id);
  }
  listContracts(providerId?: string, consumerId?: string): any[] {
    let sql = 'SELECT * FROM marketplace_contracts WHERE 1=1';
    const params: any[] = [];
    if (providerId) { sql += ' AND provider_id = ?'; params.push(providerId); }
    if (consumerId) { sql += ' AND consumer_id = ?'; params.push(consumerId); }
    sql += ' ORDER BY created_at DESC';
    return (this.db.prepare(sql).all(...params) as any[]).map(r => ({ ...r, terms: JSON.parse(r.terms_json || '{}') }));
  }
}
