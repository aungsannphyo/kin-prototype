/**
 * Phase C — Relationship, Grant, Capability
 *
 * A Relationship is a directional connection between two existing ReactiveNodes.
 * It answers "source is connected to target" — nothing more.  It does NOT by
 * itself grant access.  Access is mediated by Grants issued against a
 * Relationship.
 *
 * Key invariants encoded here:
 *  ✓ Creating a Relationship does NOT re-parent nodes.
 *  ✓ isParent / isChild / ownership are unaffected.
 *  ✓ A Relationship may be destroyed independently of its nodes.
 *  ✓ Destroying a Relationship revokes all its Grants (and linked subs).
 *  ✓ Destroying a Relationship does NOT destroy either participating Node.
 *  ✓ When either participating Node is destroyed, the Relationship is
 *    destroyed (and all Grants revoked, linked subs disposed).
 *  ✓ A Grant can be revoked without destroying the Relationship.
 *  ✓ A new Grant can be issued over the same Relationship after revocation.
 *  ✓ Owner authority is NOT representable as a Grant (no wildcard Capability).
 *
 * Exports (public):
 *   Capability, capability()
 *   Grant, Relationship, KinAuthError, KinAuthErrorCode
 *   GRANT_INTERNAL, RELATIONSHIP_INTERNAL
 *
 * Exports (internal factory):
 *   createRelationship()
 */

import type { ReactiveNode, ReactiveInternalNode } from './reactive-node.js'
import { REACTIVE_NODE_INTERNAL } from './reactive-node.js'
import type { StateRecord, ActionsMap, ReadonlyState } from './types.js'

// ---------------------------------------------------------------------------
// ID generators
// ---------------------------------------------------------------------------

let _nextRelId = 0
let _nextGrantId = 0

function nextRelId(): string { return `rel${++_nextRelId}` }
function nextGrantId(): string { return `grant${++_nextGrantId}` }

// ---------------------------------------------------------------------------
// KinAuthError
// ---------------------------------------------------------------------------

export type KinAuthErrorCode =
  | 'NO_RELATIONSHIP'
  | 'NO_GRANT'
  | 'GRANT_REVOKED'
  | 'RELATIONSHIP_DESTROYED'
  | 'NODE_DESTROYED'
  | 'INVALID_CAPABILITY'
  | 'FIELD_NOT_GRANTED'

export class KinAuthError extends Error {
  constructor(
    public readonly code: KinAuthErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'KinAuthError'
  }
}

// ---------------------------------------------------------------------------
// Capability
//
// Describes the access a Grant confers.
// `read` is a set of field names on the TARGET node (not "nodeId:field").
// An empty set means no read access is conferred.
//
// Owner authority is NOT representable as a Capability.
// There is no wildcard. The Capability model is intentionally minimal.
// ---------------------------------------------------------------------------

export interface Capability {
  /** Field names on the target node that the grantee may read. */
  readonly read: ReadonlySet<string>
}

/** Construct a Capability from an array of readable field names.
 *
 * The returned Capability captures a snapshot of `fields` at call time.
 * Mutating the original array afterwards does NOT affect the Capability.
 * The internal Set is intentionally not re-exported so consumers cannot
 * call .add() on it at runtime — they must go through this factory.
 */
export function capability(fields: string[]): Capability {
  // Defensive copy: snapshot at call time, independent of the input array.
  return { read: new Set(fields) }
}

// ---------------------------------------------------------------------------
// AuthorizedView
//
// The restricted view of a target node's state that is passed to the
// subscribeAs() callback. It exposes ONLY the fields permitted by the
// Grant's Capability. Reading a field outside the capability throws
// KinAuthError('FIELD_NOT_GRANTED').
//
// Crucially, the state property delegates to the target node's existing
// tracking proxy, so Phase B dependency registration (trackField) still
// occurs normally for all permitted reads.
//
// AuthorizedView intentionally exposes NO other node surface:
//   ✗ actions   — cannot invoke target actions through this view
//   ✗ destroy   — cannot destroy the target
//   ✗ child     — cannot navigate the ownership tree
//   ✗ isParent  — no structural info
//   ✗ isChild   — no structural info
// ---------------------------------------------------------------------------

export interface AuthorizedView<S extends StateRecord> {
  /** Capability-filtered, Phase-B-tracked state of the target node. */
  readonly state: ReadonlyState<S>
}

// ---------------------------------------------------------------------------
// Grant — PUBLIC interface
// ---------------------------------------------------------------------------

export interface Grant {
  /** Stable, opaque identifier. */
  readonly id: string

  /** The Relationship this Grant belongs to. */
  readonly relationship: Relationship

  /** The access capability this Grant confers. */
  readonly capability: Capability

  /** True once revoke() has been called. */
  readonly isRevoked: boolean

  /**
   * Revoke this Grant.
   *
   * Effects:
   *  - isRevoked becomes true.
   *  - All cross-node subscriptions authorized by this Grant are disposed.
   *  - The Relationship is NOT destroyed.
   *  - A new Grant may be issued over the same Relationship later.
   *
   * Idempotent.
   */
  revoke(): void
}

// ---------------------------------------------------------------------------
// Grant — INTERNAL extension
//
// The GRANT_INTERNAL symbol key is used by authorization.ts and
// reactive-home.ts to register subscriber disposer functions when a
// cross-node subscription is created.  It is NOT on the public Grant surface.
// ---------------------------------------------------------------------------

export const GRANT_INTERNAL = Symbol('GrantInternal')

export interface GrantInternal extends Grant {
  readonly [GRANT_INTERNAL]: {
    /** Disposer functions for subscribers authorized by this Grant. */
    readonly linkedDisposers: Set<() => void>
    /**
     * Defensive snapshot of the Capability's read set, taken at Grant-creation
     * time. Independent of the original Capability object — mutating the
     * original Capability after the Grant is issued does NOT affect this set.
     * Used by createAuthorizedView() to enforce field-level access.
     */
    readonly readSnapshot: ReadonlySet<string>
  }
}

// ---------------------------------------------------------------------------
// Relationship — PUBLIC interface
// ---------------------------------------------------------------------------

export interface Relationship {
  /** Stable, opaque identifier. */
  readonly id: string

  /** The node seeking access. */
  readonly source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>

  /** The node being accessed. */
  readonly target: ReactiveNode<StateRecord, ActionsMap<StateRecord>>

  /** True once destroy() has been called or a participating node was destroyed. */
  readonly isDestroyed: boolean

  /**
   * Issue a Grant over this Relationship.
   *
   * Throws KinAuthError('RELATIONSHIP_DESTROYED') if already destroyed.
   * Multiple Grants may be issued over the same Relationship.
   */
  grant(cap: Capability): Grant

  /**
   * Destroy this Relationship.
   *
   * Revokes all active Grants (disposing their linked subscriptions).
   * Does NOT destroy the source or target Nodes.
   * Idempotent.
   */
  destroy(): void
}

// ---------------------------------------------------------------------------
// Relationship — INTERNAL extension
// ---------------------------------------------------------------------------

export const RELATIONSHIP_INTERNAL = Symbol('RelationshipInternal')

export interface RelationshipInternal extends Relationship {
  readonly [RELATIONSHIP_INTERNAL]: {
    readonly activeGrants: Set<Grant>
  }
}

// ---------------------------------------------------------------------------
// _createGrant  (module-private factory)
// ---------------------------------------------------------------------------

function _createGrant(
  relationship: Relationship,
  cap: Capability,
  activeGrants: Set<Grant>
): GrantInternal {

  const _id = nextGrantId()
  const _linkedDisposers = new Set<() => void>()
  // Defensive snapshot: captured at grant-creation time.
  // Mutating cap.read after this point has zero effect on what this grant allows.
  const _readSnapshot: ReadonlySet<string> = new Set(cap.read)
  let _revoked = false

  // Forward-declared so revoke() can reference grantRef.
  let grantRef!: GrantInternal

  grantRef = {
    get id()           { return _id },
    get relationship() { return relationship },
    get capability()   { return cap },
    get isRevoked()    { return _revoked },

    revoke(): void {
      if (_revoked) return
      _revoked = true

      // Dispose all linked cross-node subscriptions.
      const snapshot = [..._linkedDisposers]
      _linkedDisposers.clear()
      for (const dispose of snapshot) {
        dispose()
      }

      // Remove from Relationship's active Grant set.
      activeGrants.delete(grantRef)
    },

    get [GRANT_INTERNAL]() {
      return { linkedDisposers: _linkedDisposers, readSnapshot: _readSnapshot }
    },
  }

  return grantRef
}

// ---------------------------------------------------------------------------
// createRelationship  (exported factory, used by ReactiveHome)
// ---------------------------------------------------------------------------

/**
 * Create a Relationship between two live ReactiveNodes.
 *
 * @param source        Node that will seek access.
 * @param target        Node being accessed.
 * @param onDestroyed   Called when the Relationship is destroyed so that the
 *                      owning GrantStore can de-register it.
 *
 * @throws KinAuthError('NODE_DESTROYED') if either node is already destroyed.
 */
export function createRelationship(
  source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
  target: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
  onDestroyed: (rel: Relationship) => void
): RelationshipInternal {

  // Type helper: access internal slot on any ReactiveNode.
  type AnyInternal = ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>

  const srcInternal = (source as unknown as AnyInternal)[REACTIVE_NODE_INTERNAL]
  const tgtInternal = (target as unknown as AnyInternal)[REACTIVE_NODE_INTERNAL]

  if (srcInternal._lifecycle === 'destroyed') {
    throw new KinAuthError(
      'NODE_DESTROYED',
      'Cannot create Relationship: source node is already destroyed.'
    )
  }
  if (tgtInternal._lifecycle === 'destroyed') {
    throw new KinAuthError(
      'NODE_DESTROYED',
      'Cannot create Relationship: target node is already destroyed.'
    )
  }

  const _id = nextRelId()
  const _activeGrants = new Set<Grant>()
  let _destroyed = false

  // Forward-declare so hooks can reference relRef.
  let relRef!: RelationshipInternal

  // ------------------------------------------------------------------
  // Core destroy logic — shared between explicit destroy() and the
  // node lifecycle hooks.
  // ------------------------------------------------------------------
  function _doDestroy(): void {
    if (_destroyed) return
    _destroyed = true

    // Revoke all active grants (which disposes their linked subscriptions).
    // Snapshot before iterating — revoke() modifies _activeGrants.
    const grantSnapshot = [..._activeGrants]
    _activeGrants.clear()  // clear first so revoke's delete() is a no-op
    for (const g of grantSnapshot) {
      g.revoke()
    }

    // Notify GrantStore.
    onDestroyed(relRef)
  }

  // ------------------------------------------------------------------
  // Node lifecycle hooks
  //
  // Registered on both nodes so that destroying either node automatically
  // destroys this Relationship (without destroying the other node).
  // ------------------------------------------------------------------
  function srcHook(): void { _doDestroy() }
  function tgtHook(): void { _doDestroy() }

  srcInternal._onDestroy.add(srcHook)
  tgtInternal._onDestroy.add(tgtHook)

  // ------------------------------------------------------------------
  // The Relationship object
  // ------------------------------------------------------------------
  relRef = {
    get id()          { return _id },
    get source()      { return source },
    get target()      { return target },
    get isDestroyed() { return _destroyed },

    grant(cap: Capability): Grant {
      if (_destroyed) {
        throw new KinAuthError(
          'RELATIONSHIP_DESTROYED',
          `Cannot issue Grant: Relationship "${_id}" is destroyed.`
        )
      }
      const g = _createGrant(relRef, cap, _activeGrants)
      _activeGrants.add(g)
      return g
    },

    destroy(): void {
      if (_destroyed) {
        // Remove hooks even on a repeat call (they're idempotent).
        srcInternal._onDestroy.delete(srcHook)
        tgtInternal._onDestroy.delete(tgtHook)
        return
      }

      // Remove hooks from live nodes before destroying (avoids a second call
      // from a node's own destroy cascade).
      srcInternal._onDestroy.delete(srcHook)
      tgtInternal._onDestroy.delete(tgtHook)

      _doDestroy()
    },

    get [RELATIONSHIP_INTERNAL]() {
      return { activeGrants: _activeGrants }
    },
  }

  return relRef
}
