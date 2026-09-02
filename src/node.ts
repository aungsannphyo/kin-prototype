/**
 * Phase A — Node implementation
 *
 * Responsibilities:
 *  - Hold state (optional)
 *  - Hold bound actions (optional)
 *  - Track children
 *  - Derive isParent / isChild from ownership structure
 *  - Enforce readonly state outside actions via Proxy
 *  - Enforce mutable state inside actions via raw object
 *  - Cascade destroy (post-order: children first, then self)
 *  - Guard against mutation / child creation after destruction
 */

import type {
  StateRecord,
  ActionsMap,
  NodeDefinition,
  BoundActions,
  ReadonlyState,
  Owner,
  InternalNode,
  LifecycleState,
} from './types.js'
import { HOME_OWNER_TAG } from './types.js'

// ---------------------------------------------------------------------------
// Readonly proxy factory
//
// Wraps an internal mutable state object and throws on any set/delete.
// The proxy is a DIFFERENT object reference from the raw state.
// ---------------------------------------------------------------------------

function makeReadonlyProxy<S extends StateRecord>(raw: S): ReadonlyState<S> {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver)
    },
    set(_target, prop) {
      throw new TypeError(
        `Cannot mutate state directly. Property "${String(prop)}" is readonly outside of an action.`
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

// ---------------------------------------------------------------------------
// createNode
// ---------------------------------------------------------------------------

export function createNode<
  S extends StateRecord,
  A extends ActionsMap<S>,
>(
  def: NodeDefinition<S, A>,
  owner: Owner
): InternalNode<S, A> {
  // ---- Internal mutable state ---------------------------------------------
  // We need a real plain object for the raw state. If no state was provided,
  // we use an empty object cast so the generics stay consistent.
  const _rawState: S = (def.state !== undefined ? { ...def.state } : {}) as S

  // ---- Readonly proxy (public surface) ------------------------------------
  const _stateProxy = makeReadonlyProxy(_rawState)

  // ---- Children collection ------------------------------------------------
  const _children = new Set<InternalNode<StateRecord, ActionsMap<StateRecord>>>()

  // ---- Lifecycle ----------------------------------------------------------
  let _lifecycle: LifecycleState = 'active'

  function assertActive(operation: string): void {
    if (_lifecycle === 'destroyed') {
      throw new Error(
        `Cannot ${operation} on a destroyed node.`
      )
    }
  }

  // ---- Bound actions ------------------------------------------------------
  // Build a bound actions object that:
  //  1. Checks the node is still active
  //  2. Passes the raw (mutable) state through ctx
  //  3. Strips the leading ctx param from the caller's perspective
  const _boundActions = {} as BoundActions<S, A>

  if (def.actions !== undefined) {
    const actionsSource = def.actions
    for (const key of Object.keys(actionsSource) as (keyof A & string)[]) {
      const fn = actionsSource[key]
      // Using Object.defineProperty so we can name the function correctly.
      Object.defineProperty(_boundActions, key, {
        value: (...args: unknown[]) => {
          assertActive(`invoke action "${key}"`)
          fn({ state: _rawState }, ...(args as never[]))
        },
        enumerable: true,
        configurable: false,
        writable: false,
      })
    }
  }

  // ---- The node object ----------------------------------------------------
  const node: InternalNode<S, A> = {
    // -- Public state (readonly proxy) --------------------------------------
    get state(): ReadonlyState<S> {
      return _stateProxy
    },

    // -- Public actions -----------------------------------------------------
    get actions(): BoundActions<S, A> {
      return _boundActions
    },

    // -- Dynamic role derivation --------------------------------------------
    get isParent(): boolean {
      return _children.size > 0
    },

    get isChild(): boolean {
      // A node is a Child only if its owner is another Node, not Home.
      return !('_tag' in owner && owner._tag === HOME_OWNER_TAG)
    },

    // -- Child creation -----------------------------------------------------
    child<CS extends StateRecord, CA extends ActionsMap<CS>>(
      childDef: NodeDefinition<CS, CA>
    ): InternalNode<CS, CA> {
      assertActive('create a child on')

      const childNode = createNode<CS, CA>(childDef, node as InternalNode<StateRecord, ActionsMap<StateRecord>>)
      _children.add(childNode as InternalNode<StateRecord, ActionsMap<StateRecord>>)
      return childNode
    },

    // -- Destroy (post-order cascade) ---------------------------------------
    destroy(): void {
      if (_lifecycle === 'destroyed') {
        // Idempotent — silently ignore repeat calls.
        return
      }

      // Post-order: destroy children first (snapshot the set to avoid mutation during iteration).
      const childSnapshot = [..._children]
      for (const child of childSnapshot) {
        child.destroy()
      }
      // Children call _removeChild on us during their own destroy, so _children
      // should be empty by the time we finish the loop. Clear defensively.
      _children.clear()

      // Detach from owner.
      if (!('_tag' in owner && owner._tag === HOME_OWNER_TAG)) {
        // Owner is another Node — tell it to remove us.
        (owner as InternalNode<StateRecord, ActionsMap<StateRecord>>)._removeChild(
          node as InternalNode<StateRecord, ActionsMap<StateRecord>>
        )
      } else {
        // Owner is Home — Home manages its own root set; it will clean up
        // when it destroys, or the node removes itself via the home destroy path.
        // For a direct node.destroy() call from user code we need Home to
        // remove us from its root set. We do this via a symbol-keyed internal
        // method that Home attaches to the HomeOwner token at creation time.
        const homeRemoveFn = (owner as HomeOwnerInternal)._removeRoot
        if (typeof homeRemoveFn === 'function') {
          homeRemoveFn(node as InternalNode<StateRecord, ActionsMap<StateRecord>>)
        }
      }

      _lifecycle = 'destroyed'
    },

    // -- Internal helpers ---------------------------------------------------
    _removeChild(child: InternalNode<StateRecord, ActionsMap<StateRecord>>): void {
      _children.delete(child)
    },

    get _owner(): Owner {
      return owner
    },

    get _lifecycle(): LifecycleState {
      return _lifecycle
    },
  }

  return node
}

// ---------------------------------------------------------------------------
// HomeOwner internal shape (home.ts fills this in)
// ---------------------------------------------------------------------------

export type HomeOwnerInternal = {
  readonly _tag: typeof HOME_OWNER_TAG
  _removeRoot: (node: InternalNode<StateRecord, ActionsMap<StateRecord>>) => void
}
