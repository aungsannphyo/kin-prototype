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
 *   when(cond, consequent, otherwise?)     → ConditionalNode
 *   handler(fn)                      → EventHandler
 *   isEventHandler(v)                → type predicate
 */

import {
  EVENT_HANDLER_BRAND,
  CHILD_NODE_BRAND,
  type ChildNode,
  type ElementNode,
  type TextNode,
  type FragmentNode,
  type ConditionalNode,
  type EachNode,
  type KeyExtractor,
  type ItemRenderer,
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
 * the DOM event listener.
 */
export function handler(fn: (event: unknown) => void): EventHandler {
  const h = fn as EventHandler
  Object.defineProperty(h, EVENT_HANDLER_BRAND, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  })
  return h
}

// ---------------------------------------------------------------------------
// isEventHandler() — runtime type guard
// ---------------------------------------------------------------------------

/**
 * Check whether a prop value is an EventHandler (stamped by handler()).
 *
 * Used by renderers to determine whether to attach an event listener vs.
 * setting an attribute or creating a reactive text binding:
 *   - EventHandler   → addEventListener
 *   - ReactiveGetter → subscribe and update dynamically
 *   - primitive      → set as a static attribute
 */
export function isEventHandler(v: PropValue): v is EventHandler {
  return typeof v === 'function' && (v as Partial<EventHandler>)[EVENT_HANDLER_BRAND] === true
}

// ---------------------------------------------------------------------------
// isChildNode() — runtime type guard
// ---------------------------------------------------------------------------

/**
 * Check whether a value is a ChildNode descriptor.
 *
 * Used by element() to authoritatively distinguish between props and children
 * when props are omitted.
 */
export function isChildNode(v: unknown): v is ChildNode {
  if (v === null || typeof v !== 'object') return false
  if ((v as Partial<ChildNode>)[CHILD_NODE_BRAND] === true) return true
  // Structural fallback for elements, fragments, conditionals, and keyed lists
  const type = (v as { type?: unknown }).type
  if (type === 'element' && typeof (v as { tag?: unknown }).tag === 'string') return true
  if (type === 'fragment' && Array.isArray((v as { children?: unknown }).children)) return true
  if (type === 'conditional' && typeof (v as { when?: unknown }).when === 'function') return true
  if (type === 'each' && typeof (v as { collection?: unknown }).collection === 'function') return true
  return false
}

// ---------------------------------------------------------------------------
// element() — ElementNode factory
// ---------------------------------------------------------------------------

/**
 * Create an immutable ElementNode descriptor without props.
 *
 * @param tag      HTML/XML element tag name
 * @param children Zero or more child ChildNode descriptors
 *
 * Example:
 *   element('div', text('Hello'))
 *   element('ul', element('li', text('Item 1')), element('li', text('Item 2')))
 */
export function element(
  tag: string,
  ...children: ChildNode[]
): ElementNode

/**
 * Create an immutable ElementNode descriptor with props.
 *
 * @param tag      HTML/XML element tag name
 * @param props    Prop map — may contain primitives, reactive getters, or EventHandlers
 * @param children Zero or more child ChildNode descriptors
 *
 * Example:
 *   element('div', { class: 'card' }, text('Hello'))
 *   element('button', { onClick: handler(() => {}) }, text('Click'))
 */
export function element(
  tag: string,
  props: Record<string, PropValue>,
  ...children: ChildNode[]
): ElementNode

/**
 * Implementation of element() handling both overloaded signatures.
 */
export function element(
  tag: string,
  propsOrFirstChild?: Record<string, PropValue> | ChildNode,
  ...remainingChildren: ChildNode[]
): ElementNode {
  let props: Readonly<Record<string, PropValue>>
  let children: readonly ChildNode[]

  if (propsOrFirstChild === undefined) {
    props = Object.freeze({})
    children = Object.freeze([])
  } else if (isChildNode(propsOrFirstChild)) {
    props = Object.freeze({})
    children = Object.freeze([propsOrFirstChild, ...remainingChildren])
  } else {
    props = Object.freeze({ ...propsOrFirstChild })
    children = Object.freeze([...remainingChildren])
  }

  return Object.freeze<ElementNode>({
    [CHILD_NODE_BRAND]: true,
    type: 'element',
    tag,
    props,
    children,
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
    [CHILD_NODE_BRAND]: true,
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
    [CHILD_NODE_BRAND]: true,
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
 * @param condition      Zero-arg predicate; truthy → render `consequentNode`
 * @param consequentNode Descriptor to render when condition is truthy
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
  consequentNode: ChildNode,
  otherwiseNode?: ChildNode,
): ConditionalNode {
  // exactOptionalPropertyTypes is enabled — only include `otherwise` key when
  // a value is actually provided, to avoid assigning `undefined` to a field
  // typed as `ChildNode` (not `ChildNode | undefined`).
  if (otherwiseNode !== undefined) {
    return Object.freeze<ConditionalNode>({
      [CHILD_NODE_BRAND]: true,
      type: 'conditional',
      when: condition,
      consequent: consequentNode,
      otherwise: otherwiseNode,
    })
  }

  return Object.freeze<ConditionalNode>({
    [CHILD_NODE_BRAND]: true,
    type: 'conditional',
    when: condition,
    consequent: consequentNode,
  })
}

// ---------------------------------------------------------------------------
// each() — EachNode factory
// ---------------------------------------------------------------------------

/**
 * Create an immutable EachNode descriptor for dynamic keyed list rendering.
 *
 * @param collection Reactive getter returning an iterable or array of items.
 * @param key        Function that derives a stable unique key for each item.
 * @param render     Factory function creating a ChildNode descriptor for an item.
 *
 * Example:
 *   each(
 *     () => node.state.todos,
 *     (todo) => todo.id,
 *     (todo) => TodoItemView(node, todo.id),
 *   )
 */
export function each<T>(
  collection: () => Iterable<T> | readonly T[],
  key: KeyExtractor<T>,
  render: ItemRenderer<T>,
): EachNode<T> {
  return Object.freeze<EachNode<T>>({
    [CHILD_NODE_BRAND]: true,
    type: 'each',
    collection,
    key,
    render: render as (item: unknown, index: () => number) => ChildNode,
  })
}
