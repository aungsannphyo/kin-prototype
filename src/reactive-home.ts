/**
 * Phase B + Phase C — Reactive Home
 *
 * createReactiveHome() is the Phase B entry point, extended with Phase C
 * authorization support.
 *
 * It owns:
 *  - A ReactiveScope (the reactive kernel)
 *  - A set of root ReactiveInternalNodes
 *  - A GrantStore (Phase C: creates and tracks Relationships)
 *
 * Phase C subscribeAs() flow:
 *  1. validateGrant()        — caller supplies Grant explicitly; throws on any mismatch
 *  2. createAuthorizedView() — wraps target.state behind capability filter proxy
 *  3. scope.createSubscriber(() => run(view))  — normal Phase B subscriber
 *  4. linkSubscriberToGrant() — revocation disposes the subscriber
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
import { validateGrant, createAuthorizedView, linkSubscriberToGrant } from './authorization.js'
import { GRANT_INTERNAL, type GrantInternal, type Grant, type Relationship, type AuthorizedView } from './relationship.js'
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
      grant: Grant,
      run: (view: AuthorizedView<S>) => void
    ): Subscriber {
      if (_destroyed) {
        throw new Error('Cannot subscribe on a destroyed Home.')
      }

      // Step 1: Validate the explicitly supplied Grant.
      // Throws GRANT_REVOKED, RELATIONSHIP_DESTROYED, or GRANT_MISMATCH on failure.
      validateGrant(
        source,
        target as ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
        grant
      )

      // Step 2: Build the capability-filtered view using the Grant's read snapshot.
      const readSnapshot = (grant as GrantInternal)[GRANT_INTERNAL].readSnapshot
      const view = createAuthorizedView<S>(target, readSnapshot)

      // Step 3: Create the subscriber using existing Phase B machinery.
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
