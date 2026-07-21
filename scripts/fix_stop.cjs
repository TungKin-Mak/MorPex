const fs = require('fs');
let c = fs.readFileSync('packages/studio/server/StudioServer.ts', 'utf8');

const oldStop = '  async stop(): Promise<void> {\n    await this.kernel.stop();\n    return new Promise((resolve) => {\n      if (this.httpServer) {\n        this.httpServer.close(() => resolve());\n      } else {\n        resolve();\n      }\n    });\n  }';

const newStop = '  async stop(): Promise<void> {\n    // v8.5: cleanup all resources\n    this.stopBehaviorTwinCheck();\n    if (this.v8Gateway) {\n      try { await this.v8Gateway.stop(); } catch (e) { console.warn("[Studio] Gateway stop:", (e as Error).message); }\n    }\n    if (this.v8EventSourcingStore) {\n      try { await this.v8EventSourcingStore.persist(); } catch (e) { console.warn("[Studio] EventStore persist:", (e as Error).message); }\n    }\n    if (this.v8PersonalBrain) {\n      try { this.v8PersonalBrain.destroy(); } catch (e) { console.warn("[Studio] Brain destroy:", (e as Error).message); }\n    }\n    await this.kernel.stop();\n    return new Promise((resolve) => {\n      if (this.httpServer) {\n        this.httpServer.close(() => resolve());\n      } else {\n        resolve();\n      }\n    });\n  }';

c = c.replace(oldStop, newStop);
fs.writeFileSync('packages/studio/server/StudioServer.ts', c);
console.log('Fixed stop()');
