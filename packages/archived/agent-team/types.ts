/**
 * Agent Team Formation — 类型定义
 *
 * v9.2: 根据 Mission 需求自动组建最优 Agent 团队。
 */

export type TeamStatus = 'forming' | 'active' | 'disbanded' | 'failed'
export type TeamRole = 'leader' | 'executor' | 'reviewer' | 'coordinator' | 'observer'

export interface TeamSpec {
  missionId: string
  requiredCapabilities: string[]
  teamSize: number
  preferredRoles: { role: TeamRole; minCount: number; maxCount: number }[]
  constraints?: {
    maxBudget: number
    minReliability: number
    requireDiversity: boolean
    deadline: number
  }
}

export interface TeamFormation {
  teamId: string
  missionId: string
  members: TeamMember[]
  status: TeamStatus
  createdAt: number
  activatedAt?: number
  disbandedAt?: number
}

export interface TeamMember {
  agentId: string
  role: TeamRole
  joinedAt: number
  status: 'active' | 'failed' | 'replaced'
  replacedBy?: string
  performance?: { tasksCompleted: number; successRate: number }
}

export interface TeamContext {
  teamId: string
  missionId: string
  sharedMemoryPrefix: string
  members: { agentId: string; role: TeamRole }[]
  leaderAgentId: string
  createdAt: number
}
