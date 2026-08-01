import { CapabilityRegistry } from './CapabilityRegistry.js';
import type { Capability } from './CapabilityRegistry.js';

export class CapabilityDiscoverer {
  static discover(goalContext: { objective: string; requiredCapabilities: string[]; domain?: string }): { matched: Capability[]; missing: string[] } {
    const matched: Capability[] = [];
    const found = new Set<string>();

    for (const req of goalContext.requiredCapabilities) {
      const results = CapabilityRegistry.search(req);
      for (const r of results) {
        if (!found.has(r.name)) { matched.push(r); found.add(r.name); }
      }
    }
    if (goalContext.domain) {
      const domainCaps = CapabilityRegistry.findByDomain(goalContext.domain);
      for (const c of domainCaps) {
        if (!found.has(c.name)) { matched.push(c); found.add(c.name); }
      }
    }
    const lower = goalContext.objective.toLowerCase();
    for (const c of CapabilityRegistry.getAll()) {
      if (!found.has(c.name) && lower.includes(c.name.toLowerCase().split(' ')[0])) {
        matched.push(c); found.add(c.name);
      }
    }
    const matchedNames = new Set(matched.map(m => m.name));
    const missing = CapabilityRegistry.getAll()
      .filter(c => !matchedNames.has(c.name) && c.provider === goalContext.domain)
      .map(c => c.name);
    return { matched, missing };
  }
}
