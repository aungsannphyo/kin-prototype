/**
 * Phase B — Reactive Home
 *
 * createReactiveHome() is the Phase B entry point.
 *
 * It owns:
 *  - A ReactiveScope (the reactive kernel)
 *  - A set of root ReactiveInternalNodes
 *
 * It exposes:
 *  - node()        — creates root reactive nodes
 *  - subscribe()   — creates a subscriber in the shared scope
 *  - unsubscribe() — disposes a subscriber
 *  - flush()       — returns the current microtask flush promise (for tests)
 *  - destroy()     — destroys all root nodes (cleaning their subscriptions via
 *                    disposeByPrefix), then calls scope.disposeAll() to clean
 *                    any zero-dep subscribers that have no field deps to match on.
 */

import type { StateRecord, ActionsMap, ReactiveHome } from './types.js'
import {
  createReactiveNode,
  type ReactiveInternalNode,
  type ReactiveHomeOwnerInternal,
  type ReactiveNodeDefinition,  // STYLE-1 FIX: was a value import, must be type-only
} from './reactive-node.js'
import { createReactiveScope } from './reactive.js'
import type { Subscriber } from './reactive.js'
import { HOME_OWNER_TAG } from './types.js'

export function createReactiveHome(): ReactiveHome {
  const scope = createReactiveScope()

  const _roots = new Set<ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>>()
  let _destroyed = false

  const ownerToken: ReactiveHomeOwnerInternal = {
    _tag: HOME_OWNER_TAG,
    _removeRoot(node) {
      _roots.delete(node)
    },
  }

  const home: ReactiveHome = {
    node<S extends StateRecord, A extends ActionsMap<S>>(
      def: ReactiveNodeDefinition<S, A>
    ): ReactiveInternalNode<S, A> {
      if (_destroyed) {
        throw new Error('Cannot create a node on a destroyed Home.')
      }
      const n = createReactiveNode<S, A>(def, ownerToken, scope)
      _roots.add(n as ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>)
      return n
    },

    subscribe(run: () => void): Subscriber {
      if (_destroyed) {
        throw new Error('Cannot subscribe on a destroyed Home.')
      }
      return scope.createSubscriber(run)
    },

    unsubscribe(sub: Subscriber): void {
      scope.disposeSubscriber(sub)
    },

    flush(): Promise<void> {
      return scope.flushPromise()
    },

    destroy(): void {
      if (_destroyed) return

      // Destroy all root nodes. Each node.destroy() calls scope.disposeByPrefix()
      // for its own field prefix, cleaning up all field-dep subscribers.
      const rootSnapshot = [..._roots]
      for (const root of rootSnapshot) {
        root.destroy()
      }
      _roots.clear()

      // BUG-2 FIX: disposeByPrefix only catches subscribers that currently have
      // a dep on the node's fields. Zero-dep subscribers (and any edge-case
      // stale subscribers) are not reachable via the field prefix. Call
      // disposeAll() to flush everything remaining in the scope.
      scope.disposeAll()

      _destroyed = true
    },
  }

  return home
}
