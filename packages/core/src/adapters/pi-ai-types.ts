/**
 * PiAITypesAdapter — isolates pi-ai TypeBox type exports
 *
 * Re-exports Type, Static, TSchema from pi-ai for use in tool definitions.
 * If pi-ai changes these exports, only this file needs updating.
 */

import { Type } from '@earendil-works/pi-ai';
import type { Static, TSchema } from '@earendil-works/pi-ai';

export { Type };
export type { Static, TSchema };

/**
 * optionalProp — wraps pi-ai's Type.Optional (exists at runtime, not in .d.ts)
 *
 * pi-ai's TypeBox-compatible type builder has Optional() at runtime but the
 * type declaration does not include it. This wrapper provides proper TypeScript
 * typing without requiring @ts-ignore at every call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TypeAny = Type as any;
export function optionalProp<T extends TSchema>(schema: T): T {
  return TypeAny.Optional(schema);
}
