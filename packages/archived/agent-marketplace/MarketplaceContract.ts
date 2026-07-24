/**
 * MarketplaceContract — 市场合约
 *
 * 基于 WorkflowContract 概念，用于市场交易的合约管理。
 */

import type { Bid, MarketplaceContract } from './types.js'

export class MarketplaceContractManager {
  private contracts = new Map<string, MarketplaceContract>()
  private counter = 0

  /**
   * createContract — 创建新合约
   */
  createContract(bid: Bid, buyerId: string, taskDescription: string, deadline: number): MarketplaceContract {
    const contract: MarketplaceContract = {
      id: `mkt_contract_${Date.now()}_${++this.counter}`,
      buyerAgentId: buyerId,
      sellerAgentId: bid.agentId,
      taskDescription,
      price: bid.price,
      deadline,
      status: 'pending',
      signedAt: Date.now(),
    }

    this.contracts.set(contract.id, contract)
    return contract
  }

  /**
   * signContract — 签署合约
   */
  signContract(contractId: string, sellerAgentId: string): boolean {
    const contract = this.contracts.get(contractId)
    if (!contract || contract.sellerAgentId !== sellerAgentId) return false
    if (contract.status !== 'pending') return false

    contract.status = 'active'
    return true
  }

  /**
   * completeContract — 完成合约
   */
  completeContract(contractId: string, result: any): boolean {
    const contract = this.contracts.get(contractId)
    if (!contract || contract.status !== 'active') return false

    contract.status = 'completed'
    contract.completedAt = Date.now()
    return true
  }

  /**
   * failContract — 标记合约失败
   */
  failContract(contractId: string, reason: string): boolean {
    const contract = this.contracts.get(contractId)
    if (!contract) return false

    contract.status = 'failed'
    contract.completedAt = Date.now()
    return true
  }

  /**
   * cancelContract — 取消合约
   */
  cancelContract(contractId: string): boolean {
    const contract = this.contracts.get(contractId)
    if (!contract || contract.status === 'completed') return false

    contract.status = 'cancelled'
    return true
  }

  /**
   * getContract — 获取合约
   */
  getContract(id: string): MarketplaceContract | undefined {
    return this.contracts.get(id)
  }

  /**
   * listContracts — 列出 Agent 相关的所有合约
   */
  listContracts(agentId: string): MarketplaceContract[] {
    return [...this.contracts.values()].filter(
      c => c.buyerAgentId === agentId || c.sellerAgentId === agentId
    )
  }

  /**
   * listAll — 列出所有合约
   */
  listAll(): MarketplaceContract[] {
    return [...this.contracts.values()]
  }
}
