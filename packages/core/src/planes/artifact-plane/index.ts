/**
 * Artifact Plane — Barrel Export
 *
 * v9.1: 独立产物管理平面导出入口。
 */
export { ArtifactPlane } from './ArtifactPlane.js'
export { ArtifactManager } from './ArtifactManager.js'
export type { CreateArtifactInput, ArtifactManagerConfig } from './ArtifactManager.js'
export { ArtifactRepository } from './ArtifactRepository.js'
export { ArtifactStagingArea } from './ArtifactStagingArea.js'
export type { StagingConfig } from './ArtifactStagingArea.js'
export { ArtifactValidator } from './ArtifactValidator.js'
export type { ValidationRule, ValidationIssue, ValidationResult } from './ArtifactValidator.js'
export { ArtifactVerifier } from './ArtifactVerifier.js'
export type { VerificationConfig } from './ArtifactVerifier.js'
export { ArtifactVersionService } from './ArtifactVersionService.js'
export type { VersionInfo, VersionTag, VersionDiff } from './ArtifactVersionService.js'
export { ArtifactEventEmitter } from './ArtifactEventEmitter.js'
export type { EventCallback } from './ArtifactEventEmitter.js'
export { ArtifactLineageTracker } from './ArtifactLineageTracker.js'
export type { LineageRelation, LineageEdge, LineagePath } from './ArtifactLineageTracker.js'
export type {
  ArtifactType,
  ArtifactStatus,
  ArtifactMeta,
  ArtifactRef,
  ArtifactRecord,
  ArtifactStageEntry,
  ArtifactVerificationResult,
  ArtifactEvent,
  ArtifactEventType,
  ArtifactQuery,
} from './types.js'
