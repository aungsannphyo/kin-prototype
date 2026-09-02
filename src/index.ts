/**
 * Public exports
 *
 * Phase A  — createHome()
 * Phase B  — createReactiveHome()
 * Phase C  — Relationship, Grant, Capability, authorization
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
} from './relationship.js'
