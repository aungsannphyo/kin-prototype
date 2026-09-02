/**
 * Phase C — Relationship, Grant, Capability, Authorization Test Suite
 *
 * All tests use node:test + node:assert/strict.
 * Async tests await home.flush() to drain the microtask scheduler.
 *
 * Sections:
 *   A. Relationship
 *   B. Grant
 *   C. Capability enforcement (security regression — Phase C fix)
 *   D. Authorization gate
 *   E. Reactive integration
 *   F. Revocation
 *   G. Lifecycle
 *   H. Error semantics
 *   I. Security bypass attempts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createReactiveHome } from '../src/index.js'
import { REACTIVE_NODE_INTERNAL } from '../src/reactive-node.js'
import type { ReactiveInternalNode } from '../src/reactive-node.js'
import type { StateRecord, ActionsMap } from '../src/types.js'
import { capability, KinAuthError } from '../src/index.js'

function asInternal(n: unknown): ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>> {
  return n as ReactiveInternalNode<StateRecord, ActionsMap<StateRecord>>
}

// ===========================================================================
// A. Relationship
// ===========================================================================

describe('Relationship — create', () => {
  it('relationship is created with correct source, target, id', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    assert.equal(typeof rel.id, 'string')
    assert.equal(rel.source, a)
    assert.equal(rel.target, b)
    assert.equal(rel.isDestroyed, false)
    home.destroy()
  })

  it('two relationships between the same pair have different ids', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const r1 = home.relationship(a, b)
    const r2 = home.relationship(a, b)
    assert.notEqual(r1.id, r2.id)
    home.destroy()
  })
})

describe('Relationship — destruction', () => {
  it('relationship can be explicitly destroyed', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    rel.destroy()
    assert.equal(rel.isDestroyed, true)
    home.destroy()
  })

  it('relationship.destroy() is idempotent', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    assert.doesNotThrow(() => { rel.destroy(); rel.destroy() })
    home.destroy()
  })
})

describe('Relationship — ownership is not affected', () => {
  it('relationship does not change isParent / isChild', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    assert.equal(a.isParent, false); assert.equal(a.isChild, false)
    assert.equal(b.isParent, false); assert.equal(b.isChild, false)
    home.relationship(a, b)
    assert.equal(a.isParent, false); assert.equal(a.isChild, false)
    assert.equal(b.isParent, false); assert.equal(b.isChild, false)
    home.destroy()
  })

  it('relationship does not re-parent nodes — owners remain Home', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    void home.relationship(a, b)
    assert.equal('_tag' in asInternal(a)[REACTIVE_NODE_INTERNAL]._owner, true)
    assert.equal('_tag' in asInternal(b)[REACTIVE_NODE_INTERNAL]._owner, true)
    home.destroy()
  })
})

describe('Relationship — node destruction cascades to relationship', () => {
  it('destroying source destroys the relationship', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    a.destroy()
    assert.equal(rel.isDestroyed, true)
    // b must still be alive
    assert.equal(asInternal(b)[REACTIVE_NODE_INTERNAL]._lifecycle, 'active')
    home.destroy()
  })

  it('destroying target destroys the relationship', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    b.destroy()
    assert.equal(rel.isDestroyed, true)
    assert.equal(asInternal(a)[REACTIVE_NODE_INTERNAL]._lifecycle, 'active')
    home.destroy()
  })
})

// ===========================================================================
// B. Grant
// ===========================================================================

describe('Grant — create', () => {
  it('grant has id, relationship reference, capability, isRevoked=false', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    const cap = capability(['x'])
    const g = rel.grant(cap)
    assert.equal(typeof g.id, 'string')
    assert.equal(g.relationship, rel)
    assert.equal(g.capability, cap)
    assert.equal(g.isRevoked, false)
    home.destroy()
  })
})

describe('Grant — revocation', () => {
  it('grant.revoke() sets isRevoked=true', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    const g = rel.grant(capability(['x']))
    g.revoke()
    assert.equal(g.isRevoked, true)
    home.destroy()
  })

  it('grant.revoke() is idempotent', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    const g = rel.grant(capability(['x']))
    assert.doesNotThrow(() => { g.revoke(); g.revoke() })
    home.destroy()
  })

  it('relationship survives grant revocation', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    rel.grant(capability(['x'])).revoke()
    assert.equal(rel.isDestroyed, false)
    home.destroy()
  })

  it('new grant can be issued after revocation', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    const g1 = rel.grant(capability(['x']))
    g1.revoke()
    const g2 = rel.grant(capability(['x']))
    assert.equal(g2.isRevoked, false)
    assert.notEqual(g1.id, g2.id)
    home.destroy()
  })
})

// ===========================================================================
// C. Capability enforcement  (Security regression — Phase C fix)
// ===========================================================================

describe('Capability enforcement — Test 1: allowed field read succeeds', () => {
  it('reading an allowed field through the view works', async () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({
      state: { balance: 100 },
      actions: { set(ctx, v: number) { ctx.state.balance = v } },
    })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance']))

    let seen: number | null = null
    home.subscribeAs(a, b, (view) => { seen = view.state.balance })
    assert.equal(seen, 100)

    b.actions.set(200)
    await home.flush()
    assert.equal(seen, 200)
    home.destroy()
  })
})

describe('Capability enforcement — Test 2: denied field throws FIELD_NOT_GRANTED', () => {
  it('reading a denied field through the view throws KinAuthError', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 100, password: 'secret' } })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance'])) // 'password' not granted

    assert.throws(
      () => {
        home.subscribeAs(a, b, (view) => {
          // Attempt to read a denied field
          void (view.state as unknown as Record<string, unknown>)['password']
        })
      },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    home.destroy()
  })
})

describe('Capability enforcement — Test 3: multiple allowed fields', () => {
  it('all allowed fields can be read', async () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({
      state: { balance: 10, name: 'Alice' },
      actions: {
        setBalance(ctx, v: number) { ctx.state.balance = v },
        setName(ctx, v: string) { ctx.state.name = v },
      },
    })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance', 'name']))

    const seen: Array<{ balance: number; name: string }> = []
    home.subscribeAs(a, b, (view) => {
      seen.push({ balance: view.state.balance, name: view.state.name })
    })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].balance, 10)
    assert.equal(seen[0].name, 'Alice')

    b.actions.setBalance(20)
    await home.flush()
    assert.equal(seen[seen.length - 1].balance, 20)
    home.destroy()
  })
})

describe('Capability enforcement — Test 4: unrelated field denied', () => {
  it('a field not listed in the capability is denied even if it exists on the target', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 100, ssn: '000' } })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance'])) // 'ssn' not granted

    assert.throws(
      () => {
        home.subscribeAs(a, b, (view) => {
          void (view.state as unknown as Record<string, unknown>)['ssn']
        })
      },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    home.destroy()
  })
})

describe('Capability enforcement — Test 5: empty capability denies all fields', () => {
  it('empty capability causes every field read to throw', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 100 } })
    const rel = home.relationship(a, b)
    rel.grant(capability([]))

    assert.throws(
      () => {
        home.subscribeAs(a, b, (view) => {
          void (view.state as unknown as Record<string, unknown>)['balance']
        })
      },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    home.destroy()
  })
})

describe('Capability enforcement — Test 6: capability cannot be expanded after grant creation', () => {
  it('mutating the original fields array does not expand the grant', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 100, password: 'secret' } })
    const rel = home.relationship(a, b)

    const fields = ['balance']
    const cap = capability(fields)
    rel.grant(cap)

    // Mutate the original array after the grant is created.
    fields.push('password')

    // The grant must NOT see 'password' — it snapshotted at creation time.
    assert.throws(
      () => {
        home.subscribeAs(a, b, (view) => {
          void (view.state as unknown as Record<string, unknown>)['password']
        })
      },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    home.destroy()
  })

  it('mutating cap.read (ReadonlySet cast) does not expand the grant', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 100, password: 'secret' } })
    const rel = home.relationship(a, b)

    const cap = capability(['balance'])
    rel.grant(cap)

    // Attempt runtime mutation of the capability's Set after grant creation.
    // TypeScript prevents this at compile time, but we cast to verify runtime safety.
    try {
      (cap.read as unknown as Set<string>).add('password')
    } catch {
      // Some environments may throw on frozen sets — that's also acceptable.
    }

    // Whether or not the above add() succeeded on cap.read,
    // the grant's internal readSnapshot must remain unchanged.
    assert.throws(
      () => {
        home.subscribeAs(a, b, (view) => {
          void (view.state as unknown as Record<string, unknown>)['password']
        })
      },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    home.destroy()
  })
})

describe('Capability enforcement — Test 7: reactivity for authorized field', () => {
  it('authorized field read registers dep — target mutation triggers subscriber', async () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({
      state: { balance: 0 },
      actions: { deposit(ctx, v: number) { ctx.state.balance += v } },
    })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance']))

    const seen: number[] = []
    home.subscribeAs(a, b, (view) => { seen.push(view.state.balance) })
    assert.deepEqual(seen, [0])

    b.actions.deposit(50)
    await home.flush()
    assert.deepEqual(seen, [0, 50])

    b.actions.deposit(25)
    await home.flush()
    assert.deepEqual(seen, [0, 50, 75])
    home.destroy()
  })
})

describe('Capability enforcement — Test 8: denied field does not create dependency', () => {
  it('attempting to read a denied field throws before any dep is registered', async () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({
      state: { balance: 0, secret: 99 },
      actions: {
        setBalance(ctx, v: number) { ctx.state.balance = v },
        setSecret(ctx, v: number) { ctx.state.secret = v },
      },
    })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance']))

    let runCount = 0
    // The subscriber throws on the denied read, so it only runs once (the initial
    // run throws immediately). We catch via assert.throws on subscribeAs itself.
    assert.throws(
      () => {
        home.subscribeAs(a, b, (view) => {
          runCount++
          void (view.state as unknown as Record<string, unknown>)['secret']
        })
      },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )

    // The subscriber threw during its first run — it must be disposed automatically.
    // Mutating the denied field must not trigger anything.
    b.actions.setSecret(100)
    await home.flush()
    assert.equal(runCount, 1, 'subscriber must not re-run after denied-field throw')
    home.destroy()
  })
})

describe('Capability enforcement — Test 9: revocation stops authorized subscription', () => {
  it('grant revocation disposes the subscriber', async () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({
      state: { balance: 0 },
      actions: { set(ctx, v: number) { ctx.state.balance = v } },
    })
    const rel = home.relationship(a, b)
    const grant = rel.grant(capability(['balance']))

    let runs = 0
    home.subscribeAs(a, b, (view) => { runs++; void view.state.balance })
    assert.equal(runs, 1)

    b.actions.set(10)
    await home.flush()
    assert.equal(runs, 2)

    grant.revoke()

    b.actions.set(20)
    await home.flush()
    assert.equal(runs, 2, 'subscriber must not run after grant revocation')
    home.destroy()
  })
})

describe('Capability enforcement — Test 10: re-grant does not restore old subscription', () => {
  it('old subscription stays dead after re-grant; new explicit subscription works', async () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({
      state: { balance: 0 },
      actions: { set(ctx, v: number) { ctx.state.balance = v } },
    })
    const rel = home.relationship(a, b)
    const grant1 = rel.grant(capability(['balance']))

    let runs = 0
    home.subscribeAs(a, b, (view) => { runs++; void view.state.balance })
    assert.equal(runs, 1)

    grant1.revoke()

    // Re-grant — old subscription must remain dead.
    void rel.grant(capability(['balance']))
    b.actions.set(10)
    await home.flush()
    assert.equal(runs, 1, 'old subscription must not revive on re-grant')

    // Explicit new subscription must work.
    home.subscribeAs(a, b, (view) => { runs++; void view.state.balance })
    assert.equal(runs, 2)
    b.actions.set(20)
    await home.flush()
    assert.equal(runs, 3, 'new subscription must receive updates')
    home.destroy()
  })
})

describe('Capability enforcement — Test 11: no relationship denies access', () => {
  it('subscribeAs without a relationship throws NO_RELATIONSHIP', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 0 } })

    assert.throws(
      () => { home.subscribeAs(a, b, (_view) => {}) },
      (err: unknown) => err instanceof KinAuthError && err.code === 'NO_RELATIONSHIP'
    )
    home.destroy()
  })
})

describe('Capability enforcement — Test 12: relationship without grant denies access', () => {
  it('subscribeAs with relationship but no grant throws NO_GRANT', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 0 } })
    home.relationship(a, b) // no grant

    assert.throws(
      () => { home.subscribeAs(a, b, (_view) => {}) },
      (err: unknown) => err instanceof KinAuthError && err.code === 'NO_GRANT'
    )
    home.destroy()
  })
})

// ===========================================================================
// D. Authorization gate (existing tests, updated for view param)
// ===========================================================================

describe('Authorization — grant revoked before subscribeAs throws NO_GRANT', () => {
  it('revoked grant causes subscribeAs to throw', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    const g = rel.grant(capability(['x']))
    g.revoke()
    assert.throws(
      () => { home.subscribeAs(a, b, (_view) => {}) },
      (err: unknown) => err instanceof KinAuthError && err.code === 'NO_GRANT'
    )
    home.destroy()
  })
})

describe('Authorization — relationship + grant allows subscribeAs', () => {
  it('subscribeAs does not throw when authorized', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    rel.grant(capability(['x']))
    assert.doesNotThrow(() => { home.subscribeAs(a, b, (_view) => {}) })
    home.destroy()
  })
})

// ===========================================================================
// E. Reactive integration
// ===========================================================================

describe('Reactive integration — authorized subscriber tracks field deps correctly', () => {
  it('subscriber runs on authorized mutation, not on unrelated node', async () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({
      state: { balance: 0 },
      actions: { set(ctx, v: number) { ctx.state.balance = v } },
    })
    const c = home.node({
      state: { other: 0 },
      actions: { set(ctx, v: number) { ctx.state.other = v } },
    })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance']))

    let runs = 0
    home.subscribeAs(a, b, (view) => { runs++; void view.state.balance })
    assert.equal(runs, 1)

    c.actions.set(99)         // unrelated node — must not trigger
    await home.flush()
    assert.equal(runs, 1)

    b.actions.set(10)         // authorized target — must trigger
    await home.flush()
    assert.equal(runs, 2)
    home.destroy()
  })
})

// ===========================================================================
// F. Revocation
// ===========================================================================

describe('Revocation — full scenario', () => {
  it('grant → subscribe → update → revoke → update (no run)', async () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({
      state: { v: 0 },
      actions: { set(ctx, n: number) { ctx.state.v = n } },
    })
    const rel = home.relationship(a, b)
    const grant = rel.grant(capability(['v']))

    let runs = 0
    home.subscribeAs(a, b, (view) => { runs++; void view.state.v })
    assert.equal(runs, 1)

    b.actions.set(1); await home.flush()
    assert.equal(runs, 2)

    grant.revoke()
    b.actions.set(2); await home.flush()
    assert.equal(runs, 2, 'must stop after revocation')
    home.destroy()
  })
})

// ===========================================================================
// G. Lifecycle
// ===========================================================================

describe('Lifecycle — source node destroyed', () => {
  it('relationship + grant cleaned up when source destroyed', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    void rel.grant(capability(['x']))
    a.destroy()
    assert.equal(rel.isDestroyed, true)
    home.destroy()
  })
})

describe('Lifecycle — target node destroyed', () => {
  it('relationship + grant cleaned up when target destroyed', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    void rel.grant(capability(['x']))
    b.destroy()
    assert.equal(rel.isDestroyed, true)
    home.destroy()
  })
})

describe('Lifecycle — home.destroy() cleans everything', () => {
  it('all relationships destroyed when home is destroyed', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    const rel = home.relationship(a, b)
    rel.grant(capability(['x']))
    home.destroy()
    assert.equal(rel.isDestroyed, true)
  })
})

describe('Lifecycle — no dangling references', () => {
  it('actions on destroyed node throw; relationship on destroyed home throws', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({
      state: { v: 0 },
      actions: { set(ctx, n: number) { ctx.state.v = n } },
    })
    const rel = home.relationship(a, b)
    rel.grant(capability(['v']))
    home.destroy()
    assert.throws(() => b.actions.set(1), /destroyed/i)
    assert.throws(() => home.relationship(a, b), /destroyed/i)
  })
})

// ===========================================================================
// H. Error semantics
// ===========================================================================

describe('Error semantics — KinAuthError codes', () => {
  it('NO_RELATIONSHIP has correct code and message', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    try {
      home.subscribeAs(a, b, (_view) => {})
      assert.fail('should have thrown')
    } catch (err) {
      assert.ok(err instanceof KinAuthError)
      assert.equal(err.code, 'NO_RELATIONSHIP')
      assert.ok(err.message.includes('no Relationship'))
    }
    home.destroy()
  })

  it('NO_GRANT has correct code and message', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { x: 0 } })
    home.relationship(a, b)
    try {
      home.subscribeAs(a, b, (_view) => {})
      assert.fail('should have thrown')
    } catch (err) {
      assert.ok(err instanceof KinAuthError)
      assert.equal(err.code, 'NO_GRANT')
      assert.ok(err.message.includes('no active Grant'))
    }
    home.destroy()
  })

  it('FIELD_NOT_GRANTED has correct code and message', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 0, secret: 0 } })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance']))
    try {
      home.subscribeAs(a, b, (view) => {
        void (view.state as unknown as Record<string, unknown>)['secret']
      })
      assert.fail('should have thrown')
    } catch (err) {
      assert.ok(err instanceof KinAuthError)
      assert.equal(err.code, 'FIELD_NOT_GRANTED')
      assert.ok(err.message.includes('"secret"'))
    }
    home.destroy()
  })
})

// ===========================================================================
// I. Security bypass attempts
// ===========================================================================

describe('Security — callback cannot access the raw target node', () => {
  it('AuthorizedView does not expose actions, destroy, child, isParent, isChild', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({
      state: { balance: 0 },
      actions: { set(ctx, v: number) { ctx.state.balance = v } },
    })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance']))

    home.subscribeAs(a, b, (view) => {
      const v = view as unknown as Record<string, unknown>
      assert.equal(v['actions'],  undefined, 'actions must not be on view')
      assert.equal(v['destroy'],  undefined, 'destroy must not be on view')
      assert.equal(v['child'],    undefined, 'child must not be on view')
      assert.equal(v['isParent'], undefined, 'isParent must not be on view')
      assert.equal(v['isChild'],  undefined, 'isChild must not be on view')
    })
    home.destroy()
  })
})

describe('Security — view.state is read-only (no write through view)', () => {
  it('assigning to view.state.field throws TypeError', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 0 } })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance']))

    assert.throws(
      () => {
        home.subscribeAs(a, b, (view) => {
          (view.state as unknown as Record<string, number>)['balance'] = 999
        })
      },
      TypeError
    )
    // Value must be unchanged.
    assert.equal(b.state.balance, 0)
    home.destroy()
  })
})

describe('Security — view cannot access internal Symbols', () => {
  it('REACTIVE_NODE_INTERNAL Symbol is not reachable through the view', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 0 } })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance']))

    home.subscribeAs(a, b, (view) => {
      // Attempt to reach the internal Symbol slot through the view
      const v = view as unknown as Record<symbol, unknown>
      assert.equal(v[REACTIVE_NODE_INTERNAL], undefined,
        'REACTIVE_NODE_INTERNAL must not be reachable through the view')
    })
    home.destroy()
  })
})

describe('Security — view is frozen (no property injection)', () => {
  it('consumer cannot attach new properties to the view', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 0 } })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance']))

    home.subscribeAs(a, b, (view) => {
      // Attempt to inject a property that could later be used to reach real node.
      assert.throws(
        () => { (view as unknown as Record<string, unknown>)['realNode'] = b },
        TypeError,
        'view must be frozen — property injection must throw'
      )
    })
    home.destroy()
  })
})

describe('Security — AuthorizedView type does not expose AuthorizedView in public index', () => {
  it('AuthorizedView is a type-only public export — no runtime value', async () => {
    const mod = await import('../src/index.js')
    // AuthorizedView is a type; it must not appear as a runtime value/function.
    const exports = mod as unknown as Record<string, unknown>
    assert.equal(typeof exports['AuthorizedView'], 'undefined',
      'AuthorizedView must not be a runtime export')
  })
})

describe('Security — capability() snapshots at call time', () => {
  it('pushing to input array after capability() does not affect the Capability', () => {
    const fields = ['balance']
    const cap = capability(fields)
    fields.push('password')
    // The capability's Set was built from a snapshot — 'password' must not be in it.
    assert.equal(cap.read.has('password'), false)
    assert.equal(cap.read.has('balance'), true)
  })
})

describe('Security — unauthorized access via direct target reference still works but view enforces', () => {
  it('the real target node is unrestricted (normal Phase A/B behavior)', () => {
    // This test documents the intentional design: the raw target node is not
    // restricted by Phase C. Phase C only restricts access THROUGH the view.
    // A consumer who has a direct reference to the node can still read all fields
    // via home.subscribe(). Phase C does not retroactively restrict direct access.
    const home = createReactiveHome()
    const b = home.node({ state: { balance: 0, secret: 99 } })
    // Direct access through home.subscribe() — unrestricted (Phase B behavior).
    let seen: number | null = null
    home.subscribe(() => { seen = b.state.secret })
    assert.equal(seen, 99)
    home.destroy()
  })

  it('access THROUGH the view is restricted by capability even if consumer holds the real node', () => {
    const home = createReactiveHome()
    const a = home.node({ state: { x: 0 } })
    const b = home.node({ state: { balance: 0, secret: 99 } })
    const rel = home.relationship(a, b)
    rel.grant(capability(['balance'])) // secret not granted

    // Consumer has a closure reference to `b`. But the VIEW must still block secret.
    assert.throws(
      () => {
        home.subscribeAs(a, b, (view) => {
          // Attempt to read secret through the view (not through `b` directly).
          void (view.state as unknown as Record<string, unknown>)['secret']
        })
      },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    home.destroy()
  })
})
