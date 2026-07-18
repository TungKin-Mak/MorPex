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
