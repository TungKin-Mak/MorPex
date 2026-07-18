/**
 * Pi Augmentations — TypeScript declaration merging for pi-agent-core types.
 *
 * Extends pi-agent-core's AgentMessage to support MorPex custom message roles
 * (memoryHint, dagNodeStatus) used by MemoryMessages.ts.
 *
 * This file is imported as a side-effect by MemoryMessages.ts to activate
 * the module augmentation.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ARCHITECTURAL NOTE:
 *   This is TypeScript module augmentation (declaration merging).
 *   It does NOT import runtime code from Pi packages — only types.
 *   The import is intentionally omitted to avoid duplicate identifier
 *   conflicts with the augmented interface.
 * ═══════════════════════════════════════════════════════════════════
 */

// Module augmentation: loosen AgentMessage to accept custom MorPex roles
declare module '@earendil-works/pi-agent-core' {
  interface AgentMessage {
    /** Custom roles injected by MorPex (memoryHint, dagNodeStatus, etc.) */
    role?: string;
    /** Memory items attached to memoryHint messages */
    memories?: string[];
    /** DAG node ID attached to dagNodeStatus messages */
    nodeId?: string;
    /** Execution status attached to dagNodeStatus messages */
    status?: string;
    /** Domain name attached to dagNodeStatus messages */
    domain?: string;
  }
}
