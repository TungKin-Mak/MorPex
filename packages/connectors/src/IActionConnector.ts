/**
 * IActionConnector — Action Connector Interface (v11)
 *
 * Standard contract for all connectors in the Action Infrastructure Plane.
 * Connectors provide safe, validated access to external systems
 * and are the "physical hands" of the MorPex OS.
 *
 * @packageDocumentation
 */

import type { ActionRequest, ActionResult, ConnectorMeta, ConnectorCapability } from './types.js';

/**
 * IActionConnector — Standard connector interface
 *
 * Every connector must implement this interface to be
 * compatible with the MorPex v11 Action Infrastructure.
 */
export interface IActionConnector {
  /** Unique connector identifier */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Connector version */
  readonly version: string;

  /** Supported capabilities */
  readonly capabilities: ConnectorCapability[];

  /**
   * initialize — Initialize the connector
   *
   * Called once when the connector is loaded/registered.
   * Performs any setup needed (e.g., checking tool availability).
   */
  initialize(): Promise<void>;

  /**
   * validate — Validate that an action request can be executed
   *
   * Checks parameters, permissions, and preconditions.
   *
   * @param request - The action request to validate
   * @returns true if the request can proceed
   */
  validate(request: ActionRequest): Promise<boolean>;

  /**
   * execute — Execute an action
   *
   * @param request - The action request to execute
   * @returns Action execution result
   */
  execute(request: ActionRequest): Promise<ActionResult>;

  /**
   * rollback — Rollback a previously executed action
   *
   * @param actionId - The action identifier to rollback
   */
  rollback(actionId: string): Promise<void>;

  /**
   * getMeta — Get connector metadata
   */
  getMeta(): ConnectorMeta;
}
