/**
 * Phase E.1 — View Type Definitions
 *
 * This module defines the IMMUTABLE, PLATFORM-INDEPENDENT descriptor types
 * that represent a view description tree. These types are consumed later by
 * a DOM renderer (Phase E.2+) but have zero dependency on browser APIs.
 *
 * Key design decisions:
 *
 * 1. ChildNode is a discriminated union. Every variant has a literal `type`
 *    field so renderers can exhaustively switch on it.
 *
 * 2. Function-valued props come in two kinds that MUST be distinguishable by
 *    a renderer without guessing:
 *
 *      ReactiveGetter  — a zero-argument function that returns a display value.
 *                        Used for data bindings: value: () => node.state.count
 *
 *      EventHandler    — a function that handles a DOM event.
 *                        Created exclusively via the handler() factory which
 *                        stamps the EVENT_HANDLER_BRAND symbol.
 *                        Used for callbacks: onClick: handler(e => ...)
 *
 *    The renderer calls isEventHandler() to discriminate at runtime. The
 *    onXxx naming convention is recommended (and documented) but the brand
 *    is the authoritative discriminant — it does not rely on key-name regexes.
 *
 * 3. All node interfaces use `readonly` on every field and `readonly` children
 *    arrays so TypeScript enforces immutability at the type level. Factories
 *    additionally Object.freeze() values at runtime.
 *
 * NOT in scope for Phase E.1:
 *   - No DOM types (HTMLElement, Event, Node, document, window, etc.)
 *   - No reactive subscriptions (function values are stored, not subscribed to)
 *   - No Virtual DOM diffing
 *   - No component instances or lifecycle hooks
 */

// ---------------------------------------------------------------------------
// Event handler brand
//
// A Symbol used exclusively to tag functions created by handler().
// This is the only runtime mechanism used to distinguish EventHandler from
// ReactiveGetter. Exported so the renderer can import and check it.
// ---------------------------------------------------------------------------

export const EVENT_HANDLER_BRAND: unique symbol = Symbol('EventHandler')

// ---------------------------------------------------------------------------
// PropValue
//
// The set of values that may appear as element prop values.
//
//   Primitive    — a static string, number, boolean, or null
//   ReactiveGetter — a zero-arg function returning a primitive (data binding)
//   EventHandler   — a branded function (event callback)
//
// The union is intentionally conservative. Renderers only need to handle these
// cases. New variants (e.g. Ref) would be added explicitly, not silently.
// ---------------------------------------------------------------------------

/** A zero-argument function that returns a displayable primitive value. */
export type ReactiveGetter = () => string | number | boolean | null

/**
 * An event callback, distinguished from ReactiveGetter by the EVENT_HANDLER_BRAND
 * symbol property stamped by the handler() factory.
 *
 * The event argument is typed as `unknown` because Phase E.1 has no browser
 * dependency. The DOM renderer will cast to the appropriate event type when
 * attaching listeners.
 */
export interface EventHandler {
  (event: unknown): void
  readonly [EVENT_HANDLER_BRAND]: true
}

/** Every value that may appear as an element prop. */
export type PropValue = string | number | boolean | null | ReactiveGetter | EventHandler

// ---------------------------------------------------------------------------
// ChildNode union — the core View descriptor type
// ---------------------------------------------------------------------------

/**
 * An immutable descriptor for a single UI node.
 * The discriminant is the `type` literal so renderers can use exhaustive switch.
 */
export type ChildNode =
  | ElementNode
  | TextNode
  | FragmentNode
  | ConditionalNode

// ---------------------------------------------------------------------------
// ElementNode
// ---------------------------------------------------------------------------

/**
 * Represents a named HTML/XML element with props and children.
 *
 * `tag`      — element tag name (e.g. 'div', 'button', 'input')
 * `props`    — prop map; values may be static primitives, reactive getters,
 *              or branded event handlers
 * `children` — ordered child descriptors; readonly to prevent external mutation
 */
export interface ElementNode {
  readonly type: 'element'
  readonly tag: string
  readonly props: Readonly<Record<string, PropValue>>
  readonly children: readonly ChildNode[]
}

// ---------------------------------------------------------------------------
// TextNode
// ---------------------------------------------------------------------------

/**
 * Represents a text content node.
 *
 * `value` may be:
 *   - a plain string  → static text
 *   - a ReactiveGetter → the renderer subscribes and updates text on change
 *
 * NOTE: the getter is stored as-is at this stage — no subscription is created.
 */
export interface TextNode {
  readonly type: 'text'
  readonly value: string | ReactiveGetter
}

// ---------------------------------------------------------------------------
// FragmentNode
// ---------------------------------------------------------------------------

/**
 * A grouping node with no corresponding DOM element.
 * Used to return multiple sibling nodes from a single expression.
 */
export interface FragmentNode {
  readonly type: 'fragment'
  readonly children: readonly ChildNode[]
}

// ---------------------------------------------------------------------------
// ConditionalNode
// ---------------------------------------------------------------------------

/**
 * Represents a condition-based branch in the view tree.
 *
 * `when`      — zero-arg predicate; evaluated by the renderer to pick a branch
 * `then`      — descriptor to render when the condition is truthy
 * `otherwise` — optional descriptor when falsy (renders nothing if absent)
 *
 * The condition function is stored but NOT subscribed to in Phase E.1.
 * The DOM renderer (Phase E.2+) will subscribe and mount/unmount branches.
 */
export interface ConditionalNode {
  readonly type: 'conditional'
  readonly when: () => boolean
  readonly then: ChildNode
  readonly otherwise?: ChildNode
}
