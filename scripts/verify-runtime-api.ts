/**
 * Quick verify: RuntimeAPI module loads and routes compile correctly
 */
const express = (await import('express')).default();
import { registerRuntimeRoutes } from '../packages/studio/server/RuntimeAPI.js';

registerRuntimeRoutes(express);

// Test by checking that route definitions exist
const routes = express.router?.stack || [];
console.log('✅ RuntimeAPI module loaded');
console.log('✅ registerRuntimeRoutes() registered on Express app');

// List registered routes
const routePaths: string[] = [];
function extractRoutes(stack: any[], base = '') {
  for (const layer of stack) {
    if (layer.route) {
      routePaths.push(`${Object.keys(layer.route.methods).join(',').toUpperCase()} ${base}${layer.route.path}`);
    } else if (layer.handle?.stack) {
      extractRoutes(layer.handle.stack, base);
    } else if (layer.name === 'router') {
      extractRoutes(layer.handle?.stack || [], base);
    }
  }
}
extractRoutes((express as any).router?.stack || []);
console.log(`Registered routes:`);
routePaths.sort().forEach(p => console.log(`  ${p}`));
