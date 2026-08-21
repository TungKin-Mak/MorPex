/**
 * MorPex v11 — Connector Infrastructure
 *
 * Action Infrastructure Plane: Connectors provide safe, validated
 * access to external systems and are the "physical hands" of the OS.
 *
 * @packageDocumentation
 */

// ── Types ──
export type {
  ActionRequest,
  ActionResult,
  ConnectorCapability,
  ConnectorMeta,
  ConnectorConfig,
  PermissionResult,
  PermissionRule,
} from './types.js';

// ── Interfaces ──
export type { IActionConnector } from './IActionConnector.js';

// ── Base Connector ──
export { BaseConnector } from './BaseConnector.js';

// ── Concrete Connectors ──
export { FileSystemConnector } from './FileSystemConnector.js';
export { ShellConnector } from './ShellConnector.js';

// ── 安全子进程执行（防御性模式 · 与 core/secureExec 同源，独立包内联）──
export { scrubEnv, runCommand, makePrivateTempDir, randomPrivateFilePath, writeExclusive, cleanupTempDir } from './secureExec.js';
export type { ExecOutcome, RunCommandOptions } from './secureExec.js';

// ── Registry ──
export { ConnectorRegistry } from './ConnectorRegistry.js';
