import * as fs from 'node:fs';
import * as path from 'node:path'; import type { ModuleInfo, MissingEdge } from './types.js';
export class DependencyAnalyzer {
  analyze(modules: ModuleInfo[], srcRoot: string): ModuleInfo[] {
    // Read bootstrap to detect runtime registrations (plugins etc)
    let bootstrapContent = '';
    try { bootstrapContent = fs.readFileSync(path.join(srcRoot, '../bootstrap.ts'), 'utf-8'); } catch {}
    
    for (const mod of modules) {
      let c = 0;
      for (const other of modules) {
        if (other.path === mod.path || mod.path === 'index.ts' || other.path === 'index.ts') continue;
        for (const dep of other.dependencies) {
          const otherDir = path.dirname(other.path);
          const depClean = dep.replace(/\.js$/, '');
          const resolved = path.normalize(path.join(otherDir, depClean)).replace(/\\/g, '/');
          const modClean = mod.path.replace(/\.ts$/, '').replace(/\/index$/, '');
          if (resolved === modClean) { c++; break; }
        }
      }
      // Phase 10 fix: if module is a plugin with class export, check bootstrap for runtime registration
      if (c === 0 && mod.name === 'plugin' && mod.path.includes('knowledge-plane') && bootstrapContent) {
        // Extract class name from plugin file
        try {
          const plugContent = fs.readFileSync(path.join(srcRoot, mod.path), 'utf-8');
          const classMatch = plugContent.match(/export class (\w+Plugin)\b/);
          if (classMatch && bootstrapContent.includes('new ' + classMatch[1] + '(')) {
            c = 1; // Mark as connected via runtime registration
          }
        } catch {}
      }
      mod.importers = c;
    }
    return modules;
  }

  detectMissingEdges(modules: ModuleInfo[]): MissingEdge[] {
    const r:MissingEdge[]=[]; const n=new Set(modules.map(x=>x.name)); const p=new Set(modules.map(x=>x.path)); const h=(s:string)=>n.has(s)||[...p].some(x=>x.includes(s));
    if (!h('ExecutionFSM')) r.push({from:'Execution',to:'FSM',reason:'缺少 ExecutionFSM 执行状态机',severity:'critical'});
    if (!h('DAGRuntime')) r.push({from:'Runtime',to:'DAG',reason:'缺少 DAG Runtime 执行器',severity:'critical'});
    if (!h('Checkpoint')&&!h('Recovery')) r.push({from:'Runtime',to:'Checkpoint',reason:'缺少 Checkpoint/Recovery',severity:'major'});
    if (!h('MemoryActivation')) r.push({from:'Memory',to:'Activation',reason:'缺少 MemoryActivationEngine',severity:'major'});
    const o=modules.find(x=>x.name==='ExecutionOrchestrator'); if(o&&o.importers<=1) r.push({from:'ExecutionOrchestrator',to:'Runtime',reason:'ExecutionOrchestrator 声明但从未被 new 实例化 (仅注释中存在)',severity:'critical'});
    // Plugin detection now checks bootstrap.ts for runtime registration patterns
    const kp=modules.filter(x=>x.path.includes('knowledge-plane')&&x.name==='plugin'); for(const pl of kp) if(pl.importers===0) r.push({from:pl.path,to:'Kernel',reason:'Knowledge plane 插件未注册到 PluginSystem',severity:'major'});
    if (!h('engine-subscriber')) r.push({from:'EventBus',to:'EngineSubscriber',reason:'EngineSubscriber 在模块扫描中未找到',severity:'minor'});
    return r;
  }
}
