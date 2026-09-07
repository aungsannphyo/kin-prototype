/**
 * Phase E.2 — Public DOM renderer types
 *
 * Render records, listener lists, and subscription handles stay module-private
 * in renderer.ts. This file exports only the consumer-facing mount surface.
 */

import type { ChildNode } from '../view/types.js'

/**
 * A View definition is a zero-arg function that returns a descriptor tree.
 * It is invoked once at mount — it is not a reactive effect and not a component.
 */
export type View = () => ChildNode

/** Handle returned by mount(). `unmount` is idempotent. */
export interface MountHandle {
  unmount(): void
}
