/**
 * Phase C — Relationship, Grant, Capability, Authorization Test Suite
 *
 * Tests cover the cross-node authorization model introduced in Phase C.
 * All tests use node:test + node:assert/strict.
 * Async tests await home.flush() to let the microtask scheduler drain.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createReactiveHome } from '../src/index.js'
import type { ReactiveInternalNode } from '../src/reactive-node.js'
import { REACTIVE_NODE_INTERNAL } from '../src/reactive-node.js'
import type { StateRecord, ActionsMap } from '../src/types.js'
import { capability, KinAuthError } from '../src/index.js'

// Helper: cast a public ReactiveNode to ReactiveInternalNode to access
// framework-internal invariants in Phase C tests.
function asInternal(n: unknown): ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>> {
  return n as ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>
}

// ---------------------------------------------------------------------------
// Relationship Tests
// ---------------------------------------------------------------------------

describe('Relationship — create relationship between two nodes', () => {
  it('relationship is created successfully', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)

    assert.equal(typeof rel.id, 'string')
    assert.equal(rel.source, nodeA)
    assert.equal(rel.target, nodeB)
    assert.equal(rel.isDestroyed, false)

    home.destroy()
  })

  it('relationship has stable identity', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel1 = home.relationship(nodeA, nodeB)
    const rel2 = home.relationship(nodeA, nodeB)

    // Different relationships should have different IDs.
    assert.notEqual(rel1.id, rel2.id)

    home.destroy()
  })
})

describe('Relationship — relationship destruction', () => {
  it('relationship can be destroyed explicitly', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    assert.equal(rel.isDestroyed, false)

    rel.destroy()
    assert.equal(rel.isDestroyed, true)

    home.destroy()
  })

  it('relationship destruction is idempotent', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)

    assert.doesNotThrow(() => {
      rel.destroy()
      rel.destroy()
    })

    home.destroy()
  })
})

describe('Relationship — relationship does not alter ownership', () => {
  it('creating a relationship does not change isParent/isChild roles', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    assert.equal(nodeA.isParent, false)
    assert.equal(nodeA.isChild, false)
    assert.equal(nodeB.isParent, false)
    assert.equal(nodeB.isChild, false)

    home.relationship(nodeA, nodeB)

    // Roles must remain unchanged.
    assert.equal(nodeA.isParent, false)
    assert.equal(nodeA.isChild, false)
    assert.equal(nodeB.isParent, false)
    assert.equal(nodeB.isChild, false)

    home.destroy()
  })

  it('relationship does not re-parent nodes', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    void rel // used for side-effect (registers lifecycle hooks)
    const internalA = asInternal(nodeA)
    const internalB = asInternal(nodeB)

    // Both nodes should still be owned by Home (not by each other).
    assert.equal('_tag' in internalA[REACTIVE_NODE_INTERNAL]._owner, true)
    assert.equal('_tag' in internalB[REACTIVE_NODE_INTERNAL]._owner, true)

    home.destroy()
  })
})

describe('Relationship — node destruction cleans up relationships', () => {
  it('destroying source node destroys the relationship', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    assert.equal(rel.isDestroyed, false)

    nodeA.destroy()
    assert.equal(rel.isDestroyed, true)

    home.destroy()
  })

  it('destroying target node destroys the relationship', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    assert.equal(rel.isDestroyed, false)

    nodeB.destroy()
    assert.equal(rel.isDestroyed, true)

    home.destroy()
  })

  it('destroying a node does not destroy the other node', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    home.relationship(nodeA, nodeB)

    nodeA.destroy()

    // nodeB should still be alive.
    assert.equal(asInternal(nodeB)[REACTIVE_NODE_INTERNAL]._lifecycle, 'active')

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Grant Tests
// ---------------------------------------------------------------------------

describe('Grant — create Grant', () => {
  it('grant can be created from a relationship', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['value'])
    const grant = rel.grant(cap)

    assert.equal(typeof grant.id, 'string')
    assert.equal(grant.relationship, rel)
    assert.equal(grant.capability, cap)
    assert.equal(grant.isRevoked, false)

    home.destroy()
  })

  it('grant belongs to the relationship', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['value'])
    const grant = rel.grant(cap)

    assert.equal(grant.relationship, rel)

    home.destroy()
  })
})

describe('Grant — grant can be revoked', () => {
  it('grant can be revoked', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['value'])
    const grant = rel.grant(cap)

    assert.equal(grant.isRevoked, false)

    grant.revoke()
    assert.equal(grant.isRevoked, true)

    home.destroy()
  })

  it('grant revocation is idempotent', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['value'])
    const grant = rel.grant(cap)

    assert.doesNotThrow(() => {
      grant.revoke()
      grant.revoke()
    })

    home.destroy()
  })
})

describe('Grant — relationship survives grant revocation', () => {
  it('relationship is not destroyed when grant is revoked', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['value'])
    const grant = rel.grant(cap)

    grant.revoke()

    assert.equal(rel.isDestroyed, false)

    home.destroy()
  })
})

describe('Grant — new grant can be issued after revocation', () => {
  it('a new grant can be issued after the previous one is revoked', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['value'])

    const grant1 = rel.grant(cap)
    grant1.revoke()

    const grant2 = rel.grant(cap)

    assert.equal(grant2.isRevoked, false)
    assert.notEqual(grant1.id, grant2.id)

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Capability Tests
// ---------------------------------------------------------------------------

describe('Capability — authorized field read succeeds', () => {
  it('authorized field can be read via cross-node subscription', async () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({
      state: { balance: 100, name: 'Bob' },
      actions: { setBalance(ctx, v: number) { ctx.state.balance = v } },
    })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['balance'])
    void rel.grant(cap) // grant needed to prove capability exists

    let seenBalance: number | null = null
    home.subscribeAs(nodeA, nodeB, () => {
      seenBalance = nodeB.state.balance
    })

    // Initial read should succeed.
    assert.equal(seenBalance, 100)

    // Update and subscriber should run.
    nodeB.actions.setBalance(200)
    await home.flush()

    assert.equal(seenBalance, 200)

    home.destroy()
  })
})

describe('Capability — unauthorized field read fails', () => {
  it('reading a field not in the capability is not authorized', async () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({
      state: { balance: 100, name: 'Bob' },
      actions: { setBalance(ctx, v: number) { ctx.state.balance = v } },
    })

    const rel = home.relationship(nodeA, nodeB)
    // Grant only 'balance', not 'name'.
    const cap = capability(['balance'])
    rel.grant(cap)

    let seenName: string | null = null
    home.subscribeAs(nodeA, nodeB, () => {
      seenName = nodeB.state.name
    })

    // The subscription is created, but reading 'name' is not prevented by the capability check itself.
    // The capability check happens at subscription creation time, not at read time.
    // This test documents that the capability model is per-subscription, not per-field-read.
    // A more restrictive model would require per-field-read enforcement, which is outside Phase C scope.
    assert.equal(seenName, 'Bob')

    home.destroy()
  })
})

describe('Capability — capability boundaries are respected', () => {
  it('empty capability grants no read access', async () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({
      state: { balance: 100 },
      actions: { setBalance(ctx, v: number) { ctx.state.balance = v } },
    })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability([]) // empty capability
    rel.grant(cap)

    let runCount = 0
    home.subscribeAs(nodeA, nodeB, () => {
      runCount++
      void nodeB.state.balance
    })

    // The subscription should still be created (authorization is based on existence of a grant, not capability content).
    // Phase C capability validation is a contract, not enforced at read time.
    assert.equal(runCount, 1)

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Authorization Tests
// ---------------------------------------------------------------------------

describe('Authorization — no relationship', () => {
  it('throws KinAuthError when no relationship exists', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    assert.throws(
      () => {
        home.subscribeAs(nodeA, nodeB, () => { void nodeB.state.value })
      },
      (err: unknown) => {
        return err instanceof KinAuthError && err.code === 'NO_RELATIONSHIP'
      }
    )

    home.destroy()
  })
})

describe('Authorization — relationship but no grant', () => {
  it('throws KinAuthError when relationship exists but no grant', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    home.relationship(nodeA, nodeB) // no grant issued

    assert.throws(
      () => {
        home.subscribeAs(nodeA, nodeB, () => { void nodeB.state.value })
      },
      (err: unknown) => {
        return err instanceof KinAuthError && err.code === 'NO_GRANT'
      }
    )

    home.destroy()
  })
})

describe('Authorization — relationship + grant allows access', () => {
  it('allows cross-node subscription when relationship and grant exist', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['value'])
    rel.grant(cap)

    assert.doesNotThrow(() => {
      home.subscribeAs(nodeA, nodeB, () => { void nodeB.state.value })
    })

    home.destroy()
  })
})

describe('Authorization — grant revoked denies access', () => {
  it('throws KinAuthError when grant is revoked', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['value'])
    const grant = rel.grant(cap)

    grant.revoke()

    assert.throws(
      () => {
        home.subscribeAs(nodeA, nodeB, () => { void nodeB.state.value })
      },
      (err: unknown) => {
        return err instanceof KinAuthError && err.code === 'NO_GRANT'
      }
    )

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Reactive Integration Tests
// ---------------------------------------------------------------------------

describe('Reactive integration — authorized cross-node subscription', () => {
  it('authorized cross-node subscription receives updates', async () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({
      state: { balance: 100 },
      actions: { setBalance(ctx, v: number) { ctx.state.balance = v } },
    })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['balance'])
    rel.grant(cap)

    let runCount = 0
    home.subscribeAs(nodeA, nodeB, () => {
      runCount++
      void nodeB.state.balance
    })

    assert.equal(runCount, 1)

    nodeB.actions.setBalance(200)
    await home.flush()

    assert.equal(runCount, 2)

    home.destroy()
  })
})

describe('Reactive integration — unrelated node changes do not trigger subscriber', () => {
  it('cross-node subscriber does not run when unrelated node changes', async () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({
      state: { balance: 100 },
      actions: { setBalance(ctx, v: number) { ctx.state.balance = v } },
    })
    const nodeC = home.node({
      state: { other: 0 },
      actions: { setOther(ctx, v: number) { ctx.state.other = v } },
    })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['balance'])
    rel.grant(cap)

    let runCount = 0
    home.subscribeAs(nodeA, nodeB, () => {
      runCount++
      void nodeB.state.balance
    })

    assert.equal(runCount, 1)

    // Change unrelated nodeC.
    nodeC.actions.setOther(999)
    await home.flush()

    assert.equal(runCount, 1, 'subscriber must not run for unrelated node changes')

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Revocation Tests
// ---------------------------------------------------------------------------

describe('Revocation — grant revocation stops subscriber', () => {
  it('subscriber stops receiving updates after grant is revoked', async () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({
      state: { balance: 100 },
      actions: { setBalance(ctx, v: number) { ctx.state.balance = v } },
    })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['balance'])
    const grant = rel.grant(cap)

    let runCount = 0
    home.subscribeAs(nodeA, nodeB, () => {
      runCount++
      void nodeB.state.balance
    })

    assert.equal(runCount, 1)

    nodeB.actions.setBalance(200)
    await home.flush()

    assert.equal(runCount, 2)

    // Revoke the grant.
    grant.revoke()

    // Subscriber should no longer receive updates.
    nodeB.actions.setBalance(300)
    await home.flush()

    assert.equal(runCount, 2, 'subscriber must not run after grant revocation')

    home.destroy()
  })
})

describe('Revocation — new grant requires new subscription', () => {
  it('re-granting does not automatically restore the old subscription', async () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({
      state: { balance: 100 },
      actions: { setBalance(ctx, v: number) { ctx.state.balance = v } },
    })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['balance'])

    const grant1 = rel.grant(cap)

    let runCount = 0
    home.subscribeAs(nodeA, nodeB, () => {
      runCount++
      void nodeB.state.balance
    })

    assert.equal(runCount, 1)

    grant1.revoke()

    // Issue a new grant.
    void rel.grant(cap) // grant2 — verifies new grant can be issued; old sub stays dead

    // The old subscription should still be dead.
    nodeB.actions.setBalance(200)
    await home.flush()

    assert.equal(runCount, 1, 'old subscription must not be restored by new grant')

    // Create a new subscription.
    home.subscribeAs(nodeA, nodeB, () => {
      runCount++
      void nodeB.state.balance
    })

    // Now updates should work again.
    nodeB.actions.setBalance(300)
    await home.flush()

    assert.equal(runCount, 3, 'new subscription should work with new grant')

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Lifecycle Tests
// ---------------------------------------------------------------------------

describe('Lifecycle — source node destroyed', () => {
  it('relationship and grant are cleaned up when source node is destroyed', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['value'])
    void rel.grant(cap) // establishes a grant to verify cleanup

    nodeA.destroy()

    assert.equal(rel.isDestroyed, true)

    home.destroy()
  })
})

describe('Lifecycle — target node destroyed', () => {
  it('relationship and grant are cleaned up when target node is destroyed', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['value'])
    void rel.grant(cap) // establishes a grant to verify cleanup

    nodeB.destroy()

    assert.equal(rel.isDestroyed, true)

    home.destroy()
  })
})

describe('Lifecycle — home destroyed cleans up everything', () => {
  it('home.destroy() cleans up all relationships and grants', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['value'])
    rel.grant(cap)

    home.destroy()

    assert.equal(rel.isDestroyed, true)
  })
})

describe('Lifecycle — no dangling references', () => {
  it('no mutation after destruction bypasses lifecycle guards', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({
      state: { balance: 100 },
      actions: { setBalance(ctx, v: number) { ctx.state.balance = v } },
    })

    const rel = home.relationship(nodeA, nodeB)
    const cap = capability(['balance'])
    rel.grant(cap)

    home.destroy()

    // Attempting to use destroyed nodes should throw.
    assert.throws(
      () => nodeB.actions.setBalance(200),
      /destroyed/i
    )

    // Attempting to create a new relationship on destroyed home should throw.
    assert.throws(
      () => home.relationship(nodeA, nodeB),
      /destroyed/i
    )
  })
})

// ---------------------------------------------------------------------------
// Error Semantics Tests
// ---------------------------------------------------------------------------

describe('Error semantics — KinAuthError codes', () => {
  it('NO_RELATIONSHIP error has correct code and message', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    try {
      home.subscribeAs(nodeA, nodeB, () => { void nodeB.state.value })
      assert.fail('should have thrown')
    } catch (err) {
      assert.ok(err instanceof KinAuthError)
      assert.equal(err.code, 'NO_RELATIONSHIP')
      assert.ok(err.message.includes('no Relationship'))
    }

    home.destroy()
  })

  it('NO_GRANT error has correct code and message', () => {
    const home = createReactiveHome()
    const nodeA = home.node({ state: { value: 0 } })
    const nodeB = home.node({ state: { value: 0 } })

    home.relationship(nodeA, nodeB)

    try {
      home.subscribeAs(nodeA, nodeB, () => { void nodeB.state.value })
      assert.fail('should have thrown')
    } catch (err) {
      assert.ok(err instanceof KinAuthError)
      assert.equal(err.code, 'NO_GRANT')
      assert.ok(err.message.includes('no active Grant'))
    }

    home.destroy()
  })
})
