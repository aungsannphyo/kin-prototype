/**
 * Phase E.1 — View Factory Functions
 *
 * Public factory functions that create immutable ChildNode descriptors.
 * All returned objects are Object.freeze()'d and children arrays are
 * defensively copied so callers cannot mutate the internal representation.
 *
 * Functions exported:
 *   element(tag, props, ...children) → ElementNode
 *   text(value)                      → TextNode
 *   fragment(...children)            → FragmentNode
 *   when(cond, then, otherwise?)     → ConditionalNode
 *   handler(fn)                      → EventHandler
 *   isEventHandler(v)                → type predicate
 */

import {
  EVENT_HANDLER_BRAND,
  type ChildNode,
  type ElementNode,
  type TextNode,
  type FragmentNode,
  type ConditionalNode,
  type PropValue,
  type ReactiveGetter,
  type EventHandler,
} from './types.js'

// ---------------------------------------------------------------------------
// handler() — wrap an event callback with the EventHandler brand
//
// The brand stamp is what allows isEventHandler() to distinguish an event
// callback from a ReactiveGetter. Callers should use this factory rather than
// constructing the brand manually.
//
// Example:
//   element('button', { onClick: handler(() => node.actions.increment()) })
// ---------------------------------------------------------------------------

/**
 * Wrap a callback function as a branded EventHandler.
 *
 * The returned function is callable and carries EVENT_HANDLER_BRAND = true
 * so that isEventHandler() can identify it at runtime.
 *
 * The `event` parameter is typed `unknown` because Phase E.1 has no DOM
 * dependency. The renderer will cast to the concrete event type when wiring
 * listeners.
 */
export function handler(fn: (event: unknown) => void): EventHandler {
  const h = fn as EventHandler
  // Stamp the brand. Object.defineProperty keeps it non-enumerable so it
  // does not appear in JSON.stringify or for..in loops.
  Object.defineProperty(h, EVENT_HANDLER_BRAND, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  })
  return h
}

// ---------------------------------------------------------------------------
// isEventHandler() — runtime discriminant
//
// Returns true if and only if v was created by handler(). Renderers call this
// when iterating props to decide whether to attach an event listener or to
// create a reactive binding.
// ---------------------------------------------------------------------------

/**
 * Type guard: returns true if `v` is a branded EventHandler (created by handler()).
 *
 * Use this in the renderer to distinguish:
 *   - EventHandler  → wire as event listener
 *   - ReactiveGetter → wire as reactive data binding
 *   - primitive      → set as a static attribute
 */
export function isEventHandler(v: PropValue): v is EventHandler {
  return typeof v === 'function' && (v as Partial<EventHandler>)[EVENT_HANDLER_BRAND] === true
}

// ---------------------------------------------------------------------------
// element() — ElementNode factory
// ---------------------------------------------------------------------------

/**
 * Create an immutable ElementNode descriptor.
 *
 * @param tag      HTML/XML element tag name
 * @param props    Prop map — may contain primitives, reactive getters, or
 *                 EventHandlers (created via handler())
 * @param children Zero or more child ChildNode descriptors
 *
 * @returns A frozen ElementNode whose children array is a defensive copy.
 *
 * Example — static element:
 *   element('div', {}, text('Hello'))
 *
 * Example — with reactive prop and event handler:
 *   element('button', {
 *     disabled: () => store.state.loading,
 *     onClick: handler(() => store.actions.submit()),
 *   }, text('Submit'))
 */
export function element(
  tag: string,
  props: Record<string, PropValue>,
  ...children: ChildNode[]
): ElementNode {
  // Defensive copy of props and freeze it.
  const frozenProps: Readonly<Record<string, PropValue>> = Object.freeze({ ...props })

  // Defensive copy of children — callers cannot mutate the internal array.
  const frozenChildren: readonly ChildNode[] = Object.freeze([...children])

  return Object.freeze<ElementNode>({
    type: 'element',
    tag,
    props: frozenProps,
    children: frozenChildren,
  })
}

// ---------------------------------------------------------------------------
// text() — TextNode factory
// ---------------------------------------------------------------------------

/**
 * Create an immutable TextNode descriptor.
 *
 * @param value Either a plain string (static text) or a zero-arg ReactiveGetter
 *              function. The getter is stored as-is; no subscription is created
 *              in Phase E.1.
 *
 * Example — static:
 *   text('Hello, world')
 *
 * Example — reactive (getter stored, not subscribed yet):
 *   text(() => String(counter.state.count))
 */
export function text(value: string | ReactiveGetter): TextNode {
  return Object.freeze<TextNode>({
    type: 'text',
    value,
  })
}

// ---------------------------------------------------------------------------
// fragment() — FragmentNode factory
// ---------------------------------------------------------------------------

/**
 * Create an immutable FragmentNode descriptor.
 *
 * A fragment groups multiple children without introducing a wrapping DOM
 * element. Equivalent to React's <></> or DocumentFragment.
 *
 * @param children Zero or more child ChildNode descriptors
 *
 * Example:
 *   fragment(
 *     text('Hello '),
 *     element('span', {}, text('World')),
 *   )
 */
export function fragment(...children: ChildNode[]): FragmentNode {
  const frozenChildren: readonly ChildNode[] = Object.freeze([...children])

  return Object.freeze<FragmentNode>({
    type: 'fragment',
    children: frozenChildren,
  })
}

// ---------------------------------------------------------------------------
// when() — ConditionalNode factory
// ---------------------------------------------------------------------------

/**
 * Create an immutable ConditionalNode descriptor.
 *
 * The condition function is stored as-is; NO subscription is created in Phase
 * E.1. The DOM renderer (Phase E.2+) will subscribe to it and mount/unmount
 * the appropriate branch when the condition changes.
 *
 * @param condition  Zero-arg predicate; truthy → render `thenNode`
 * @param thenNode   Descriptor to render when condition is truthy
 * @param otherwiseNode  Optional descriptor for falsy case; omit for "render nothing"
 *
 * Example — with else branch:
 *   when(
 *     () => counter.state.count > 0,
 *     text('Positive'),
 *     text('Zero or negative'),
 *   )
 *
 * Example — without else:
 *   when(
 *     () => user.state.isLoggedIn,
 *     element('nav', {}, text('Dashboard')),
 *   )
 */
export function when(
  condition: () => boolean,
  thenNode: ChildNode,
  otherwiseNode?: ChildNode,
): ConditionalNode {
  // exactOptionalPropertyTypes is enabled — only include `otherwise` key when
  // a value is actually provided, to avoid assigning `undefined` to a field
  // typed as `ChildNode` (not `ChildNode | undefined`).
  if (otherwiseNode !== undefined) {
    return Object.freeze<ConditionalNode>({
      type: 'conditional',
      when: condition,
      then: thenNode,
      otherwise: otherwiseNode,
    })
  }

  return Object.freeze<ConditionalNode>({
    type: 'conditional',
    when: condition,
    then: thenNode,
  })
}
