/**
 * projectors — Ontology 投影器
 *
 * 迭代2：将现有数据（Mission / Artifact / Agent 等）投影到 Ontology，
 * 使 LLM 查询 ontology_queryObjects 能看到真实数据。
 */

export { MissionProjector } from './MissionProjector.js';
export type { MissionSource } from './MissionProjector.js';

export { ArtifactProjector } from './ArtifactProjector.js';
export type { ArtifactSource } from './ArtifactProjector.js';
