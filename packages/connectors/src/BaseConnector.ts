/**
 * BaseConnector — Abstract base class for all connectors
 *
 * Provides common connector functionality:
 * - Capability management
 * - Meta generation
 * - Validation dispatch
 * - Execution timing
 *
 * @packageDocumentation
 */

import type { IActionConnector } from './IActionConnector.js';
import type { ActionRequest, ActionResult, ConnectorMeta, ConnectorCapability } from './types.js';

/**
 * BaseConnector — Abstract connector base class
 *
 * Extend this class to create new connectors.
 * Override executeAction() to provide action-specific logic.
 */
export abstract class BaseConnector implements IActionConnector {
  public readonly id: string;
  public readonly name: string;
  public readonly version: string;
  public readonly capabilities: ConnectorCapability[];

  protected initialized = false;

  constructor(
    id: string,
    name: string,
    version: string,
    capabilities: ConnectorCapability[]
  ) {
    this.id = id;
    this.name = name;
    this.version = version;
    this.capabilities = capabilities;
  }

  /**
   * initialize — Initialize the connector
   *
   * Override in subclass if additional setup is needed.
   */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /**
   * validate — Validate an action request
   *
   * Checks that the action is supported and parameters are valid.
   * Override in subclass for custom validation.
   *
   * @param request - Action request to validate
   * @returns true if valid
   */
  async validate(request: ActionRequest): Promise<boolean> {
    // Check that the action is in our capabilities
    const cap = this.capabilities.find(c => c.name === request.action);
    if (!cap) {
      return false;
    }

    // Check required parameters against input schema
    if (cap.inputSchema && request.params) {
      const schema = cap.inputSchema as Record<string, unknown>;
      const required = schema.required as string[] | undefined;
      if (required) {
        for (const field of required) {
          if (!(field in request.params)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * execute — Execute an action request
   *
   * Delegates to executeAction() which must be implemented by subclasses.
   * Provides automatic timing and error wrapping.
   *
   * @param request - Action request
   * @returns Action result
   */
  async execute(request: ActionRequest): Promise<ActionResult> {
    const startTime = Date.now();

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const result = await this.executeAction(request.action, request.params);
      return {
        success: true,
        data: result,
        duration: Date.now() - startTime,
        metadata: {
          connectorId: this.id,
          action: request.action,
        },
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime,
        metadata: {
          connectorId: this.id,
          action: request.action,
        },
      };
    }
  }

  /**
   * executeAction — Execute a specific action
   *
   * Must be implemented by subclasses to provide action-specific logic.
   *
   * @param action - Action name
   * @param params - Action parameters
   * @returns Action result data
   */
  protected abstract executeAction(action: string, params: Record<string, unknown>): Promise<unknown>;

  /**
   * rollback — Rollback an action
   *
   * Override in subclass if actions need rollback support.
   *
   * @param _actionId - Action identifier to rollback
   */
  async rollback(_actionId: string): Promise<void> {
    // Default: no-op
    console.warn(`[${this.id}] Rollback not implemented for action: ${_actionId}`);
  }

  /**
   * getMeta — Get connector metadata
   */
  getMeta(): ConnectorMeta {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      capabilities: this.capabilities,
      enabled: this.initialized,
    };
  }
}
