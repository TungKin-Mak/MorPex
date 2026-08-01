/** Memory record retrieved from memory store */
export interface MemoryRecord {
  id: string;
  content: string;
  type: 'task' | 'domain' | 'pattern' | 'error' | 'experience';
  relevanceScore: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

/** Reference to an artifact */
export interface ArtifactRef {
  id: string;
  name: string;
  type: string;
  version: string;
  uri: string;
}

/** Historical experience for pattern matching */
export interface Experience {
  id: string;
  goal: string;
  planId: string;
  outcome: 'success' | 'failure' | 'partial';
  duration: number;
  patterns: string[];
  lessons: string[];
  timestamp: number;
}

/** Event callback type */
export type HarnessEventCallback = (event: string, data: any) => void;
