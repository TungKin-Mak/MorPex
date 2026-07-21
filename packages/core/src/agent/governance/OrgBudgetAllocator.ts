/**
 * OrgBudgetAllocator — 组织预算分配器
 *
 * v9.2: 跨 Agent/团队共享的预算池管理。
 * 支持分配、消费、转移、预留。
 */

export interface OrgBudget {
  totalBudget: number
  allocated: number
  reserved: number
  available: number
}

export interface BudgetAllocation {
  teamId: string
  allocated: number
  spent: number
  remaining: number
  lastUpdated: number
}

export class OrgBudgetAllocator {
  private orgBudget: OrgBudget = {
    totalBudget: 1_000_000,
    allocated: 0,
    reserved: 100_000,
    available: 900_000,
  }

  private allocations = new Map<string, BudgetAllocation>()

  /**
   * allocate — 分配预算给团队
   *
   * @returns 是否成功
   */
  allocate(teamId: string, amount: number): boolean {
    if (amount <= 0) return false
    if (amount > this.orgBudget.available) return false

    const existing = this.allocations.get(teamId)
    if (existing) {
      existing.allocated += amount
      existing.remaining += amount
      existing.lastUpdated = Date.now()
    } else {
      this.allocations.set(teamId, {
        teamId,
        allocated: amount,
        spent: 0,
        remaining: amount,
        lastUpdated: Date.now(),
      })
    }

    this.orgBudget.allocated += amount
    this.orgBudget.available = this.orgBudget.totalBudget - this.orgBudget.allocated - this.orgBudget.reserved
    return true
  }

  /**
   * deallocate — 回收团队未使用的预算
   */
  deallocate(teamId: string, amount: number): boolean {
    const alloc = this.allocations.get(teamId)
    if (!alloc) return false
    if (amount > alloc.remaining) return false

    alloc.remaining -= amount
    alloc.allocated -= amount
    alloc.lastUpdated = Date.now()

    this.orgBudget.allocated -= amount
    this.orgBudget.available = this.orgBudget.totalBudget - this.orgBudget.allocated - this.orgBudget.reserved
    return true
  }

  /**
   * spend — 消费团队预算
   */
  spend(teamId: string, amount: number): boolean {
    const alloc = this.allocations.get(teamId)
    if (!alloc) return false
    if (amount > alloc.remaining) return false

    alloc.spent += amount
    alloc.remaining -= amount
    alloc.lastUpdated = Date.now()
    return true
  }

  /**
   * getTeamBudget — 获取团队预算详情
   */
  getTeamBudget(teamId: string): BudgetAllocation | undefined {
    const alloc = this.allocations.get(teamId)
    if (!alloc) return undefined
    return { ...alloc }
  }

  /**
   * getOrgStats — 获取组织预算统计
   */
  getOrgStats(): OrgBudget {
    return { ...this.orgBudget }
  }

  /**
   * transferBudget — 在团队间转移预算
   */
  transferBudget(fromTeam: string, toTeam: string, amount: number): boolean {
    if (!this.allocations.has(fromTeam)) return false
    if (!this.deallocate(fromTeam, amount)) return false
    if (!this.allocate(toTeam, amount)) {
      // 回滚
      this.allocate(fromTeam, amount)
      return false
    }
    return true
  }

  /**
   * setReserve — 设置预留比例
   */
  setReserve(percentage: number): void {
    const reserve = Math.round(this.orgBudget.totalBudget * (percentage / 100))
    this.orgBudget.reserved = reserve
    this.orgBudget.available = this.orgBudget.totalBudget - this.orgBudget.allocated - this.orgBudget.reserved
  }

  /**
   * listAllocations — 列出所有分配
   */
  listAllocations(): BudgetAllocation[] {
    return [...this.allocations.values()]
  }
}
