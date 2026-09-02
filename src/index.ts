/**
 * Phase A — Public exports
 *
 * Only expose what callers need. Internal helpers (_removeChild, _owner, etc.)
 * are accessible via the InternalNode interface but are not re-exported under
 * friendly names to discourage direct use.
 */

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
