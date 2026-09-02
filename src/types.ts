/**
 * Phase A — Core Type Definitions
 *
 * Intentionally minimal. No Bond, Grant, View, Reactivity, etc.
 */

// ---------------------------------------------------------------------------
// State shapes
// ---------------------------------------------------------------------------

/** Any plain-object state record. */
export type StateRecord = Record<string, unknown>

// ---------------------------------------------------------------------------
// Action Context
//
// Inside an Action, ctx.state is the raw mutable state.
// This is the ONLY mutation boundary in Phase A.
// ---------------------------------------------------------------------------

export type ActionContext<S extends StateRecord> = {
  readonly state: S
}

// ---------------------------------------------------------------------------
// Action definitions
//
// Each action receives (ctx, ...args) and returns void.
// The state type S is inferred from the node definition.
// ---------------------------------------------------------------------------

export type ActionFn<S extends StateRecord, Args extends unknown[]> = (
  ctx: ActionContext<S>,
  ...args: Args
) => void

/**
 * A map of named actions for a node with state S.
 * Each value is an ActionFn; the exact arg types are per-action.
 */
export type ActionsMap<S extends StateRecord> = {
  [key: string]: ActionFn<S, never[]>
}

// ---------------------------------------------------------------------------
// Node definition — what the caller passes to home.node() or node.child()
// ---------------------------------------------------------------------------

export type NodeDefinition<
  S extends StateRecord,
  A extends ActionsMap<S>,
> = {
  state?: S
  actions?: A
}

// ---------------------------------------------------------------------------
// Bound actions — the public action surface on a Node.
//
// For each action key K, strip the leading ctx parameter so callers just
// call node.actions.deposit(50) instead of node.actions.deposit(ctx, 50).
// ---------------------------------------------------------------------------

export type BoundActions<S extends StateRecord, A extends ActionsMap<S>> = {
  [K in keyof A]: A[K] extends ActionFn<S, infer Args> ? (...args: Args) => void : never
}

// ---------------------------------------------------------------------------
// Readonly state — the public state surface on a Node.
//
// Values are deeply readonly at the TypeScript level.
// Runtime enforcement is via a Proxy (see node.ts).
// ---------------------------------------------------------------------------

export type ReadonlyState<S extends StateRecord> = {
  readonly [K in keyof S]: S[K]
}

// ---------------------------------------------------------------------------
// Owner discriminant — used internally to track who owns a node.
// ---------------------------------------------------------------------------

/** Sentinel tag that identifies a Home instance as an owner. */
export const HOME_OWNER_TAG = Symbol('HomeOwner')

export type HomeOwner = { readonly _tag: typeof HOME_OWNER_TAG }

export type Owner = HomeOwner | InternalNode<StateRecord, ActionsMap<StateRecord>>

// ---------------------------------------------------------------------------
// Node lifecycle states
// ---------------------------------------------------------------------------

export type LifecycleState = 'active' | 'destroyed'

// ---------------------------------------------------------------------------
// Internal node interface — used between home.ts and node.ts.
// Not exported from index.ts.
// ---------------------------------------------------------------------------

export interface InternalNode<
  S extends StateRecord,
  A extends ActionsMap<S>,
> {
  /** Publicly readable readonly state proxy. */
  readonly state: ReadonlyState<S>

  /** Bound action methods (ctx pre-filled). */
  readonly actions: BoundActions<S, A>

  /** True if this node owns at least one child. */
  readonly isParent: boolean

  /** True if this node is owned by another Node (not Home). */
  readonly isChild: boolean

  /** Destroy this node and all its descendants (post-order). */
  destroy(): void

  /** Create a child node owned by this node. */
  child<CS extends StateRecord, CA extends ActionsMap<CS>>(
    def: NodeDefinition<CS, CA>
  ): InternalNode<CS, CA>

  // -------------------------------------------------------------------------
  // Internal surface — prefixed with _ to signal framework-internal use.
  // NOT part of the public API contract exported to users.
  // -------------------------------------------------------------------------

  /** Remove a child from this node's children list (called during child destroy). */
  _removeChild(child: InternalNode<StateRecord, ActionsMap<StateRecord>>): void

  /** The owner of this node. */
  readonly _owner: Owner

  /** Current lifecycle state. */
  readonly _lifecycle: LifecycleState
}

// ---------------------------------------------------------------------------
// Home interface
// ---------------------------------------------------------------------------

export interface Home {
  /**
   * Create a root-level node owned by Home.
   * Root nodes have isChild === false.
   */
  node<S extends StateRecord, A extends ActionsMap<S>>(
    def: NodeDefinition<S, A>
  ): InternalNode<S, A>

  /**
   * Destroy Home and all root nodes it owns.
   */
  destroy(): void
}
