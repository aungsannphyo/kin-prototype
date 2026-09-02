/**
 * Phase C — Authorization
 *
 * authorize() is called ONCE at subscription-creation time. It is NOT called
 * on every state mutation.
 *
 * After authorization succeeds, createAuthorizedView() wraps the target node's
 * existing tracking proxy behind a capability filter. The result is the ONLY
 * state surface the subscribeAs() callback receives — it cannot reach the
 * real ReactiveNode, its internal Symbols, raw state, or mutating proxy.
 *
 * Authorization + view creation flow:
 *
 *   subscribeAs(source, target, run)
 *         │
 *         ▼
 *   authorize(source, target, grantStore)   — throws if no Rel or no Grant
 *         │ returns Grant
 *         ▼
 *   createAuthorizedView(target, grant[GRANT_INTERNAL].readSnapshot)
 *         │ returns AuthorizedView<S>
 *         ▼
 *   scope.createSubscriber(() => run(view))   ← unchanged Phase B machinery
 *         │
 *         ▼
 *   linkSubscriberToGrant(grant, disposer)
 *
 * Read path after subscription is created:
 *
 *   view.state.balance
 *         │
 *         ▼  (capability filter proxy — new in Phase C security fix)
 *   readSnapshot.has('balance') ?
 *         │ NO  → throw KinAuthError('FIELD_NOT_GRANTED')
 *         │ YES ↓
 *   Reflect.get(target.state, 'balance')   ← hits existing tracking proxy
 *         │
 *         ▼
 *   scope.trackField('n3:balance')          ← Phase B dep registration
 *         │
 *         ▼
 *   returns value
 *
 * State mutation path is completely unchanged:
 *   notifyField → _fieldIndex → schedule → flush
 *   No Relationship/Grant traversal at mutation time.
 */

import type { ReactiveNode } from './reactive-node.js'
import type { StateRecord, ActionsMap, ReadonlyState } from './types.js'
import type { GrantStore } from './grant.js'
import {
  KinAuthError,
  GRANT_INTERNAL,
  RELATIONSHIP_INTERNAL,
  type Grant,
  type GrantInternal,
  type AuthorizedView,
} from './relationship.js'

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
  const relationships = grantStore.findRelationships(source, target)

  if (relationships.length === 0) {
    throw new KinAuthError(
      'NO_RELATIONSHIP',
      'Cross-node access denied: no Relationship exists between source and target.'
    )
  }

  for (const rel of relationships) {
    if (rel.isDestroyed) continue
    const internal = (rel as unknown as Record<symbol, { activeGrants: Set<Grant> }>)[
      RELATIONSHIP_INTERNAL as unknown as symbol
    ]
    if (internal === undefined) continue
    for (const g of internal.activeGrants) {
      if (!g.isRevoked) return g
    }
  }

  throw new KinAuthError(
    'NO_GRANT',
    'Cross-node access denied: a Relationship exists but no active Grant has been issued.'
  )
}

// ---------------------------------------------------------------------------
// createAuthorizedView
//
// Builds the restricted state surface passed to the subscribeAs() callback.
//
// The returned AuthorizedView<S> object:
//   - Exposes only `.state`
//   - `.state` is a Proxy that, on each field read:
//       1. Checks readSnapshot.has(fieldName) → throws FIELD_NOT_GRANTED if denied
//       2. Delegates to target.state[fieldName]  — this hits the existing Phase B
//          tracking proxy which calls scope.trackField(nodeId:fieldName)
//   - Exposes NO actions, destroy, child, isParent, isChild, or internal Symbols
//   - Is frozen so the consumer cannot attach arbitrary properties to it
//
// readSnapshot is the defensive copy captured at Grant-creation time, so
// mutating the original Capability after the Grant is issued cannot expand access.
// ---------------------------------------------------------------------------

export function createAuthorizedView<S extends StateRecord>(
  target: ReactiveNode<S, ActionsMap<S>>,
  readSnapshot: ReadonlySet<string>
): AuthorizedView<S> {
  // Build a Proxy in front of target.state (which is itself the tracking proxy).
  // On get: capability check first, then delegate to the tracking proxy.
  // On set/delete/defineProperty: always throw — the view is read-only.
  const filteredState = new Proxy(target.state as object, {
    get(_stateProxy, prop) {
      if (typeof prop === 'string') {
        if (!readSnapshot.has(prop)) {
          throw new KinAuthError(
            'FIELD_NOT_GRANTED',
            `Cross-node access denied: field "${prop}" is not in the Grant's Capability.`
          )
        }
        // Delegate to the real tracking proxy — this registers the Phase B dep.
        return (target.state as Record<string, unknown>)[prop]
      }
      // Non-string props (e.g. Symbol.toPrimitive) — pass through silently.
      return (target.state as Record<symbol, unknown>)[prop as symbol]
    },
    set(_t, prop) {
      throw new TypeError(
        `Cannot mutate state: field "${String(prop)}" is read-only on an AuthorizedView.`
      )
    },
    deleteProperty(_t, prop) {
      throw new TypeError(
        `Cannot delete field "${String(prop)}" from an AuthorizedView.`
      )
    },
    defineProperty(_t, prop) {
      throw new TypeError(
        `Cannot define property "${String(prop)}" on an AuthorizedView.`
      )
    },
  }) as ReadonlyState<S>

  // The view itself: a plain frozen object with only `state`.
  // Frozen so consumers cannot attach `.realNode = target` or similar.
  return Object.freeze({ state: filteredState }) as AuthorizedView<S>
}

// ---------------------------------------------------------------------------
// linkSubscriberToGrant
//
// After a subscriber is created, register a disposer so that revoking the
// Grant also disposes the subscriber immediately.
// ---------------------------------------------------------------------------

export function linkSubscriberToGrant(grant: Grant, dispose: () => void): void {
  const internal = (grant as GrantInternal)[GRANT_INTERNAL]
  if (grant.isRevoked) {
    // Guard against the race where grant was revoked between authorize()
    // returning and this call.
    dispose()
    return
  }
  internal.linkedDisposers.add(dispose)
}
