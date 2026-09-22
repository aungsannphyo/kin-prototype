/**
 * Public exports — kin@0.1.0-alpha.1
 *
 * Phase A  — createHome(), Node, Home (non-reactive)
 * Phase B  — createReactiveHome(), ReactiveNode, fine-grained reactive kernel
 * Phase C  — Relationship, Grant, Capability, KinAuthError, AuthorizedView
 * Phase D  — Nested capability path authorization (dot-separated paths)
 * Phase E  — View descriptors (element/text/fragment/when/handler) + DOM mount()
 */

// ---------------------------------------------------------------------------
// Phase A
// ---------------------------------------------------------------------------

export { createHome } from './home.js'

export type {
  Home,
  Node,
  NodeDefinition,
  ActionContext,
  ActionsMap,
  BoundActions,
  ReadonlyState,
  StateRecord,
  LifecycleState,
} from './types.js'

// ---------------------------------------------------------------------------
// Phase B
// ---------------------------------------------------------------------------

export { createReactiveHome } from './reactive-home.js'

export type {
  ReactiveHome,
  ReactiveNode,
  ReactiveNodeDefinition,
  Subscriber,
} from './types.js'

// ---------------------------------------------------------------------------
// Phase C
// ---------------------------------------------------------------------------

export {
  capability,
  KinAuthError,
} from './relationship.js'

export type {
  Capability,
  Grant,
  Relationship,
  KinAuthErrorCode,
  AuthorizedView,
} from './relationship.js'

// ---------------------------------------------------------------------------
// Phase E — View / Rendering
// ---------------------------------------------------------------------------

export { mount } from './dom/index.js'

export type {
  View,
  MountHandle,
} from './dom/index.js'

export {
  element,
  text,
  fragment,
  when,
  each,
  handler,
  isEventHandler,
  isChildNode,
} from './view/index.js'

export type {
  ChildNode,
  ElementNode,
  TextNode,
  FragmentNode,
  ConditionalNode,
  EachNode,
  KeyExtractor,
  ItemRenderer,
  PropValue,
  ReactiveGetter,
  EventHandler,
} from './view/index.js'
