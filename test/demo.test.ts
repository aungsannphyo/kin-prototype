/**
 * Phase D — Real-World Demo Integration Tests
 *
 * Account-sharing scenario: Bob observes Alice's account.
 *
 * Relationship direction: Bob (source/observer) → Alice (target/account holder)
 *
 * subscribeAs(source=bob, target=alice, grant, view => ...)
 *   The view is typed as AuthorizedView<AliceState>, so profile fields are
 *   statically accessible without casts.
 *
 * All assertions use only existing Kin public APIs.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createReactiveHome,
  capability,
  KinAuthError,
} from '../src/index.js'

// ---------------------------------------------------------------------------
// Shared state and action types
// ---------------------------------------------------------------------------

type AliceState = {
  profile: { name: string; email: string; address: string; password: string }
  balance: number
}

type AliceActions = {
  updateName(ctx:  { state: AliceState }, name:   string): void
  updateEmail(ctx: { state: AliceState }, email:  string): void
  deposit(ctx:     { state: AliceState }, amount: number): void
}

function makeAlice(home: ReturnType<typeof createReactiveHome>) {
  return home.node<AliceState, AliceActions>({
    state: {
      profile: {
        name:     'Alice',
        email:    'alice@example.com',
        address:  '123 Main St',
        password: 's3cr3t',
      },
      balance: 1_000,
    },
    actions: {
      updateName(ctx, name)   { ctx.state.profile = { ...ctx.state.profile, name } },
      updateEmail(ctx, email) { ctx.state.profile = { ...ctx.state.profile, email } },
      deposit(ctx, amount)    { ctx.state.balance += amount },
    },
  })
}

// Relationship direction: Bob (source) → Alice (target)
// This means Bob is the observer seeking access, Alice holds the data.
function makeSetup() {
  const home  = createReactiveHome()
  const alice = makeAlice(home)
  const bob   = home.node({ state: { id: 'bob' } })
  // Bob → Alice: Bob is the observer, Alice is the account holder.
  const rel   = home.relationship(bob, alice)
  return { home, alice, bob, rel }
}

// ===========================================================================
// A. Node creation and ownership
// ===========================================================================

describe('Demo — Node creation and ownership', () => {
  it('Alice and Bob are independent root nodes with correct initial roles', () => {
    const { home, alice, bob } = makeSetup()

    assert.equal(alice.isChild,  false)
    assert.equal(alice.isParent, false)
    assert.equal(bob.isChild,    false)
    assert.equal(bob.isParent,   false)

    home.destroy()
  })

  it('State is readable via the readonly proxy; direct mutation throws', () => {
    const { home, alice } = makeSetup()

    assert.equal(alice.state.balance, 1_000)
    assert.equal(alice.state.profile.name, 'Alice')

    assert.throws(
      () => { (alice.state as unknown as Record<string, number>).balance = 999 },
      TypeError
    )
    assert.equal(alice.state.balance, 1_000)

    home.destroy()
  })
})

// ===========================================================================
// B. Actions as the mutation boundary
// ===========================================================================

describe('Demo — Action-only mutation', () => {
  it('updateName replaces the profile object and new name is visible', () => {
    const { home, alice } = makeSetup()
    alice.actions.updateName('Alice Wonderland')
    assert.equal(alice.state.profile.name, 'Alice Wonderland')
    home.destroy()
  })

  it('deposit increases balance', () => {
    const { home, alice } = makeSetup()
    alice.actions.deposit(500)
    assert.equal(alice.state.balance, 1_500)
    home.destroy()
  })
})

// ===========================================================================
// C. Relationship
// ===========================================================================

describe('Demo — Relationship creation', () => {
  it('Bob→Alice relationship: correct source, target, and id; ownership unchanged', () => {
    const { home, alice, bob, rel } = makeSetup()

    assert.equal(typeof rel.id, 'string')
    assert.equal(rel.isDestroyed, false)
    assert.equal(rel.source, bob)    // Bob is source (observer)
    assert.equal(rel.target, alice)  // Alice is target (account holder)

    // Ownership roles must remain unchanged.
    assert.equal(alice.isParent, false)
    assert.equal(alice.isChild,  false)
    assert.equal(bob.isParent,   false)
    assert.equal(bob.isChild,    false)

    home.destroy()
  })
})

// ===========================================================================
// D. Capability validation
// ===========================================================================

describe('Demo — Capability path validation', () => {
  it('valid nested paths are accepted', () => {
    assert.doesNotThrow(() => capability(['profile.name', 'profile.email']))
  })

  it('invalid paths are rejected with TypeError', () => {
    assert.throws(() => capability(['']),            TypeError)
    assert.throws(() => capability(['__proto__']),   TypeError)
    assert.throws(() => capability(['constructor']), TypeError)
    assert.throws(() => capability(['0']),           TypeError)
    assert.throws(() => capability(['.profile']),    TypeError)
  })

  it('array mutation after capability() does not change the capability', () => {
    const fields = ['profile.name']
    const cap    = capability(fields)
    fields.push('profile.password')
    assert.equal(cap.read.has('profile.password'), false)
    assert.equal(cap.read.has('profile.name'),     true)
  })
})

// ===========================================================================
// E. Grant lifecycle
// ===========================================================================

describe('Demo — Grant lifecycle', () => {
  it('grant has id, relationship reference, capability, isRevoked=false', () => {
    const { home, rel } = makeSetup()
    const cap   = capability(['profile.name', 'profile.email'])
    const grant = rel.grant(cap)

    assert.equal(typeof grant.id, 'string')
    assert.equal(grant.isRevoked,    false)
    assert.equal(grant.capability,   cap)
    assert.equal(grant.relationship, rel)

    home.destroy()
  })

  it('Grant readSnapshot is independent of post-issuance capability mutation', () => {
    const { home, alice, bob, rel } = makeSetup()

    const cap   = capability(['profile.name'])
    const grant = rel.grant(cap)

    try { (cap.read as unknown as Set<string>).add('profile.password') } catch { /* ok */ }

    // Even if cap.read was mutated, grant's internal snapshot must block password.
    assert.throws(
      () => home.subscribeAs(bob, alice, grant, (view) => {
        void (view.state.profile as unknown as Record<string, unknown>)['password']
      }),
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )

    home.destroy()
  })
})

// ===========================================================================
// F. AuthorizedView — allowed access
// ===========================================================================

describe('Demo — AuthorizedView: allowed access', () => {
  it('Bob can read profile.name and profile.email through the view', () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let seenName:  string | null = null
    let seenEmail: string | null = null

    // view is AuthorizedView<AliceState> — profile fields are accessible
    home.subscribeAs(bob, alice, grant, (view) => {
      seenName  = view.state.profile.name
      seenEmail = view.state.profile.email
    })

    assert.equal(seenName,  'Alice')
    assert.equal(seenEmail, 'alice@example.com')

    home.destroy()
  })
})

// ===========================================================================
// F2. AuthorizedView — denied access
// ===========================================================================

describe('Demo — AuthorizedView: denied access', () => {
  it('profile.address throws FIELD_NOT_GRANTED', () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    assert.throws(
      () => home.subscribeAs(bob, alice, grant, (view) => {
        void (view.state.profile as unknown as Record<string, unknown>)['address']
      }),
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    home.destroy()
  })

  it('profile.password throws FIELD_NOT_GRANTED', () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    assert.throws(
      () => home.subscribeAs(bob, alice, grant, (view) => {
        void (view.state.profile as unknown as Record<string, unknown>)['password']
      }),
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    home.destroy()
  })

  it('balance throws FIELD_NOT_GRANTED', () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    assert.throws(
      () => home.subscribeAs(bob, alice, grant, (view) => {
        void (view.state as unknown as Record<string, unknown>)['balance']
      }),
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    home.destroy()
  })

  it('view does not expose actions, destroy, isParent, isChild, or internal APIs', () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name']))

    home.subscribeAs(bob, alice, grant, (view) => {
      const v = view as unknown as Record<string, unknown>
      assert.equal(v['actions'],  undefined)
      assert.equal(v['destroy'],  undefined)
      assert.equal(v['child'],    undefined)
      assert.equal(v['isParent'], undefined)
      assert.equal(v['isChild'],  undefined)
    })
    home.destroy()
  })

  it('view.state.profile is a filtered proxy, not the raw profile object', () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name']))

    let capturedProfileRef: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedProfileRef = view.state.profile
    })

    // The returned proxy must not be the raw profile object.
    assert.notStrictEqual(capturedProfileRef, alice.state.profile)
    home.destroy()
  })
})

// ===========================================================================
// G. Reactive integration
// ===========================================================================

describe('Demo — Reactive updates through AuthorizedView', () => {
  it('profile replacement triggers the authorized subscriber', async () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    const seen: string[] = []
    home.subscribeAs(bob, alice, grant, (view) => {
      seen.push(view.state.profile.name)
    })
    assert.deepEqual(seen, ['Alice'])

    alice.actions.updateName('Alice Wonderland')
    await home.flush()
    assert.deepEqual(seen, ['Alice', 'Alice Wonderland'])

    home.destroy()
  })

  it('balance mutation does not trigger the profile subscriber', async () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name']))

    let runs = 0
    home.subscribeAs(bob, alice, grant, (view) => {
      runs++
      void view.state.profile.name
    })
    runs = 0

    alice.actions.deposit(500)
    await home.flush()
    assert.equal(runs, 0, 'balance mutation must not trigger profile subscriber')

    home.destroy()
  })

  it('Phase D documented limitation: in-place nested mutation does not trigger subscriber', async () => {
    const home = createReactiveHome()
    const observer = home.node({ state: { id: 'observer' } })
    const subject  = home.node({
      state: { profile: { name: 'Pat', password: 'x' } },
      actions: {
        mutateName(ctx) {
          // In-place: does NOT replace the profile object reference.
          ;(ctx.state.profile as Record<string, unknown>)['name'] = 'Quinn'
        },
      },
    })
    const rel   = home.relationship(observer, subject)
    const grant = rel.grant(capability(['profile.name']))

    let runs = 0
    home.subscribeAs(observer, subject, grant, (view) => {
      runs++
      void (view.state.profile as unknown as Record<string, unknown>)['name']
    })
    runs = 0

    subject.actions.mutateName()
    await home.flush()
    assert.equal(runs, 0, 'in-place nested mutation must NOT trigger subscriber — Phase D documented limitation')

    home.destroy()
  })
})

// ===========================================================================
// H. Grant revocation
// ===========================================================================

describe('Demo — Grant revocation', () => {
  it('revoked grant produces GRANT_REVOKED on subscribeAs', () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name']))

    grant.revoke()
    assert.equal(grant.isRevoked, true)

    assert.throws(
      () => home.subscribeAs(bob, alice, grant, (_view) => {}),
      (err: unknown) => err instanceof KinAuthError && err.code === 'GRANT_REVOKED'
    )
    home.destroy()
  })

  it('revoking grant A does not affect grant B on the same relationship', async () => {
    const { home, alice, bob, rel } = makeSetup()
    const grantA = rel.grant(capability(['profile.name']))
    const grantB = rel.grant(capability(['profile.email']))

    let emailRuns = 0
    home.subscribeAs(bob, alice, grantB, (view) => {
      emailRuns++
      void view.state.profile.email
    })
    emailRuns = 0

    grantA.revoke()
    assert.equal(rel.isDestroyed,  false)
    assert.equal(grantB.isRevoked, false)

    alice.actions.updateEmail('new@example.com')
    await home.flush()
    assert.equal(emailRuns, 1, 'grantB subscription must still work after grantA revocation')

    home.destroy()
  })

  it('re-granting does not restore the old subscription', async () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant1 = rel.grant(capability(['profile.name']))

    let runs = 0
    home.subscribeAs(bob, alice, grant1, (view) => {
      runs++
      void view.state.profile.name
    })
    assert.equal(runs, 1)

    grant1.revoke()

    // Re-grant — old subscription must remain dead.
    void rel.grant(capability(['profile.name']))
    alice.actions.updateName('New Name')
    await home.flush()
    assert.equal(runs, 1, 'old subscription must not revive after re-grant')

    home.destroy()
  })
})

// ===========================================================================
// I. Relationship destruction
// ===========================================================================

describe('Demo — Relationship destruction', () => {
  it('destroying the relationship revokes all grants but leaves nodes alive', () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name']))

    rel.destroy()

    assert.equal(rel.isDestroyed, true)
    assert.equal(grant.isRevoked, true)

    // Both nodes must still be alive.
    assert.doesNotThrow(() => alice.state.balance)
    assert.doesNotThrow(() => { void bob.state })
    assert.doesNotThrow(() => alice.actions.deposit(100))

    home.destroy()
  })
})

// ===========================================================================
// I2. Relationship destruction — isolated tests
// ===========================================================================

describe('Demo — Relationship destruction (isolated)', () => {
  it('destroying target node destroys the relationship; source survives', () => {
    const home    = createReactiveHome()
    const source  = home.node({ state: { id: 'observer' } })
    const target  = makeAlice(home)
    const rel     = home.relationship(source, target)
    void rel.grant(capability(['profile.name']))

    target.destroy()

    assert.equal(rel.isDestroyed, true)
    assert.doesNotThrow(() => { void source.state })

    home.destroy()
  })

  it('destroying source node destroys the relationship; target survives', () => {
    const home    = createReactiveHome()
    const source  = home.node({ state: { id: 'observer' } })
    const target  = makeAlice(home)
    const rel     = home.relationship(source, target)
    void rel.grant(capability(['profile.name']))

    source.destroy()

    assert.equal(rel.isDestroyed, true)
    assert.doesNotThrow(() => target.state.balance)

    home.destroy()
  })
})

// ===========================================================================
// J. Full integration scenario
// ===========================================================================

describe('Demo — Full account-sharing integration scenario', () => {
  it('complete workflow validates all Phase C/D contracts', async () => {
    const home  = createReactiveHome()
    const alice = makeAlice(home)
    const bob   = home.node({ state: { id: 'bob' } })

    // Bob is the observer (source), Alice is the account holder (target).
    const rel   = home.relationship(bob, alice)
    assert.equal(rel.isDestroyed, false)

    const cap   = capability(['profile.name', 'profile.email'])
    const grant = rel.grant(cap)
    assert.equal(grant.isRevoked, false)

    // Authorized subscription.
    const updates: Array<{ name: string; email: string }> = []
    home.subscribeAs(bob, alice, grant, (view) => {
      updates.push({ name: view.state.profile.name, email: view.state.profile.email })
    })
    assert.equal(updates.length, 1)
    assert.equal(updates[0].name,  'Alice')
    assert.equal(updates[0].email, 'alice@example.com')

    // Reactive update.
    alice.actions.updateName('Alice Wonderland')
    await home.flush()
    assert.equal(updates.length, 2)
    assert.equal(updates[1].name, 'Alice Wonderland')

    // Balance change does NOT trigger profile subscriber.
    alice.actions.deposit(5_000)
    await home.flush()
    assert.equal(updates.length, 2, 'balance change must not trigger profile sub')

    // Denied access — checked in dedicated tests; skip inline throws here
    // to avoid stale subscriber state during subsequent flushes.
    assert.equal(grant.capability.read.has('profile.password'), false)
    assert.equal(grant.capability.read.has('balance'), false)

    // Grant revocation.
    grant.revoke()
    assert.equal(grant.isRevoked, true)
    assert.equal(rel.isDestroyed, false)

    alice.actions.updateName('Alice Latest')
    await home.flush()
    assert.equal(updates.length, 2, 'subscriber must be dead after revocation')

    // Re-grant — old sub stays dead; new sub works.
    const grant2 = rel.grant(cap)
    const updates2: string[] = []
    home.subscribeAs(bob, alice, grant2, (view) => {
      updates2.push(view.state.profile.name)
    })
    assert.equal(updates2.length, 1)
    assert.equal(updates2[0], 'Alice Latest')

    alice.actions.updateName('Alice Final')
    await home.flush()
    assert.equal(updates.length,  2, 'old subscription must remain dead')
    assert.equal(updates2.length, 2, 'new subscription must receive update')
    assert.equal(updates2[1], 'Alice Final')

    // Relationship destruction.
    rel.destroy()
    assert.equal(rel.isDestroyed,  true)
    assert.equal(grant2.isRevoked, true)
    assert.doesNotThrow(() => alice.state.balance)  // Alice survives
    assert.doesNotThrow(() => { void bob.state })   // Bob survives

    home.destroy()
  })
})
