/**
 * Phase A — Home implementation
 *
 * Home is a root container. It:
 *  - Creates root-level nodes
 *  - Owns root nodes (but is NOT a Node itself)
 *  - Destroys all root nodes when destroyed
 *  - Does NOT participate in the Parent/Child role derivation
 *  - Does NOT hold State
 */

import type {
  StateRecord,
  ActionsMap,
  NodeDefinition,
  InternalNode,
  Home,
} from './types.js'
import { HOME_OWNER_TAG } from './types.js'
import { createNode } from './node.js'
import type { HomeOwnerInternal } from './node.js'

export function createHome(): Home {
  // The HomeOwner token is a plain object with a tag.
  // It is also extended with _removeRoot so nodes can self-detach.
  const _roots = new Set<InternalNode<StateRecord, ActionsMap<StateRecord>>>()
  let _destroyed = false

  const ownerToken: HomeOwnerInternal = {
    _tag: HOME_OWNER_TAG,
    _removeRoot(node: InternalNode<StateRecord, ActionsMap<StateRecord>>) {
      _roots.delete(node)
    },
  }

  const home: Home = {
    node<S extends StateRecord, A extends ActionsMap<S>>(
      def: NodeDefinition<S, A>
    ): InternalNode<S, A> {
      if (_destroyed) {
        throw new Error('Cannot create a node on a destroyed Home.')
      }
      const n = createNode<S, A>(def, ownerToken)
      _roots.add(n as InternalNode<StateRecord, ActionsMap<StateRecord>>)
      return n
    },

    destroy(): void {
      if (_destroyed) return

      // Snapshot before iterating — nodes remove themselves from _roots as they destroy.
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
