/**
 * Public exports
 *
 * Phase A  — createHome()
 * Phase B  — createReactiveHome()
 */

// ---------------------------------------------------------------------------
// Phase A
// ---------------------------------------------------------------------------

export { createHome } from './home.js'

export type {
  Home,
  InternalNode as Node,
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
  ReactiveScope,
} from './types.js'
