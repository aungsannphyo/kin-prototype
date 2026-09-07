/**
 * Phase E.2 — DOM renderer public entry
 *
 *   import { mount } from '../src/dom/index.js'
 *
 * View factories remain in `src/view/index.ts`.
 * This module does not re-export Phase A–D internals, RenderRecord,
 * ReactiveScope, Grant, or Relationship.
 */

export { mount } from './renderer.js'

export type { MountHandle, View } from './types.js'
