/**
 * Phase E.1 — View Module Public Entry Point
 *
 * Import from this file to access the Phase E.1 View API:
 *
 *   import { element, text, fragment, when, handler, isEventHandler } from '../src/view/index.js'
 *
 * A future `kin-prototype/view` package subpath export may be added in a later
 * phase once the `"exports"` field in package.json is configured. For now,
 * direct import from this path is the canonical approach (consistent with how
 * existing Phase A–D tests import from `../src/index.js`).
 *
 * Exported factories:
 *   element()        → ElementNode descriptor
 *   text()           → TextNode descriptor
 *   fragment()       → FragmentNode descriptor
 *   when()           → ConditionalNode descriptor
 *   handler()        → EventHandler (branded event callback)
 *   isEventHandler() → runtime type guard
 *
 * Exported types:
 *   ChildNode, ElementNode, TextNode, FragmentNode, ConditionalNode
 *   PropValue, ReactiveGetter, EventHandler
 *   EVENT_HANDLER_BRAND
 *
 * NOT exported (intentionally private to this module):
 *   No ReactiveNode internals, ReactiveScope, Grant, Relationship,
 *   or any Phase A–D implementation detail.
 */

// ---------------------------------------------------------------------------
// Factories + runtime utilities
// ---------------------------------------------------------------------------

export {
  element,
  text,
  fragment,
  when,
  handler,
  isEventHandler,
} from './factory.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  ChildNode,
  ElementNode,
  TextNode,
  FragmentNode,
  ConditionalNode,
  PropValue,
  ReactiveGetter,
  EventHandler,
} from './types.js'

// ---------------------------------------------------------------------------
// EVENT_HANDLER_BRAND — exported so renderers can import and use it directly
// as an alternative to isEventHandler() when they need the symbol itself.
// ---------------------------------------------------------------------------

export { EVENT_HANDLER_BRAND } from './types.js'
