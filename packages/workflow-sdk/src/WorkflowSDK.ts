/**
 * WorkflowSDK — MorPex v11 Adaptive Workflow SDK
 *
 * Main programmatic API for workflow lifecycle management.
 * Wraps existing v10 runtime modules and provides v11 unified interface.
 *
 * @packageDocumentation
 */

import type {
  WorkflowDefinition,
  WorkflowStepDefinition,
  WorkflowPackage,
  InstalledWorkflow,
  WorkflowExecutionResult,
  WorkflowMetrics,
  WorkflowStatus,
  OptimizationProposal,
  WorkflowVersion,
  ExecutionOptions,
} from './types.js';

import type { IWorkflowAdapter } from './IWorkflowAdapter.js';

/** Options for creating a workflow package */
export interface CreateOptions {
  format?: 'json' | 'yaml';
  withTests?: boolean;
  withPrompts?: boolean;
}

/** Internal runtime reference type */
interface AdaptiveWorkflowRuntime {
  execute(workflowId: string, input: unknown, options?: ExecutionOptions): Promise<WorkflowExecutionResult>;
  install(pkg: WorkflowPackage): Promise<InstalledWorkflow>;
  uninstall(workflowId: string): Promise<boolean>;
  getStatus(workflowId: string): Promise<WorkflowStatus>;
  getMetrics(workflowId: string): Promise<WorkflowMetrics>;
  optimize(workflowId: string): Promise<OptimizationProposal>;
  listVersions(workflowId: string): Promise<WorkflowVersion[]>;
  rollback(workflowId: string, version: string): Promise<boolean>;
  list(): Promise<InstalledWorkflow[]>;
}

/**
 * WorkflowSDK — Main entry point for the MorPex v11 Workflow API
 *
 * Provides programmatic access to:
 * - Workflow package creation and installation
 * - Workflow execution with tracing
 * - Version management and rollback
 * - Evolution Engine optimization
 * - Metrics and observability
 *
 * @example
 * ```typescript
 * const sdk = new WorkflowSDK(runtime);
 * const workflow = await sdk.createFromDir('./my-workflow');
 * const installed = await sdk.install(workflow);
 * const result = await sdk.execute('my-workflow', { project: 'MorPex' });
 * ```
 */
export class WorkflowSDK {
  private runtime: AdaptiveWorkflowRuntime;
  private adapters: Map<string, IWorkflowAdapter> = new Map();

  constructor(runtime: AdaptiveWorkflowRuntime) {
    this.runtime = runtime;
  }

  // ═══════════════════════════════════════════════════════════════
  // Workflow Package Creation
  // ═══════════════════════════════════════════════════════════════

  /**
   * createFromDir — Create a Workflow Package from a directory structure
   *
   * Reads manifest.json and workflow.yaml (or workflow.ts) from the directory
   * and returns a validated WorkflowPackage.
   *
   * @param dir - Path to the workflow package directory
   * @returns A fully typed WorkflowPackage
   */
  async createFromDir(dir: string): Promise<WorkflowPackage> {
    // Use dynamic import for fs to avoid ESM issues
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const dirPath = path.resolve(dir);
    const exists = await fs.stat(dirPath).then(() => true).catch(() => false);
    if (!exists) {
      throw new Error(`Workflow package directory not found: ${dirPath}`);
    }

    // Read manifest
    const manifestPath = path.join(dirPath, 'manifest.json');
    const manifestRaw = await fs.readFile(manifestPath, 'utf-8').catch(() => {
      throw new Error(`Missing manifest.json in workflow package: ${dirPath}`);
    });
    const manifest = JSON.parse(manifestRaw);

    // Read workflow definition (try yaml first, then ts)
    const yamlPath = path.join(dirPath, 'workflow.yaml');
    const tsPath = path.join(dirPath, 'workflow.ts');
    let definition: WorkflowDefinition;

    const yamlExists = await fs.stat(yamlPath).then(() => true).catch(() => false);
    const tsExists = await fs.stat(tsPath).then(() => true).catch(() => false);

    if (yamlExists) {
      const yamlRaw = await fs.readFile(yamlPath, 'utf-8');
      definition = this.parseYamlDefinition(yamlRaw);
    } else if (tsExists) {
      // Dynamic import of the ts file (requires tsx or similar)
      const mod = await import(pathToFileURL(tsPath).href);
      definition = mod.default || mod.definition;
    } else {
      throw new Error(`No workflow definition found (workflow.yaml or workflow.ts) in: ${dirPath}`);
    }

    // Validate manifest name matches definition name
    if (manifest.name !== definition.name) {
      throw new Error(
        `Manifest name "${manifest.name}" does not match definition name "${definition.name}"`
      );
    }

    return {
      manifest,
      definition,
      path: dirPath,
      version: manifest.version,
    };
  }

  /**
   * create — Programmatically construct a Workflow Package
   *
   * @param definition - Workflow definition
   * @param options - Optional create configuration
   * @returns A WorkflowPackage
   */
  async create(
    definition: WorkflowDefinition,
    _options?: CreateOptions
  ): Promise<WorkflowPackage> {
    // Build manifest from definition
    const manifest = {
      name: definition.name,
      version: definition.version,
      description: definition.description,
      category: definition.category,
      requiredCapabilities: definition.capabilities,
      metrics: definition.metrics,
    };

    return {
      manifest,
      definition,
      path: '',
      version: definition.version,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Installation & Lifecycle
  // ═══════════════════════════════════════════════════════════════

  /**
   * install — Install a Workflow Package
   *
   * Accepts a WorkflowPackage object, local file path, or remote URL.
   * Validates manifest, resolves dependencies, registers with runtime.
   *
   * @param source - WorkflowPackage, file path, or URL
   * @returns Installed workflow record
   */
  async install(source: WorkflowPackage | string | URL): Promise<InstalledWorkflow> {
    let pkg: WorkflowPackage;

    if (isWorkflowPackage(source)) {
      pkg = source as WorkflowPackage;
    } else if (typeof source === 'string') {
      // Local file or directory path
      pkg = await this.createFromDir(source);
    } else {
      // Remote URL — download first
      pkg = await this.downloadPackage(source as URL);
    }

    return this.runtime.install(pkg);
  }

  /**
   * registerAdapter — Register a custom IWorkflowAdapter
   *
   * Adapters provide custom workflow execution logic.
   * When registered, the runtime uses this adapter instead of the default executor.
   *
   * @param workflowId - Workflow ID to associate with this adapter
   * @param adapter - The adapter implementation
   */
  registerAdapter(workflowId: string, adapter: IWorkflowAdapter): void {
    this.adapters.set(workflowId, adapter);
  }

  /**
   * getAdapter — Get the registered adapter for a workflow
   */
  getAdapter(workflowId: string): IWorkflowAdapter | undefined {
    return this.adapters.get(workflowId);
  }

  /**
   * unregisterAdapter — Remove a registered adapter
   */
  unregisterAdapter(workflowId: string): boolean {
    return this.adapters.delete(workflowId);
  }

  // ═══════════════════════════════════════════════════════════════
  // Execution
  // ═══════════════════════════════════════════════════════════════

  /**
   * execute — Execute an installed Workflow by ID
   *
   * @param workflowId - The workflow ID to execute
   * @param input - Input data for the workflow
   * @param options - Optional execution configuration
   * @returns Execution result with output, metrics, and trace
   */
  async execute(
    workflowId: string,
    input: unknown,
    options?: ExecutionOptions
  ): Promise<WorkflowExecutionResult> {
    // Check if a custom adapter is registered
    const adapter = this.adapters.get(workflowId);
    if (adapter) {
      // Use adapter-based execution
      const context = {
        workflowId,
        runId: `run_${Date.now()}`,
        version: adapter.version,
        input,
        state: 'initialized',
        memory: {},
        artifacts: [],
        metrics: {},
        startedAt: Date.now(),
      };
      return adapter.execute(context);
    }

    // Use runtime execution
    return this.runtime.execute(workflowId, input, options);
  }

  // ═══════════════════════════════════════════════════════════════
  // Optimization
  // ═══════════════════════════════════════════════════════════════

  /**
   * optimize — Trigger the Evolution Engine to optimize the specified Workflow
   *
   * @param workflowId - Workflow ID to optimize
   * @returns Optimization proposal
   */
  async optimize(workflowId: string): Promise<OptimizationProposal> {
    return this.runtime.optimize(workflowId);
  }

  // ═══════════════════════════════════════════════════════════════
  // Version Management
  // ═══════════════════════════════════════════════════════════════

  /**
   * listVersions — List all versions of a workflow
   */
  async listVersions(workflowId: string): Promise<WorkflowVersion[]> {
    return this.runtime.listVersions(workflowId);
  }

  /**
   * rollback — Rollback a workflow to a specific version
   *
   * @param workflowId - Workflow ID
   * @param version - Target version to rollback to
   * @returns true if rollback succeeded
   */
  async rollback(workflowId: string, version: string): Promise<boolean> {
    return this.runtime.rollback(workflowId, version);
  }

  // ═══════════════════════════════════════════════════════════════
  // Observability & Metrics
  // ═══════════════════════════════════════════════════════════════

  /**
   * getStatus — Get the current status of a workflow
   */
  async getStatus(workflowId: string): Promise<WorkflowStatus> {
    return this.runtime.getStatus(workflowId);
  }

  /**
   * getMetrics — Get execution metrics for a workflow
   */
  async getMetrics(workflowId: string): Promise<WorkflowMetrics> {
    return this.runtime.getMetrics(workflowId);
  }

  /**
   * list — List all installed workflows
   */
  async list(): Promise<InstalledWorkflow[]> {
    return this.runtime.list();
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * parseYamlDefinition — Parse a YAML workflow definition
   *
   * Simple YAML parser for workflow definitions.
   * For production, use js-yaml.
   */
  private parseYamlDefinition(yaml: string): WorkflowDefinition {
    // Simple line-based YAML parser for workflow definitions
    // In production, use a proper YAML parser library
    const lines = yaml.split('\n').filter(l => l.trim());
    const def: Partial<WorkflowDefinition> = {
      steps: [],
      capabilities: [],
    };

    let currentSection: string | null = null;
    let currentStep: Record<string, unknown> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments
      if (trimmed.startsWith('#') || trimmed.startsWith('---')) continue;

      // Top-level keys — use raw line to detect indentation (trimmed loses leading spaces)
      const topMatch = trimmed.match(/^(\w+):\s*(.*)/);
      if (topMatch && !line.startsWith(' ') && !line.startsWith('	')) {
        // Save previous step
        if (currentStep) {
          def.steps!.push(currentStep as unknown as WorkflowStepDefinition);
          currentStep = null;
        }
        currentSection = null;

        const [, key, value] = topMatch;
        if (key === 'name') def.name = value;
        else if (key === 'version') def.version = value;
        else if (key === 'category') def.category = value;
        else if (key === 'description') def.description = value;
        else if (key === 'trigger') { currentSection = 'trigger'; }
        else if (key === 'steps') { currentSection = 'steps'; }
        else if (key === 'capabilities') { currentSection = 'capabilities'; }
        continue;
      }

      // Trigger type
      if (currentSection === 'trigger') {
        const trigMatch = trimmed.match(/^type:\s*(.*)/);
        if (trigMatch) {
          def.trigger = { type: trigMatch[1] as WorkflowDefinition['trigger']['type'] };
        }
        continue;
      }

      // Capabilities list
      if (currentSection === 'capabilities') {
        const capMatch = trimmed.match(/^\s*-\s*(.*)/);
        if (capMatch) {
          const capVal = capMatch[1].trim();
          if (capVal) def.capabilities!.push(capVal);
        }
        continue;
      }

      // Steps
      if (currentSection === 'steps') {
        const stepMatch = trimmed.match(/^\s*-\s*id:\s*(.*)/);
        if (stepMatch) {
          if (currentStep) {
            def.steps!.push(currentStep as unknown as WorkflowStepDefinition);
          }
          currentStep = { id: stepMatch[1] };
        } else if (currentStep) {
          // Use raw line (not trimmed) to preserve leading whitespace for indentation detection
          const kvMatch = line.match(/^\s+(\w+):\s*(.*)/);
          if (kvMatch) {
            const [, k, v] = kvMatch;
            if (k === 'dependsOn') {
              // Handle array: [a, b] or "- a\n  - b"
              currentStep[k] = v.startsWith('[')
                ? JSON.parse(v.replace(/'/g, '"'))
                : [];
            } else {
              currentStep[k] = v;
            }
          }
        }
      }
    }

    // Save last step
    if (currentStep) {
      def.steps!.push(currentStep as unknown as WorkflowStepDefinition);
    }

    return def as WorkflowDefinition;
  }

  /**
   * downloadPackage — Download a workflow package from a URL
   */
  private async downloadPackage(_url: URL): Promise<WorkflowPackage> {
    // TODO: Implement remote package download
    throw new Error('Remote package download not yet implemented');
  }
}

/**
 * Check if an object is a WorkflowPackage
 */
function isWorkflowPackage(obj: unknown): obj is WorkflowPackage {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'manifest' in obj &&
    'definition' in obj &&
    'version' in obj
  );
}

/**
 * Convert a file path to a file:// URL
 */
function pathToFileURL(path: string): URL {
  // Simple path-to-file URL conversion
  const normalized = path.replace(/\\/g, '/');
  return new URL(`file:///${normalized.startsWith('/') ? normalized.slice(1) : normalized}`);
}
