/**
 * Phase B — Reactive Node
 *
 * createReactiveNode() wraps createNode() (Phase A) and layers three things
 * on top:
 *
 *  1. TRACKING PROXY — replaces the Phase A readonly proxy with a new proxy
 *     that also calls scope.trackField() on every get, so reads inside a
 *     subscriber automatically register field-level dependencies.
 *
 *  2. MUTATION PROXY — replaces the raw state object passed into actions via
 *     ctx.state.  On every set it:
 *       a. Compares old/new with Object.is (skip notification if equal)
 *       b. Writes the new value
 *       c. Calls scope.notifyField() so affected subscribers are scheduled
 *     The mutation proxy is only active while an action is executing.
 *     No code path outside an action ever touches it.
 *
 *  3. DESTROY HOOK — when the node is destroyed, scope.disposeByPrefix() is
 *     called with this node's field-key prefix, removing every subscription
 *     that touches this node's state from both reactive indexes.
 *
 * Field key format:  "<nodeId>:<fieldName>"
 *   e.g. "n3:balance"
 *
 * This file has NO knowledge of batching — batching is handled entirely
 * inside the scheduler in reactive.ts (queueMicrotask + _pending Set).
 * Actions simply call scope.notifyField() for each mutated field; the
 * scheduler deduplicates subscribers automatically.
 *
 * Phase A invariants are fully preserved:
 *  - node.state is still a readonly proxy (throws on external set)
 *  - Actions remain the only mutation boundary
 *  - Lifecycle guards are unchanged
 *  - Cascade destroy is unchanged
 */

import type {
  StateRecord,
  ActionsMap,
  NodeDefinition,
  BoundActions,
  ReadonlyState,
  Owner,
  LifecycleState,
} from './types.js'
import { HOME_OWNER_TAG } from './types.js'
import type { ReactiveScope } from './reactive.js'

// ---------------------------------------------------------------------------
// Types (local — the public types are in types.ts)
// ---------------------------------------------------------------------------

export interface ReactiveInternalNode<
  S extends StateRecord,
  A extends ActionsMap<S>,
> {
  // ---------- Public surface (same shape as Phase A InternalNode) ----------
  readonly state: ReadonlyState<S>
  readonly actions: BoundActions<S, A>
  readonly isParent: boolean
  readonly isChild: boolean
  destroy(): void
  child<CS extends StateRecord, CA extends ActionsMap<CS>>(
    def: ReactiveNodeDefinition<CS, CA>
  ): ReactiveInternalNode<CS, CA>

  // ---------- Internal surface ---------------------------------------------
  _removeChild(child: ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>): void
  readonly _owner: Owner
  readonly _lifecycle: LifecycleState
  /** The scope this node belongs to — exposed so reactive-home.ts can pass
   *  the same scope to child nodes. */
  readonly _scope: ReactiveScope
  /** The unique node-level prefix used to build field keys, e.g. "n3". */
  readonly _nodeId: string
}

export type ReactiveNodeDefinition<
  S extends StateRecord,
  A extends ActionsMap<S>,
> = NodeDefinition<S, A>

// ---------------------------------------------------------------------------
// Node ID generator  (module-level, monotonically increasing)
// ---------------------------------------------------------------------------

let _nextNodeId = 0
export function nextNodeId(): string {
  return `n${++_nextNodeId}`
}

// ---------------------------------------------------------------------------
// Proxy helpers
// ---------------------------------------------------------------------------

/**
 * Build the PUBLIC tracking+readonly proxy.
 *
 * get  — calls scope.trackField(nodeId + ":" + prop) then returns the value
 * set  — throws TypeError (readonly outside action)
 * deleteProperty — throws TypeError
 * defineProperty — throws TypeError
 */
function makeTrackingReadonlyProxy<S extends StateRecord>(
  raw: S,
  nodeId: string,
  scope: ReactiveScope
): ReadonlyState<S> {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') {
        scope.trackField(`${nodeId}:${prop}`)
      }
      return Reflect.get(target, prop, receiver)
    },
    set(_target, prop) {
      throw new TypeError(
        `Cannot mutate state directly. ` +
        `Property "${String(prop)}" is readonly outside of an action.`
      )
    },
    deleteProperty(_target, prop) {
      throw new TypeError(
        `Cannot delete state property "${String(prop)}" outside of an action.`
      )
    },
    defineProperty(_target, prop) {
      throw new TypeError(
        `Cannot define property "${String(prop)}" on readonly state outside of an action.`
      )
    },
  }) as ReadonlyState<S>
}

/**
 * Build the ACTION-INTERNAL mutation proxy.
 *
 * get  — plain read from raw (also tracks if a subscriber is running,
 *        though actions are normally not run inside subscribers)
 * set  — Object.is check → write → notifyField
 *
 * This proxy is created once per node and passed as ctx.state inside every
 * action on this node.  It always has write access — Phase A lifecycle guards
 * (assertActive) happen BEFORE the action function body runs.
 */
function makeMutatingProxy<S extends StateRecord>(
  raw: S,
  nodeId: string,
  scope: ReactiveScope
): S {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      // Track reads even inside actions so that if an action reads a field
      // and a subscriber is currently watching it works correctly.
      if (typeof prop === 'string') {
        scope.trackField(`${nodeId}:${prop}`)
      }
      return Reflect.get(target, prop, receiver)
    },
    set(target, prop, value, receiver) {
      if (typeof prop === 'string') {
        const fieldKey = `${nodeId}:${prop}`
        const prev = Reflect.get(target, prop, receiver)
        const didChange = !Object.is(prev, value)
        const result = Reflect.set(target, prop, value, receiver)
        if (didChange) {
          scope.notifyField(fieldKey)
        }
        return result
      }
      return Reflect.set(target, prop, value, receiver)
    },
  }) as S
}

// ---------------------------------------------------------------------------
// createReactiveNode
// ---------------------------------------------------------------------------

export function createReactiveNode<
  S extends StateRecord,
  A extends ActionsMap<S>,
>(
  def: ReactiveNodeDefinition<S, A>,
  owner: Owner,
  scope: ReactiveScope,
  nodeId: string = nextNodeId()
): ReactiveInternalNode<S, A> {

  // -- Raw state ------------------------------------------------------------
  const _rawState: S = (def.state !== undefined ? { ...def.state } : {}) as S

  // -- Proxies --------------------------------------------------------------
  // Public: readonly + tracking
  const _trackingProxy = makeTrackingReadonlyProxy(_rawState, nodeId, scope)
  // Action-internal: mutable + notifying
  const _mutatingProxy = makeMutatingProxy(_rawState, nodeId, scope)

  // -- Children & lifecycle -------------------------------------------------
  const _children = new Set<ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>>()
  let _lifecycle: LifecycleState = 'active'

  function assertActive(operation: string): void {
    if (_lifecycle === 'destroyed') {
      throw new Error(`Cannot ${operation} on a destroyed node.`)
    }
  }

  // -- Bound actions --------------------------------------------------------
  const _boundActions = {} as BoundActions<S, A>

  if (def.actions !== undefined) {
    const actionsSource = def.actions
    for (const key of Object.keys(actionsSource) as (keyof A & string)[]) {
      const fn = actionsSource[key]
      Object.defineProperty(_boundActions, key, {
        value: (...args: unknown[]) => {
          assertActive(`invoke action "${key}"`)
          // ctx.state is the MUTATING proxy so writes inside the action
          // automatically trigger notifyField.
          fn({ state: _mutatingProxy }, ...(args as never[]))
        },
        enumerable: true,
        configurable: false,
        writable: false,
      })
    }
  }

  // -- Node object ----------------------------------------------------------
  const node: ReactiveInternalNode<S, A> = {
    get state(): ReadonlyState<S> {
      return _trackingProxy
    },

    get actions(): BoundActions<S, A> {
      return _boundActions
    },

    get isParent(): boolean {
      return _children.size > 0
    },

    get isChild(): boolean {
      return !('_tag' in owner && owner._tag === HOME_OWNER_TAG)
    },

    child<CS extends StateRecord, CA extends ActionsMap<CS>>(
      childDef: ReactiveNodeDefinition<CS, CA>
    ): ReactiveInternalNode<CS, CA> {
      assertActive('create a child on')
      const childNode = createReactiveNode<CS, CA>(
        childDef,
        node as ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>,
        scope
      )
      _children.add(childNode as ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>)
      return childNode
    },

    destroy(): void {
      if (_lifecycle === 'destroyed') return

      // Post-order: children first.
      const childSnapshot = [..._children]
      for (const child of childSnapshot) {
        child.destroy()
      }
      _children.clear()

      // Detach from owner.
      if (!('_tag' in owner && owner._tag === HOME_OWNER_TAG)) {
        (owner as ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>)
          ._removeChild(node as ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>)
      } else {
        const homeRemoveFn = (owner as ReactiveHomeOwnerInternal)._removeRoot
        if (typeof homeRemoveFn === 'function') {
          homeRemoveFn(node as ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>)
        }
      }

      // Clean all subscriptions that depend on this node's fields.
      scope.disposeByPrefix(`${nodeId}:`)

      _lifecycle = 'destroyed'
    },

    _removeChild(child: ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>): void {
      _children.delete(child)
    },

    get _owner(): Owner {
      return owner
    },

    get _lifecycle(): LifecycleState {
      return _lifecycle
    },

    get _scope(): ReactiveScope {
      return scope
    },

    get _nodeId(): string {
      return nodeId
    },
  }

  return node
}

// ---------------------------------------------------------------------------
// HomeOwner internal shape for reactive nodes
// ---------------------------------------------------------------------------

export type ReactiveHomeOwnerInternal = {
  readonly _tag: typeof HOME_OWNER_TAG
  _removeRoot: (node: ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>) => void
}
