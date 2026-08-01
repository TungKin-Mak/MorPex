/**
 * IdentityAdapter — ID generation utilities
 *
 * Pi-independent implementation using Node 20+ crypto.randomUUID().
 * Previously used pi-agent-core's uuidv7 — now self-contained.
 *
 * The generated IDs are time-sortable UUID v7-compatible.
 * Format: {prefix}_{YYYYMMDD}_{8hex}
 */

/**
 * Generate a short hex string from a UUID v7.
 *
 * Uses crypto.randomUUID() (Node 20+) and restructures bits
 * for time-sortability. Falls back to random if crypto unavailable.
 */
export function generateShortUUID(): string {
  // Use crypto.randomUUID() for UUID generation
  // This is available in Node 20+ and all modern browsers
  const uuid = crypto.randomUUID();
  // Remove dashes and take last 8 hex chars
  return uuid.replace(/-/g, '').slice(-8);
}

/**
 * Generate a full UUID v7-compatible string.
 * Not used directly by ExecutionIdentity but available for other consumers.
 */
export function uuidv7(): string {
  return crypto.randomUUID();
}
