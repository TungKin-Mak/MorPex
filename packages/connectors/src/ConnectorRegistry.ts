/**
 * ConnectorRegistry — v11 Connector Registry
 *
 * Central registry for all action connectors.
 * Manages connector lifecycle, discovery, and permission checks.
 *
 * @packageDocumentation
 */

import type { IActionConnector } from './IActionConnector.js';
import type { ActionRequest, ActionResult, ConnectorMeta, PermissionRule, PermissionResult } from './types.js';

/**
 * ConnectorRegistry — Central connector management
 *
 * Provides:
 * - Connector registration and discovery
 * - Action routing to appropriate connectors
 * - Permission checking before execution
 * - Connector lifecycle management
 */
export class ConnectorRegistry {
  /** Registered connectors: id → IActionConnector */
  private connectors: Map<string, IActionConnector> = new Map();

  /** Permission rules */
  private permissionRules: PermissionRule[] = [];

  /** Connector metadata cache */
  private metaCache: Map<string, ConnectorMeta> = new Map();

  /**
   * register — Register a connector
   *
   * @param connector - Connector instance to register
   */
  async register(connector: IActionConnector): Promise<void> {
    const id = connector.id;
    if (this.connectors.has(id)) {
      console.warn(`[ConnectorRegistry] Overwriting existing connector: ${id}`);
    }

    await connector.initialize();
    this.connectors.set(id, connector);
    this.metaCache.set(id, connector.getMeta());
  }

  /**
   * unregister — Unregister a connector
   *
   * @param id - Connector ID
   * @returns true if removed
   */
  unregister(id: string): boolean {
    const removed = this.connectors.delete(id);
    this.metaCache.delete(id);
    return removed;
  }

  /**
   * get — Get a connector by ID
   */
  get(id: string): IActionConnector | undefined {
    return this.connectors.get(id);
  }

  /**
   * getMeta — Get connector metadata
   */
  getMeta(id: string): ConnectorMeta | undefined {
    return this.metaCache.get(id);
  }

  /**
   * list — List all registered connectors
   */
  list(): IActionConnector[] {
    return [...this.connectors.values()];
  }

  /**
   * listMeta — List metadata for all connectors
   */
  listMeta(): ConnectorMeta[] {
    return [...this.metaCache.values()];
  }

  /**
   * find — Find connectors that support a specific capability
   *
   * @param capability - Capability name to search for
   * @returns Matching connectors
   */
  find(capability: string): IActionConnector[] {
    return [...this.connectors.values()].filter(c =>
      c.capabilities.some(cap => cap.name === capability)
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Action Execution
  // ═══════════════════════════════════════════════════════════════

  /**
   * execute — Execute an action through the appropriate connector
   *
   * Finds the connector that supports the requested action,
   * checks permissions, validates the request, and executes it.
   *
   * @param request - Action request
   * @returns Action result
   */
  async execute(request: ActionRequest): Promise<ActionResult> {
    // Find connector for this action
    const connector = this.findConnectorForAction(request.action);
    if (!connector) {
      return {
        success: false,
        error: `No connector found for action: ${request.action}`,
        duration: 0,
      };
    }

    // Check permissions
    const permission = await this.checkPermission(request, connector.id);
    if (!permission.granted) {
      return {
        success: false,
        error: `Permission denied: ${permission.reason ?? 'Access denied'}`,
        duration: 0,
      };
    }

    // Validate request
    const valid = await connector.validate(request);
    if (!valid) {
      return {
        success: false,
        error: `Invalid request for action: ${request.action}`,
        duration: 0,
      };
    }

    // Execute
    return connector.execute(request);
  }

  /**
   * executeBatch — Execute multiple actions in sequence
   *
   * @param requests - Array of action requests
   * @returns Array of action results
   */
  async executeBatch(requests: ActionRequest[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    for (const request of requests) {
      const result = await this.execute(request);
      results.push(result);
      if (!result.success) {
        // Stop on first failure
        break;
      }
    }
    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  // Permission Management
  // ═══════════════════════════════════════════════════════════════

  /**
   * addPermissionRule — Add a permission rule
   *
   * @param rule - Permission rule to add
   */
  addPermissionRule(rule: PermissionRule): void {
    this.permissionRules.push(rule);
  }

  /**
   * setPermissionRules — Set all permission rules
   *
   * @param rules - Array of permission rules
   */
  setPermissionRules(rules: PermissionRule[]): void {
    this.permissionRules = rules;
  }

  /**
   * checkPermission — Check if an action is permitted
   *
   * @param request - Action request
   * @param connectorId - Connector ID
   * @returns Permission result
   */
  private async checkPermission(
    request: ActionRequest,
    connectorId: string
  ): Promise<PermissionResult> {
    // Check each rule
    for (const rule of this.permissionRules) {
      if (this.matchesRule(request, connectorId, rule)) {
        return {
          granted: true,
          requiredApproval: rule.requiresApproval ? 'user' : 'none',
        };
      }
    }

    // Default: deny if no matching rule
    return {
      granted: false,
      reason: `No permission rule matches action "${request.action}" on connector "${connectorId}"`,
      requiredApproval: 'admin',
    };
  }

  /**
   * matchesRule — Check if a request matches a permission rule
   */
  private matchesRule(
    request: ActionRequest,
    connectorId: string,
    rule: PermissionRule
  ): boolean {
    // Check connector pattern
    if (!this.globMatch(connectorId, rule.connectorPattern)) {
      return false;
    }

    // Check action pattern
    if (!this.globMatch(request.action, rule.actionPattern)) {
      return false;
    }

    return true;
  }

  /**
   * globMatch — Simple glob pattern matching
   *
   * Supports '*' wildcard matching.
   */
  private globMatch(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === value) return true;

    // Simple wildcard support
    const parts = pattern.split('*');
    if (parts.length === 2) {
      return value.startsWith(parts[0] ?? '') && value.endsWith(parts[1] ?? '');
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * findConnectorForAction — Find a connector that supports an action
   */
  private findConnectorForAction(action: string): IActionConnector | undefined {
    for (const connector of this.connectors.values()) {
      if (connector.capabilities.some(c => c.name === action)) {
        return connector;
      }
    }
    return undefined;
  }
}
