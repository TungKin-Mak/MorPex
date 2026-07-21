import type { MorPexPlugin } from '../../../common/types.js';

export class KnowledgeGraphPlugin implements MorPexPlugin {
  name = 'knowledge-graph-plugin';
  version = '0.1.0';
  dependencies?: string[];
  async initialize() {}
  async start() {}
  async stop() {}
}
