import type { ModuleInfo } from './types.js';
const E=new Set(['index.ts','src/index.ts','common/Kernel.ts','common/EventBus.ts','common/types.ts']);
export class DeadModuleDetector { detect(modules:ModuleInfo[]):ModuleInfo[]{return modules.filter(m=>!E.has(m.path)&&m.path!=='index.ts'&&m.type!=='barrel'&&m.type!=='types'&&m.type!=='test'&&m.importers===0);} }
