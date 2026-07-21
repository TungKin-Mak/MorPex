/**
 * Pi Augmentations — TypeScript declaration merging for pi-agent-core types.
 *
 * Extends pi-agent-core's AgentMessage to support MorPex custom message roles
 * (memoryHint, dagNodeStatus) used by MemoryMessages.ts.
 *
 * This file is imported as a side-effect by MemoryMessages.ts to activate
 * the module augmentation.
 */

// Module augmentation: extend CustomAgentMessages for MorPex roles
declare module '@earendil-works/pi-agent-core' {
  interface CustomAgentMessages {
    morpex_custom: { role: string; content: string; memories?: string[]; nodeId?: string; status?: string; domain?: string };
  }
}

export {};
