const fs = require('fs');
const c = fs.readFileSync('E:/Morpex/packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', 'utf-8');

const oldCtor = '  constructor(config: {\n' +
'    bus: EventBus;\n' +
'    missionRuntime: MissionRuntime;\n' +
'    goalManager?: GoalManager;\n' +
'    behaviorTwin?: BehaviorTwin;\n' +
'    decisionTwin?: DecisionTwin;\n' +
'    preferenceModel?: PreferenceModel;\n' +
'  }) {\n' +
'    this.bus = config.bus;\n' +
'    this.missionRuntime = config.missionRuntime;\n' +
'    this.goalManager = config.goalManager ?? null;\n' +
'    this.behaviorTwin = config.behaviorTwin ?? null;\n' +
'    this.decisionTwin = config.decisionTwin ?? null;\n' +
'    this.preferenceModel = config.preferenceModel ?? null;\n' +
'  }';

const newCtor = '  constructor(config: {\n' +
'    bus: EventBus;\n' +
'    missionRuntime: MissionRuntime;\n' +
'    goalManager?: GoalManager;\n' +
'    behaviorTwin?: BehaviorTwin;\n' +
'    decisionTwin?: DecisionTwin;\n' +
'    preferenceModel?: PreferenceModel;\n' +
'    // v8.5: Workflow Evolution\n' +
'    workflowMiner?: MinerLike;\n' +
'    workflowRegistry?: RegistryLike;\n' +
'    workflowExecutor?: ExecutorLike;\n' +
'    // v8.5: Brain Persistence\n' +
'    brain?: BrainLike;\n' +
'  }) {\n' +
'    this.bus = config.bus;\n' +
'    this.missionRuntime = config.missionRuntime;\n' +
'    this.goalManager = config.goalManager ?? null;\n' +
'    this.behaviorTwin = config.behaviorTwin ?? null;\n' +
'    this.decisionTwin = config.decisionTwin ?? null;\n' +
'    this.preferenceModel = config.preferenceModel ?? null;\n' +
'    this.workflowMiner = config.workflowMiner ?? null;\n' +
'    this.workflowRegistry = config.workflowRegistry ?? null;\n' +
'    this.workflowExecutor = config.workflowExecutor ?? null;\n' +
'    this.brain = config.brain ?? null;\n' +
'  }';

if (c.includes(oldCtor)) {
  const result = c.replace(oldCtor, newCtor);
  fs.writeFileSync('E:/Morpex/packages/core/src/runtime/cognitive-loop/CognitiveLoop.ts', result, 'utf-8');
  console.log('Constructor updated');
} else {
  console.log('Old constructor NOT FOUND');
  // Debug: show what's around 'constructor'
  const idx = c.indexOf('constructor(config');
  if (idx >= 0) {
    console.log('Found at index', idx);
    console.log('Context:');
    console.log(c.substring(idx, idx + 600));
  }
}
