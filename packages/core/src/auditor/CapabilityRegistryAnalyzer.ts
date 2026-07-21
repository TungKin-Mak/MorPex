import type { ModuleInfo, DuplicateCapability } from './types.js';
const O:Record<string,string[]>={Planning:['MetaPlanner'],Runtime:['ExecutionFSM','DAGRuntime'],Agent:['ExecutionGateway'],Knowledge:['KnowledgeGraph','ArtifactRegistry'],Event:['EventBus','EventStore']};
export class CapabilityRegistryAnalyzer {
  detectDuplicates(_:ModuleInfo[]):DuplicateCapability[]{return[];}
  detectMissingCapabilities(modules:ModuleInfo[]):string[]{const n=new Set(modules.map(m=>m.name));const p=new Set(modules.map(m=>m.path));return Object.entries(O).filter(([_,o])=>!o.some(owner=>n.has(owner)||[...p].some(x=>x.includes(owner)))).map(([c])=>c);}
}
