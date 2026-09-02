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
// Node — PUBLIC consumer-facing interface
//
// Exposes only framework concepts a consumer legitimately needs.
// Internal implementation details (_owner, _lifecycle, _removeChild) are
// NOT part of this surface.
// ---------------------------------------------------------------------------

export interface Node<
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
  ): Node<CS, CA>
}

// ---------------------------------------------------------------------------
// InternalNode — framework-internal interface
//
// Extends the public Node with members needed by the runtime implementation.
// NOT exported from index.ts. Internal code (home.ts, node.ts, reactive-node.ts)
// uses this type directly. Tests that verify internal invariants must import
// this type explicitly from types.ts, not through the public index.
// ---------------------------------------------------------------------------

export interface InternalNode<
  S extends StateRecord,
  A extends ActionsMap<S>,
> extends Node<S, A> {
  // Override child() to return InternalNode so internal callers get the full type.
  child<CS extends StateRecord, CA extends ActionsMap<CS>>(
    def: NodeDefinition<CS, CA>
  ): InternalNode<CS, CA>

  // -------------------------------------------------------------------------
  // Internal surface — prefixed with _ to signal framework-internal use.
  // NOT part of the public Node API exported to consumers.
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
  ): Node<S, A>

  /**
   * Destroy Home and all root nodes it owns.
   */
  destroy(): void
}

// ===========================================================================
// Phase B — Reactive type contracts
// ===========================================================================

import type { Subscriber } from './reactive.js'
// ReactiveScope is intentionally NOT re-exported — it is an internal
// implementation detail. Exposing it would allow consumers to call
// scope.notifyField() directly, bypassing the Action boundary.
import type {
  ReactiveNode,
  ReactiveNodeDefinition,
} from './reactive-node.js'
import type { Relationship, AuthorizedView } from './relationship.js'

export type { Subscriber }
// Export the PUBLIC ReactiveNode type only.
// ReactiveInternalNode is NOT exported — it is framework-internal.
export type { ReactiveNode, ReactiveNodeDefinition }

// ---------------------------------------------------------------------------
// ReactiveHome — same shape as Home but creates ReactiveNodes
// ---------------------------------------------------------------------------

export interface ReactiveHome {
  /**
   * Create a root-level reactive node.
   */
  node<S extends StateRecord, A extends ActionsMap<S>>(
    def: ReactiveNodeDefinition<S, A>
  ): ReactiveNode<S, A>

  /**
   * Subscribe to a reactive node.
   * The callback runs immediately (registering deps) then re-runs whenever
   * a dependency field changes.
   * Returns the Subscriber handle — pass to unsubscribe() to clean up.
   */
  subscribe(run: () => void): Subscriber

  /**
   * Dispose a subscriber created by subscribe().
   */
  unsubscribe(sub: Subscriber): void

  /**
   * Returns the promise for the current flush cycle.
   * Resolves immediately if nothing is pending.
   * Use in tests: await home.flush()
   */
  flush(): Promise<void>

  /**
   * Phase C — Create a Relationship between two nodes.
   *
   * A Relationship represents "source is connected to target" — it does NOT
   * by itself grant access. Access is mediated by Grants issued against the
   * Relationship.
   *
   * @param source Node that will seek access.
   * @param target Node being accessed.
   * @returns The Relationship object, which can be used to issue Grants.
   */
  relationship(
    source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
    target: ReactiveNode<StateRecord, ActionsMap<StateRecord>>
  ): Relationship

  /**
   * Phase C — Create an authorized cross-node subscription.
   *
   * Performs an authorization check (requires a Relationship and an active Grant
   * from source → target) then builds an AuthorizedView of the target.
   *
   * The callback receives only the AuthorizedView<S> — a capability-filtered,
   * Phase-B-tracked state surface. It cannot reach the real ReactiveNode,
   * its internals, or any field not listed in the Grant's Capability.
   *
   * Reading an allowed field:   works, registers Phase B dependency normally.
   * Reading a denied field:     throws KinAuthError('FIELD_NOT_GRANTED').
   * Writing through the view:   always throws TypeError.
   *
   * The subscription is automatically disposed when the Grant is revoked or
   * the Relationship is destroyed. Re-granting does NOT restore old subs.
   *
   * @throws KinAuthError if no Relationship exists or no active Grant is found.
   */
  subscribeAs<S extends StateRecord, A extends ActionsMap<S>>(
    source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
    target: ReactiveNode<S, A>,
    run: (view: AuthorizedView<S>) => void
  ): Subscriber

  /**
   * Destroy Home and all root nodes (and their subscriptions).
   * Phase C: also destroys all Relationships and Grants.
   */
  destroy(): void
}
