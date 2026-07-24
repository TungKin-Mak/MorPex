/**
 * Artifact — 可交付物共享类型
 * v14: 产物平面核心数据模型
 */
export type ArtifactType = 'document' | 'code' | 'design' | 'data' | 'media';
export type ArtifactStatus = 'CREATED' | 'VALIDATING' | 'APPROVED' | 'DEPLOYED' | 'FAILED';

export interface Artifact {
  id: string;
  type: ArtifactType;
  sourceTask: string;
  version: number;
  status: ArtifactStatus;
  metadata: Record<string, unknown>;
  departmentId?: string;
  createdAt: number;
}
