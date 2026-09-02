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
 *  - destroy()     — destroys all root nodes (which cleans their subscriptions)
 *                    then disposes any remaining subscribers in the scope
 */

import type { StateRecord, ActionsMap, ReactiveHome } from './types.js'
import {
  createReactiveNode,
  type ReactiveInternalNode,
  type ReactiveHomeOwnerInternal,
  ReactiveNodeDefinition
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

      const rootSnapshot = [..._roots]
      for (const root of rootSnapshot) {
        root.destroy()
      }
      _roots.clear()

      _destroyed = true
    },
  }

  return home
}
