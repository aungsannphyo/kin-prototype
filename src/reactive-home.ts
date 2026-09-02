/**
 * Phase B + Phase C — Reactive Home
 *
 * createReactiveHome() is the Phase B entry point, extended with Phase C
 * authorization support.
 *
 * It owns:
 *  - A ReactiveScope (the reactive kernel)
 *  - A set of root ReactiveInternalNodes
 *  - A GrantStore (Phase C: manages Relationships and Grants)
 *
 * Phase C subscribeAs() flow:
 *  1. authorize()           — throws if no Relationship or no active Grant
 *  2. createAuthorizedView() — wraps target.state behind a capability filter proxy
 *  3. scope.createSubscriber(() => run(view))  — normal Phase B subscriber
 *  4. linkSubscriberToGrant()  — revocation disposes the subscriber
 *
 * The callback receives only the AuthorizedView, never the raw ReactiveNode.
 * State mutation path is completely unchanged:
 *   notifyField → _fieldIndex → schedule → flush
 */

import type { StateRecord, ActionsMap, ReactiveHome } from './types.js'
import {
  createReactiveNode,
  type ReactiveNode,
  type ReactiveInternalNode,
  type ReactiveHomeOwnerInternal,
  type ReactiveNodeDefinition,
} from './reactive-node.js'
import { createReactiveScope } from './reactive.js'
import type { Subscriber } from './reactive.js'
import { HOME_OWNER_TAG } from './types.js'
import { createGrantStore } from './grant.js'
import { authorize, createAuthorizedView, linkSubscriberToGrant } from './authorization.js'
import { GRANT_INTERNAL, type GrantInternal, type Relationship, type AuthorizedView } from './relationship.js'

export function createReactiveHome(): ReactiveHome {
  const scope = createReactiveScope()
  const grantStore = createGrantStore()

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

    relationship(
      source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
      target: ReactiveNode<StateRecord, ActionsMap<StateRecord>>
    ): Relationship {
      if (_destroyed) {
        throw new Error('Cannot create a relationship on a destroyed Home.')
      }
      return grantStore.createRelationship(source, target)
    },

    subscribeAs<S extends StateRecord, A extends ActionsMap<S>>(
      source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
      target: ReactiveNode<S, A>,
      run: (view: AuthorizedView<S>) => void
    ): Subscriber {
      if (_destroyed) {
        throw new Error('Cannot subscribe on a destroyed Home.')
      }

      // Step 1: Authorization check — throws if no Relationship or no active Grant.
      const grant = authorize(
        source,
        target as ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
        grantStore
      )

      // Step 2: Build the capability-filtered view.
      // readSnapshot is the defensive copy captured at Grant-creation time.
      const readSnapshot = (grant as GrantInternal)[GRANT_INTERNAL].readSnapshot
      const view = createAuthorizedView<S>(target, readSnapshot)

      // Step 3: Create the subscriber using the existing Phase B machinery.
      // The callback receives only the AuthorizedView — never the raw target.
      const sub = scope.createSubscriber(() => run(view))

      // Step 4: Link the subscriber to the grant so revocation disposes it.
      linkSubscriberToGrant(grant, () => {
        scope.disposeSubscriber(sub)
      })

      return sub
    },

    destroy(): void {
      if (_destroyed) return

      // Destroy all root nodes — each calls scope.disposeByPrefix() for its fields.
      const rootSnapshot = [..._roots]
      for (const root of rootSnapshot) {
        root.destroy()
      }
      _roots.clear()

      // Phase C: destroy all Relationships (revokes all Grants, disposes linked subs).
      grantStore.destroyAll()

      // Clean any remaining zero-dep or stale subscribers.
      scope.disposeAll()

      _destroyed = true
    },
  }

  return home
}
