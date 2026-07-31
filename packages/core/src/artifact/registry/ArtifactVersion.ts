/**
 * ArtifactVersion — 版本管理
 *
 * 每次 Artifact 内容变更时创建版本快照。
 * 支持版本回滚和变更追溯。
 */

import type { ArtifactVersion, ArtifactInstance } from './types.js';
import { ExecutionIdentity } from '../../../common/ExecutionIdentity.js';

const identity = new ExecutionIdentity();

/** 从 Artifact Instance 创建版本快照 */
export function createVersionSnapshot(
  artifact: ArtifactInstance,
  changeLog?: string,
): ArtifactVersion {
  return {
    id: identity.createArtifactId(),
    artifactId: artifact.id,
    version: artifact.version,
    content: artifact.content,
    changeLog,
    createdAt: Date.now(),
    createdBy: artifact.createdBy,
  };
}

/** 将 Artifact 回滚到指定版本（返回新的 Artifact Instance） */
export function rollbackToVersion(
  artifact: ArtifactInstance,
  targetVersion: ArtifactVersion,
): ArtifactInstance {
  return {
    ...artifact,
    content: targetVersion.content,
    version: artifact.version + 1,
    status: 'draft',
    updatedAt: Date.now(),
    metadata: {
      ...(artifact.metadata ?? {}),
      rollbackFrom: artifact.version,
      rollbackTo: targetVersion.version,
    },
  };
}

/** 版本号格式化（v1, v2, v3...） */
export function formatVersion(version: number): string {
  return `v${version}`;
}
