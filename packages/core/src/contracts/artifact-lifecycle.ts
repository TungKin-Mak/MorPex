export type ArtifactLifecycleStatus = 'CREATED' | 'VALIDATING' | 'REVIEWING' | 'APPROVED' | 'RELEASED' | 'DEPLOYED' | 'RETIRED' | 'FAILED';
export type ArtifactStatus = ArtifactLifecycleStatus;

export interface ArtifactNode {
  id: string;
  type: string;
  name: string;
  version: number;
  status: ArtifactLifecycleStatus;
  sourceTask: string;
  lineage: ArtifactLineageEntry[];
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface ArtifactLineageEntry {
  from: string;
  relation: 'derived_from' | 'generated_by' | 'reviewed_by' | 'approved_by' | 'deployed_from';
  timestamp: number;
  detail?: string;
}
