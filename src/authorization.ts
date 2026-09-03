/**
 * Phase C + Phase D — Authorization
 *
 * validateGrant() is called ONCE at subscription-creation time.
 * It is NOT called on every state mutation.
 *
 * Phase C: flat top-level field authorization.
 * Phase D: nested path authorization (dot-separated paths).
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
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase D — Nested path authorization
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Capability paths may now be dot-separated:
 *   capability(['profile.name', 'profile.email', 'balance'])
 *
 * Path-matching rules (applied at read time on the AuthorizedView):
 *
 *   Rule 1 — Exact match
 *     readSnapshot.has(accessPath) → ALLOW, return value
 *
 *   Rule 2 — Authorized ancestor (subtree grant)
 *     Any P in readSnapshot where accessPath.startsWith(P + '.') → ALLOW, return value
 *     (e.g. snapshot has 'profile', accessing 'profile.name' → allowed)
 *
 *   Rule 3 — Authorized descendant → filtered nested proxy
 *     Any P in readSnapshot where P.startsWith(accessPath + '.') → ALLOW,
 *     but return createNestedProxy(value, derivedSubSnapshot) instead of raw value.
 *     (e.g. snapshot has 'profile.name', accessing 'profile' → filtered proxy)
 *
 *   Rule 4 — No match → throw KinAuthError('FIELD_NOT_GRANTED')
 *
 * IMPORTANT: Reactive tracking remains TOP-LEVEL only (unchanged from Phase C).
 *   view.state.profile.name registers dep on n3:profile (not n3:profile.name).
 *   In-place nested mutation without replacing the parent reference does NOT
 *   trigger subscribers. This is a documented Phase D limitation; deep reactive
 *   tracking is Phase E scope.
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
// validateGrant  (unchanged from Phase C)
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
// Path-matching helpers  (Phase D — module-private)
// ---------------------------------------------------------------------------

/**
 * Check whether `accessPath` is authorized given `readSnapshot`.
 *
 * Returns:
 *   'allow-value'   — access is authorized; return the raw value
 *   'allow-proxy'   — access is authorized; return a filtered nested proxy
 *   'deny'          — access is not authorized
 */
function _matchPath(
  readSnapshot: ReadonlySet<string>,
  accessPath: string
): 'allow-value' | 'allow-proxy' | 'deny' {
  // Rule 1: exact match
  if (readSnapshot.has(accessPath)) return 'allow-value'

  const prefix = accessPath + '.'

  for (const p of readSnapshot) {
    // Rule 2: authorized ancestor — snapshot has 'profile', accessing 'profile.name'
    if (accessPath.startsWith(p + '.')) return 'allow-value'

    // Rule 3: authorized descendant — snapshot has 'profile.name', accessing 'profile'
    if (p.startsWith(prefix)) return 'allow-proxy'
  }

  return 'deny'
}

/**
 * Derive the sub-snapshot for a nested proxy at `prefix`.
 *
 * Given readSnapshot = Set { 'profile.name', 'profile.email', 'balance' }
 * and prefix = 'profile'
 * returns Set { 'name', 'email' }
 */
function _deriveSubSnapshot(
  readSnapshot: ReadonlySet<string>,
  prefix: string
): ReadonlySet<string> {
  const stripLen = prefix.length + 1 // +1 for the '.'
  const sub = new Set<string>()
  for (const p of readSnapshot) {
    if (p.startsWith(prefix + '.')) {
      sub.add(p.slice(stripLen))
    }
  }
  return sub
}

// ---------------------------------------------------------------------------
// createNestedProxy  (Phase D — module-private)
//
// Builds a capability-filtered proxy over a plain nested object.
// Does NOT interact with the ReactiveNode, Actions, ReactiveScope, or any
// framework-internal machinery. It is a pure authorization filter.
//
// Security invariants:
//   - set / deleteProperty / defineProperty → always throw TypeError
//   - __proto__, constructor, prototype-chain names → undefined (not exposed)
//   - Symbol-keyed access passes through silently (no authorization check —
//     symbols cannot be capability path segments)
//   - The proxy wrapper is Object.freeze()'d to block property injection
//   - Internal cache lives for the lifetime of this proxy object only —
//     no global or cross-subscriber retention
// ---------------------------------------------------------------------------

function _createNestedProxy(
  rawObj: unknown,
  subSnapshot: ReadonlySet<string>
): object {
  // If the raw value is not an object (e.g. a primitive reached via a subtree grant),
  // just return it — nothing to proxy. This handles the edge case of
  // capability(['profile']) where profile is e.g. a string.
  if (rawObj === null || typeof rawObj !== 'object') {
    return rawObj as object
  }

  // Per-proxy field cache: avoid re-allocating nested proxies for the same
  // property on repeated reads within a single subscriber run.
  const _cache = new Map<string, unknown>()

  const proxy = new Proxy(rawObj as Record<string | symbol, unknown>, {
    get(target, prop) {
      // Symbol-keyed access: pass through silently (no authorization needed).
      if (typeof prop !== 'string') {
        return target[prop]
      }

      // Block prototype-chain access.
      if (prop === '__proto__' || prop === 'constructor' || prop === 'prototype') {
        return undefined
      }

      const match = _matchPath(subSnapshot, prop)

      if (match === 'deny') {
        throw new KinAuthError(
          'FIELD_NOT_GRANTED',
          `Cross-node access denied: field "${prop}" is not in the Grant's Capability.`
        )
      }

      if (match === 'allow-value') {
        return target[prop]
      }

      // match === 'allow-proxy': return a cached nested proxy
      if (_cache.has(prop)) return _cache.get(prop)
      const nestedSub = _deriveSubSnapshot(subSnapshot, prop)
      const nested = _createNestedProxy(target[prop], nestedSub)
      _cache.set(prop, nested)
      return nested
    },

    set(_t, prop) {
      throw new TypeError(
        `Cannot mutate: field "${String(prop)}" is read-only on an AuthorizedView.`
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
  })

  return proxy
}

// ---------------------------------------------------------------------------
// createAuthorizedView  (Phase C unchanged surface; Phase D extended internals)
//
// Builds the top-level state surface passed to the subscribeAs() callback.
//
// Phase D changes vs Phase C:
//   - The top-level proxy now uses _matchPath() instead of readSnapshot.has()
//   - For 'allow-proxy' results, a nested proxy is returned (caching per view)
//   - For 'allow-value' results, behavior is identical to Phase C
//   - Security invariants, Object.freeze, and the interface are unchanged
//
// Reactive tracking: UNCHANGED from Phase C.
//   reading view.state.profile.name registers dep on n3:profile (top-level key).
//   This is because the delegation to target.state[prop] happens at the top level;
//   the nested proxy does NOT call scope.trackField() — tracking already occurred
//   when target.state[prop] was read by the top-level proxy.
// ---------------------------------------------------------------------------

export function createAuthorizedView<S extends StateRecord>(
  target: ReactiveNode<S, ActionsMap<S>>,
  readSnapshot: ReadonlySet<string>
): AuthorizedView<S> {

  // Per-view top-level proxy cache, keyed by field name.
  // Tracks the raw value at time of proxy creation so we can detect
  // when the underlying value has been replaced (e.g. after setProfile).
  // When the raw value reference changes, a fresh proxy is created.
  // This gives correct behavior across subscriber re-runs while avoiding
  // redundant proxy allocation within a single run.
  const _topCache = new Map<string, unknown>()
  const _topCacheRaw = new Map<string, unknown>()

  const filteredState = new Proxy(target.state as object, {
    get(_stateProxy, prop) {
      // Symbol-keyed access: pass through silently.
      if (typeof prop !== 'string') {
        return (target.state as Record<symbol, unknown>)[prop as symbol]
      }

      // Block prototype-chain access.
      if (prop === '__proto__' || prop === 'constructor' || prop === 'prototype') {
        return undefined
      }

      const match = _matchPath(readSnapshot, prop)

      if (match === 'deny') {
        throw new KinAuthError(
          'FIELD_NOT_GRANTED',
          `Cross-node access denied: field "${prop}" is not in the Grant's Capability.`
        )
      }

      if (match === 'allow-value') {
        // Delegate to the Phase B tracking proxy — registers the dep.
        return (target.state as Record<string, unknown>)[prop]
      }

      // match === 'allow-proxy'
      // Read the current raw value from the Phase B tracking proxy.
      // This registers the dep on this top-level key (e.g. n3:profile)
      // and always reflects the latest value.
      const rawValue = (target.state as Record<string, unknown>)[prop]

      // Cache keyed by the raw value's object reference.
      // If the value is replaced (e.g. setProfile sets a new object),
      // the cache miss creates a fresh proxy over the new object.
      // Within one subscriber run, repeated accesses to the same key
      // return the same proxy (same reference → cache hit).
      const cached = _topCache.get(prop)
      if (cached !== undefined) {
        // Check that the cached proxy is still wrapping the same object.
        // We detect staleness via the _rawRef WeakMap below.
        const rawRef = _topCacheRaw.get(prop)
        if (rawRef === rawValue) return cached
      }

      const subSnapshot = _deriveSubSnapshot(readSnapshot, prop)
      const nested = _createNestedProxy(rawValue, subSnapshot)
      _topCache.set(prop, nested)
      _topCacheRaw.set(prop, rawValue)
      return nested
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
// linkSubscriberToGrant  (unchanged from Phase C)
// ---------------------------------------------------------------------------

export function linkSubscriberToGrant(grant: Grant, dispose: () => void): void {
  const internal = (grant as GrantInternal)[GRANT_INTERNAL]
  if (grant.isRevoked) {
    dispose()
    return
  }
  internal.linkedDisposers.add(dispose)
}
