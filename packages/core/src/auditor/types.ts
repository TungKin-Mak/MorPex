/**
 * v3 Types — 架构审计增强类型
 */

export interface ModuleInfo { path:string; name:string; type:string; lines:number; hasExport:boolean; importers:number; dependencies:string[]; }
export interface MissingEdge { from:string; to:string; reason:string; severity:string; }
export interface EventFlowInfo { eventType:string; emitters:string[]; listeners:string[]; isPersisted:boolean; gap:string|null; }
export interface RuntimePathInfo { pathName:string; steps:string[]; isComplete:boolean; gap:string|null; }
export interface DuplicateCapability { capability:string; modules:string[]; recommendation:string; }

export interface DimensionScore {
  name: string;
  weight: number;
  score: number;
  maxScore: number;
  details: string;
}

/** v3: 8 级模块状态分类 */
export enum ModuleStatus {
  ACTIVE_RUNTIME     = 'ACTIVE_RUNTIME',
  ACTIVE_PUBLIC_API  = 'ACTIVE_PUBLIC_API',
  PLUGIN_CAPABILITY  = 'PLUGIN_CAPABILITY',
  DI_CREATED         = 'DI_CREATED',
  EVENT_LISTENER     = 'EVENT_LISTENER',
  DORMANT_CAPABILITY = 'DORMANT_CAPABILITY',
  TEST_ONLY          = 'TEST_ONLY',
  DEPRECATED         = 'DEPRECATED',
  DEAD               = 'DEAD',
}

/** v3: 分类后的模块 */
export interface ClassifiedModule {
  path: string;
  name: string;
  status: string;
  reason: string;
}

/** v3: DI / Runtime 实例化边 */
export interface DIEdge {
  className: string;
  filePath: string;
  instantiatedIn: string;
  pattern: 'new' | 'factory' | 'register' | 'registerPlugin';
}

/** v3: 公开 API 模块 */
export interface PublicAPIModule {
  path: string;
  name: string;
  exportSource: string;
}

/** v3: 分类上下文 */
export interface ClassificationContext {
  bootstrapContent: string;
  kernelContent: string;
  barrelContent: string;
  modules: ModuleInfo[];
  diEdges: DIEdge[];
  publicApiSet: Set<string>;
  eventSubscribers: Map<string, string[]>;
}

export interface ArchitectureReport {
  timestamp:number; modules:ModuleInfo[]; unusedModules:ModuleInfo[]; missingEdges:MissingEdge[];
  /** v3: 分类后的模块 */
  classifiedModules?: ClassifiedModule[];
  runtimeCoverage:{ total:number; complete:number; incomplete:number; coverage:number; paths:RuntimePathInfo[]; };
  eventFlows:EventFlowInfo[]; duplicateCapabilities:DuplicateCapability[];
  architectureScore:number; scoreBreakdown:DimensionScore[];
  criticalIssues:string[]; recommendations:string[];
  /** v3: 分类汇总 */
  classificationSummary?: Record<string, number>;
  /** v3: 误报减少报告 */
  falsePositiveReduction?: { oldDead: number; nowDead: number; reduction: number };
}
