/**
 * Phase C — Authorization
 *
 * The authorize() function is called ONCE when a cross-node subscription
 * is being created (in ReactiveHome.subscribeAs()).  It is NOT called on
 * every state mutation.
 *
 * Authorization flow:
 *
 *   subscribeAs(source, target, run)
 *         │
 *         ▼
 *   authorize(source, target, grantStore)
 *         │
 *   ┌─────┴──────────┐
 *   │ no Relationship │ → throw KinAuthError('NO_RELATIONSHIP')
 *   │ no active Grant │ → throw KinAuthError('NO_GRANT')
 *   │ Grant found     │ → return Grant
 *   └────────────────┘
 *         │
 *         ▼
 *   scope.createSubscriber(run)   ← unchanged Phase B machinery
 *         │
 *         ▼
 *   link subscriber disposer → grant[GRANT_INTERNAL].linkedDisposers
 *
 * After this point, state updates flow through the normal reactive path:
 *   notifyField → _fieldIndex → schedule → flush → subscriber runs
 *
 * There is NO grant/relationship traversal during state updates.
 *
 * Revocation path (when grant.revoke() is called):
 *   linkedDisposers are called → scope.disposeSubscriber(sub) runs
 *   → subscriber is gone, no more notifications
 */

import type { ReactiveNode } from './reactive-node.js'
import type { StateRecord, ActionsMap } from './types.js'
import type { GrantStore } from './grant.js'
import { KinAuthError, GRANT_INTERNAL, RELATIONSHIP_INTERNAL, type Grant, type GrantInternal } from './relationship.js'

// ---------------------------------------------------------------------------
// authorize
//
// Returns the first active Grant found for (source → target).
// Throws KinAuthError if no Relationship or no active Grant exists.
// ---------------------------------------------------------------------------

export function authorize(
  source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
  target: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
  grantStore: GrantStore
): Grant {

  // Find all Relationships from source to target.
  const relationships = grantStore.findRelationships(source, target)

  if (relationships.length === 0) {
    throw new KinAuthError(
      'NO_RELATIONSHIP',
      'Cross-node access denied: no Relationship exists between source and target.'
    )
  }

  // Find the first Relationship that has at least one active (non-revoked) Grant.
  for (const rel of relationships) {
    if (rel.isDestroyed) continue
    const internal = (rel as unknown as {
      [key: symbol]: { activeGrants: Set<Grant> }
    })[RELATIONSHIP_INTERNAL as unknown as symbol]

    if (internal === undefined) continue

    for (const g of internal.activeGrants) {
      if (!g.isRevoked) {
        return g
      }
    }
  }

  throw new KinAuthError(
    'NO_GRANT',
    'Cross-node access denied: a Relationship exists but no active Grant has been issued.'
  )
}

// ---------------------------------------------------------------------------
// linkSubscriberToGrant
//
// After a subscriber is created, register a disposer so that revoking the
// Grant also disposes the subscriber.
//
// @param grant     The Grant that authorized this subscription.
// @param dispose   The function that disposes the subscriber
//                  (calls scope.disposeSubscriber(sub)).
// ---------------------------------------------------------------------------

export function linkSubscriberToGrant(grant: Grant, dispose: () => void): void {
  const internal = (grant as GrantInternal)[GRANT_INTERNAL]
  // If the grant was somehow already revoked between authorize() returning
  // and this call (extremely unlikely but possible in theory), dispose immediately.
  if (grant.isRevoked) {
    dispose()
    return
  }
  internal.linkedDisposers.add(dispose)
}
