/**
 * Phase C — Authorization
 *
 * validateGrant() is called ONCE at subscription-creation time.
 * It is NOT called on every state mutation.
 *
 * The caller supplies the Grant explicitly. There is no implicit "first active
 * Grant" search. This makes authorization deterministic when multiple Grants
 * exist on the same Relationship.
 *
 * Authorization flow:
 *
 *   subscribeAs(source, target, grant, run)
 *         │
 *         ▼
 *   validateGrant(source, target, grant)
 *         │
 *   ┌─────┴────────────────────┐
 *   │ grant.isRevoked          │ → throw KinAuthError('GRANT_REVOKED')
 *   │ rel.isDestroyed          │ → throw KinAuthError('RELATIONSHIP_DESTROYED')
 *   │ rel.source !== source OR │
 *   │ rel.target !== target    │ → throw KinAuthError('GRANT_MISMATCH')
 *   │ all pass                 │ → proceed
 *   └──────────────────────────┘
 *         │
 *         ▼
 *   createAuthorizedView(target, grant[GRANT_INTERNAL].readSnapshot)
 *         │ returns AuthorizedView<S>
 *         ▼
 *   scope.createSubscriber(() => run(view))   ← unchanged Phase B machinery
 *         │
 *         ▼
 *   linkSubscriberToGrant(grant, disposer)
 *
 * Capability enforcement — read path:
 *
 *   view.state.balance
 *         │
 *         ▼  capability filter proxy
 *   readSnapshot.has('balance') ?
 *         │ NO  → throw KinAuthError('FIELD_NOT_GRANTED')
 *         │ YES ↓
 *   Reflect.get(target.state, 'balance')   ← existing Phase B tracking proxy
 *         │
 *         ▼
 *   scope.trackField('n3:balance')          ← Phase B dep registration
 *
 * Capability depth:
 *   Phase C Capability is TOP-LEVEL FIELD based.
 *   capability(['profile']) authorizes the 'profile' key only.
 *   If 'profile' holds a nested object, the entire object is readable through
 *   the view (since the top-level key is authorized). Sub-fields are NOT
 *   independently controlled. Deep authorization is a Phase D concern.
 *
 * State mutation path is completely unchanged:
 *   notifyField → _fieldIndex → schedule → flush
 *   No Grant/Relationship traversal at mutation time.
 */

import type { ReactiveNode } from './reactive-node.js'
import type { StateRecord, ActionsMap, ReadonlyState } from './types.js'
import {
  KinAuthError,
  GRANT_INTERNAL,
  type Grant,
  type GrantInternal,
  type AuthorizedView,
} from './relationship.js'

// ---------------------------------------------------------------------------
// validateGrant
//
// Validates that the explicitly supplied Grant may authorize a subscription
// from source → target. Throws KinAuthError on any validation failure.
//
// Validation order:
//  1. GRANT_REVOKED        — grant has been revoked
//  2. RELATIONSHIP_DESTROYED — grant's relationship is destroyed
//  3. GRANT_MISMATCH       — grant belongs to a different source or target
// ---------------------------------------------------------------------------

export function validateGrant(
  source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
  target: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
  grant: Grant
): void {
  if (grant.isRevoked) {
    throw new KinAuthError(
      'GRANT_REVOKED',
      'Cross-node access denied: the supplied Grant has been revoked.'
    )
  }

  const rel = grant.relationship

  if (rel.isDestroyed) {
    throw new KinAuthError(
      'RELATIONSHIP_DESTROYED',
      'Cross-node access denied: the Grant\'s Relationship has been destroyed.'
    )
  }

  if (rel.source !== source || rel.target !== target) {
    throw new KinAuthError(
      'GRANT_MISMATCH',
      'Cross-node access denied: the Grant was issued for a different source or target node.'
    )
  }
}

// ---------------------------------------------------------------------------
// createAuthorizedView
//
// Builds the capability-filtered, Phase-B-tracked state surface passed to
// the subscribeAs() callback.
//
// Phase C Capability is TOP-LEVEL FIELD based:
//   - capability(['balance']) authorizes reading the 'balance' key.
//   - capability(['profile']) authorizes reading the 'profile' key.
//     If 'profile' holds { name, password }, the entire object is accessible
//     because 'profile' is the authorized top-level key. Sub-fields are NOT
//     independently controlled in Phase C.
//   - Deep/nested path authorization (profile.password) is a Phase D concern.
//
// The returned AuthorizedView<S>:
//   - Exposes only `.state`
//   - `.state` proxy on each string field get:
//       1. Checks readSnapshot.has(fieldName) → throws FIELD_NOT_GRANTED if denied
//       2. Delegates to target.state[fieldName] → hits Phase B tracking proxy
//          → scope.trackField(nodeId:fieldName) dep registration
//   - Exposes NO actions, destroy, child, isParent, isChild, or internal Symbols
//   - Is Object.freeze()'d — property injection is rejected
//
// readSnapshot is captured at Grant-creation time (independent defensive copy).
// Mutating the original Capability after Grant issuance cannot expand access.
// ---------------------------------------------------------------------------

export function createAuthorizedView<S extends StateRecord>(
  target: ReactiveNode<S, ActionsMap<S>>,
  readSnapshot: ReadonlySet<string>
): AuthorizedView<S> {
  const filteredState = new Proxy(target.state as object, {
    get(_stateProxy, prop) {
      if (typeof prop === 'string') {
        if (!readSnapshot.has(prop)) {
          throw new KinAuthError(
            'FIELD_NOT_GRANTED',
            `Cross-node access denied: field "${prop}" is not in the Grant's Capability.`
          )
        }
        // Delegate to the existing Phase B tracking proxy — registers the dep.
        return (target.state as Record<string, unknown>)[prop]
      }
      // Non-string props (Symbol.toPrimitive etc.) — pass through silently.
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

  return Object.freeze({ state: filteredState }) as AuthorizedView<S>
}

// ---------------------------------------------------------------------------
// linkSubscriberToGrant
//
// Registers a disposer so that revoking the Grant immediately disposes the
// subscriber. Called once after scope.createSubscriber().
// ---------------------------------------------------------------------------

export function linkSubscriberToGrant(grant: Grant, dispose: () => void): void {
  const internal = (grant as GrantInternal)[GRANT_INTERNAL]
  if (grant.isRevoked) {
    // Guard: grant was revoked between validateGrant() and this call.
    dispose()
    return
  }
  internal.linkedDisposers.add(dispose)
}
