export { AgentMemoryIsolation } from './AgentMemoryIsolation.js'
export type { AgentMemoryPartition, SharedMemoryEntry } from './AgentMemoryIsolation.js'

// v9.2: Shared Memory Consensus
export { SharedMemoryManager } from './SharedMemoryManager.js'
export type { SharedMemoryConfig, MemoryConsistencyLevel, MemoryScope } from './SharedMemoryManager.js'
export { ConsensusProtocol } from './ConsensusProtocol.js'
export type { ConsensusProposal } from './ConsensusProtocol.js'
export { MemoryLockService } from './MemoryLockService.js'
export type { MemoryLock } from './MemoryLockService.js'
export { ConflictResolver } from './ConflictResolver.js'
export type { ConflictResolutionStrategy, ConflictRecord } from './ConflictResolver.js'
export { MemorySnapshotService } from './MemorySnapshotService.js'
export type { MemorySnapshot } from './MemorySnapshotService.js'
