/**
 * MorPex v11 — Connector Types
 *
 * Type definitions for the Action Infrastructure Plane.
 * Connectors provide safe, validated access to external systems.
 *
 * @packageDocumentation
 */

/** Action request submitted to a connector */
export interface ActionRequest {
  /** Action name (e.g., 'git.commit', 'fs.write') */
  action: string;
  /** Action parameters */
  params: Record<string, unknown>;
  /** Execution identity for audit */
  executionId?: string;
  /** User identity for permission checks */
  userId?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/** Action result returned by a connector */
export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** Result data (may be any shape depending on action) */
  data?: unknown;
  /** Error message if failed */
  error?: string;
  /** Execution duration in milliseconds */
  duration: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Exit code (for shell/process actions) */
  exitCode?: number;
}

/** Capability declaration for a connector */
export interface ConnectorCapability {
  /** Capability name (e.g., 'git.clone', 'fs.read') */
  name: string;
  /** Capability description */
  description: string;
  /** Input parameter schema (JSON Schema) */
  inputSchema?: Record<string, unknown>;
  /** Output schema (JSON Schema) */
  outputSchema?: Record<string, unknown>;
  /** Whether this action is destructive */
  destructive?: boolean;
  /** Whether this action requires human approval */
  requiresApproval?: boolean;
}

/** Connector metadata */
export interface ConnectorMeta {
  /** Unique connector identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Connector version */
  version: string;
  /** Supported capabilities */
  capabilities: ConnectorCapability[];
  /** Connector description */
  description?: string;
  /** Whether connector is enabled */
  enabled: boolean;
}

/** Connector configuration */
export interface ConnectorConfig {
  /** Connector ID */
  id: string;
  /** Connector type */
  type: string;
  /** Whether to enable */
  enabled?: boolean;
  /** Connector-specific options */
  options?: Record<string, unknown>;
  /** Permission level required */
  permissionLevel?: 'read' | 'write' | 'admin';
}

/** Permission check result */
export interface PermissionResult {
  /** Whether permission is granted */
  granted: boolean;
  /** Reason if denied */
  reason?: string;
  /** Required approval level */
  requiredApproval?: 'none' | 'user' | 'admin';
}

/** Permission rule */
export interface PermissionRule {
  /** Connector ID pattern (supports glob) */
  connectorPattern: string;
  /** Action pattern (supports glob) */
  actionPattern: string;
  /** Allowed roles */
  allowedRoles: string[];
  /** Whether action is destructive */
  destructive: boolean;
  /** Whether approval is required */
  requiresApproval: boolean;
}
