/**
 * Event Mesh v10 — 导出入口
 */

export { EventMesh } from './event-mesh.js';
export { EventRegistry } from './event-registry.js';
export { SchemaValidator } from './schema-validator.js';
export { ReplayEngine } from './replay-engine.js';
export { MigrationLayer } from './migration-layer.js';

export type {
  EventSchema,
  MorpexEventV10,
  ValidationResult,
  ValidationError,
  ReplayRequest,
  ReplayResult,
  ReplayError,
  MigrationStep,
  MigrationResult,
  EventMeshConfig,
} from './types.js';
