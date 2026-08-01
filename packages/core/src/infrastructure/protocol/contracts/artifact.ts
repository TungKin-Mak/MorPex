/**
 * Artifact — 可交付物共享类型
 *
 * @deprecated 使用 contracts/artifact-lifecycle.ts 代替。
 * v16 Phase 2: 统一 Artifact 模型已迁移到 ArtifactNode (contracts/artifact-lifecycle.ts)。
 * 此文件保留只为向后兼容，新代码应使用 artifact-lifecycle.ts。
 */

export type { ArtifactNode as Artifact, ArtifactStatus as ArtifactLifecycleStatus } from './artifact-lifecycle.js';

/** @deprecated 使用 artifact-lifecycle.ts 中的 ArtifactType 字符串字段 */
export type ArtifactType = 'document' | 'code' | 'design' | 'data' | 'media';
