/**
 * Phase B — Reactive Node
 *
 * createReactiveNode() builds a reactive node with two layers:
 *
 *  PUBLIC SURFACE  — only framework concepts a consumer needs
 *    state (tracking+readonly proxy), actions, isParent, isChild, child(), destroy()
 *
 *  INTERNAL STATE  — hidden behind a module-private Symbol (REACTIVE_NODE_INTERNAL)
 *    _owner, _lifecycle, _removeChild
 *    These are NOT enumerable properties on the node object.
 *    External code that does not import the Symbol cannot reach them.
 *
 * Reactive machinery (tracking proxy, mutation proxy, scope interaction) is
 * entirely internal to this module. No reactive internals appear on the
 * public node surface.
 *
 * Field key format:  "<nodeId>:<fieldName>"   e.g. "n3:balance"
 *
 * Phase A invariants preserved:
 *  - node.state is a readonly proxy (throws on external set)
 *  - Actions are the only mutation boundary
 *  - Lifecycle guards are unchanged
 *  - Cascade destroy (post-order) is unchanged
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
// Internal-slot Symbol
//
// This Symbol is the only key under which internal node state is stored on
// the public node object. It is exported so that:
//   - reactive-home.ts can access _removeRoot during destroy
//   - tests can cast to ReactiveInternalNode and read _owner/_lifecycle
//
// Consumers who import only from index.ts never see this Symbol.
// ---------------------------------------------------------------------------

export const REACTIVE_NODE_INTERNAL = Symbol('ReactiveNodeInternal')

/** The shape of the internal slot stored under REACTIVE_NODE_INTERNAL. */
export interface ReactiveNodeInternalSlot {
  readonly _owner: Owner
  readonly _lifecycle: LifecycleState
  _removeChild(child: ReactiveNode<StateRecord, ActionsMap<StateRecord>>): void

  /**
   * Phase C — destroy hooks.
   *
   * Framework-internal code (e.g. the Grant/Relationship system) can register
   * callbacks here that are called synchronously when the node is destroyed.
   * This allows Phase C to clean up Relationships and Grants tied to a node
   * without modifying the public Node API or the destroy() method signature.
   *
   * Callbacks are called AFTER children are destroyed but BEFORE the node's
   * own lifecycle transitions to 'destroyed'.
   *
   * NOT part of the public Node interface.
   */
  readonly _onDestroy: Set<() => void>
}

// ---------------------------------------------------------------------------
// Types — PUBLIC and INTERNAL node interfaces
// ---------------------------------------------------------------------------

/**
 * ReactiveNode — the PUBLIC consumer-facing interface.
 *
 * Contains only the framework concepts a consumer legitimately uses.
 * Internal implementation details are NOT on this surface.
 */
export interface ReactiveNode<
  S extends StateRecord,
  A extends ActionsMap<S>,
> {
  readonly state: ReadonlyState<S>
  readonly actions: BoundActions<S, A>
  readonly isParent: boolean
  readonly isChild: boolean
  destroy(): void
  child<CS extends StateRecord, CA extends ActionsMap<CS>>(
    def: ReactiveNodeDefinition<CS, CA>
  ): ReactiveNode<CS, CA>
}

/**
 * ReactiveInternalNode — the INTERNAL interface used by framework code.
 *
 * Extends ReactiveNode by adding the REACTIVE_NODE_INTERNAL slot.
 * The slot holds _owner, _lifecycle, and _removeChild.
 * NOT exported from index.ts.
 *
 * Internal framework code (reactive-home.ts) and Phase B tests that verify
 * internal invariants import this type directly from reactive-node.ts.
 */
export interface ReactiveInternalNode<
  S extends StateRecord,
  A extends ActionsMap<S>,
> extends ReactiveNode<S, A> {
  // Override child() so internal callers get the full internal type back.
  child<CS extends StateRecord, CA extends ActionsMap<CS>>(
    def: ReactiveNodeDefinition<CS, CA>
  ): ReactiveInternalNode<CS, CA>

  // The internal slot is stored under a Symbol key — not discoverable via
  // string enumeration, `in` checks with string names, or JSON.stringify.
  readonly [REACTIVE_NODE_INTERNAL]: ReactiveNodeInternalSlot
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
 * get  — plain read from raw (also tracks if a subscriber is running)
 * set  — lifecycle guard → Object.is check → write → notifyField
 * deleteProperty — lifecycle guard → reject (state shape must not change)
 *
 * NOTE: No defineProperty trap. Reflect.set internally calls [[DefineOwnProperty]]
 * for new properties on a Proxy target; a trap there would break normal assignment.
 * The set trap's lifecycle guard is sufficient.
 */
function makeMutatingProxy<S extends StateRecord>(
  raw: S,
  nodeId: string,
  scope: ReactiveScope,
  getLifecycle: () => LifecycleState
): S {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') {
        scope.trackField(`${nodeId}:${prop}`)
      }
      return Reflect.get(target, prop, receiver)
    },
    set(target, prop, value, receiver) {
      if (getLifecycle() === 'destroyed') {
        throw new Error(
          `Cannot mutate state: node "${nodeId}" has been destroyed. ` +
          `A reference to ctx.state must not be used after the action completes.`
        )
      }
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
    deleteProperty(_target, prop) {
      if (getLifecycle() === 'destroyed') {
        throw new Error(
          `Cannot delete state property "${String(prop)}": node "${nodeId}" has been destroyed.`
        )
      }
      throw new TypeError(
        `Cannot delete state property "${String(prop)}" — state shape must not change.`
      )
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
  const _trackingProxy = makeTrackingReadonlyProxy(_rawState, nodeId, scope)
  const _mutatingProxy = makeMutatingProxy(_rawState, nodeId, scope, () => _lifecycle)

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
          fn({ state: _mutatingProxy }, ...(args as never[]))
        },
        enumerable: true,
        configurable: false,
        writable: false,
      })
    }
  }

  // -- Internal slot --------------------------------------------------------
  // Stored under the module-private REACTIVE_NODE_INTERNAL Symbol.
  // Not visible via string-keyed enumeration or `in` checks.
  const _onDestroyHooks = new Set<() => void>()
  const internalSlot: ReactiveNodeInternalSlot = {
    get _owner(): Owner { return owner },
    get _lifecycle(): LifecycleState { return _lifecycle },
    _removeChild(child: ReactiveNode<StateRecord, ActionsMap<StateRecord>>): void {
      _children.delete(child as ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>)
    },
    get _onDestroy(): Set<() => void> { return _onDestroyHooks },
  }

  // -- Public node object ---------------------------------------------------
  // Contains ONLY the public surface. Internal state is behind the Symbol slot.
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
        node as unknown as Owner,
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
        // Owner is another ReactiveNode — call _removeChild via the internal slot.
        const ownerNode = owner as unknown as ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>
        ownerNode[REACTIVE_NODE_INTERNAL]._removeChild(
          node as unknown as ReactiveNode<StateRecord, ActionsMap<StateRecord>>
        )
      } else {
        const homeRemoveFn = (owner as ReactiveHomeOwnerInternal)._removeRoot
        if (typeof homeRemoveFn === 'function') {
          homeRemoveFn(node as unknown as ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>)
        }
      }

      // Phase C — fire destroy hooks (Relationship/Grant cleanup).
      // Snapshot to avoid mutation-during-iteration if a hook removes itself.
      const hooks = [..._onDestroyHooks]
      _onDestroyHooks.clear()
      for (const hook of hooks) {
        hook()
      }

      // Clean all subscriptions that depend on this node's fields.
      scope.disposeByPrefix(`${nodeId}:`)

      _lifecycle = 'destroyed'
    },

    // The internal slot — Symbol-keyed, not enumerable on the object.
    get [REACTIVE_NODE_INTERNAL](): ReactiveNodeInternalSlot {
      return internalSlot
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
