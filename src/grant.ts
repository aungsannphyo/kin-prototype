/**
 * Phase C — GrantStore
 *
 * A GrantStore is the per-home registry of Relationships.
 *
 * Responsibilities:
 *  - Create Relationships between two ReactiveNodes in this Home.
 *  - Track all Relationships (so they can be destroyed when Home is destroyed).
 *  - Provide relationship lookup by (source, target) node pair for
 *    authorization checks.
 *  - Clean up (destroy all Relationships) when the Home is destroyed.
 *
 * The GrantStore does NOT:
 *  - Know about ReactiveScope.
 *  - Create subscribers.
 *  - Know about individual field subscriptions.
 *
 * Those concerns live in authorization.ts and reactive-home.ts.
 */

import type { ReactiveNode } from './reactive-node.js'
import type { StateRecord, ActionsMap } from './types.js'
import {
  createRelationship,
  type Relationship,
  type RelationshipInternal,
} from './relationship.js'

// ---------------------------------------------------------------------------
// GrantStore interface (internal to the framework)
// ---------------------------------------------------------------------------

export interface GrantStore {
  /**
   * Create and register a Relationship between source and target.
   *
   * Throws KinAuthError('NODE_DESTROYED') if either node is already destroyed.
   *
   * Note: duplicate relationships (same source+target pair) are allowed —
   * multiple Relationships can exist between the same pair of nodes.
   * Each is independent.
   */
  createRelationship(
    source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
    target: ReactiveNode<StateRecord, ActionsMap<StateRecord>>
  ): Relationship

  /**
   * Find all active (non-destroyed) Relationships from source → target.
   *
   * Returns an empty array if none exist.
   */
  findRelationships(
    source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
    target: ReactiveNode<StateRecord, ActionsMap<StateRecord>>
  ): Relationship[]

  /**
   * Destroy all Relationships in this store.
   * Called by ReactiveHome.destroy().
   */
  destroyAll(): void
}

// ---------------------------------------------------------------------------
// createGrantStore
// ---------------------------------------------------------------------------

export function createGrantStore(): GrantStore {
  // All live Relationships in this Home.
  const _relationships = new Set<RelationshipInternal>()

  function _onRelDestroyed(rel: Relationship): void {
    _relationships.delete(rel as RelationshipInternal)
  }

  return {
    createRelationship(
      source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
      target: ReactiveNode<StateRecord, ActionsMap<StateRecord>>
    ): Relationship {
      const rel = createRelationship(source, target, _onRelDestroyed)
      _relationships.add(rel)
      return rel
    },

    findRelationships(
      source: ReactiveNode<StateRecord, ActionsMap<StateRecord>>,
      target: ReactiveNode<StateRecord, ActionsMap<StateRecord>>
    ): Relationship[] {
      const results: Relationship[] = []
      for (const rel of _relationships) {
        if (!rel.isDestroyed && rel.source === source && rel.target === target) {
          results.push(rel)
        }
      }
      return results
    },

    destroyAll(): void {
      // Snapshot — destroy() modifies _relationships via _onRelDestroyed.
      const snapshot = [..._relationships]
      _relationships.clear()
      for (const rel of snapshot) {
        rel.destroy()
      }
    },
  }
}

// Re-exports so callers can import from a single location.
export { KinAuthError } from './relationship.js'
export { RELATIONSHIP_INTERNAL } from './relationship.js'
export type { Relationship, RelationshipInternal } from './relationship.js'
