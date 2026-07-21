import { ArchitectureAuditor } from '../packages/core/src/auditor/ArchitectureAuditor.js';
const a = new ArchitectureAuditor();
const r = await a.runFullAudit();
console.log(a.formatReport(r));
