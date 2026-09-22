/**
 * AuthorizedView Acquisition Test Suite
 *
 * Tests the 15 required scenarios:
 * 1. valid Grant
 * 2. invalid Grant
 * 3. wrong observer
 * 4. wrong target
 * 5. wrong Home
 * 6. revoked Grant
 * 7. destroyed Relationship
 * 8. destroyed target
 * 9. unauthorized field
 * 10. authorized field
 * 11. nested capability
 * 12. capability snapshot immutability
 * 13. subscription behavior
 * 14. revocation behavior
 * 15. cleanup
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

import {
  createReactiveHome,
  capability,
  KinAuthError,
  mount,
  element,
  text,
  type Grant,
  type Relationship,
} from '../src/index.js'

type UserAccount = {
  balance: number
  profile: {
    name: string
    email: string
    address: string
    password: string
  }
  [key: string]: unknown
}

type TargetActions = {
  setName(ctx: any, name: string): void
  setEmail(ctx: any, email: string): void
  setBalance(ctx: any, balance: number): void
}

function makeTarget(home: ReturnType<typeof createReactiveHome>) {
  return home.node<UserAccount, TargetActions>({
    state: {
      balance: 1000,
      profile: {
        name: 'Alice',
        email: 'alice@example.com',
        address: '123 Main St',
        password: 'supersecretpassword',
      },
    },
    actions: {
      setName(ctx, name: string) {
        ctx.state.profile = { ...ctx.state.profile, name }
      },
      setEmail(ctx, email: string) {
        ctx.state.profile = { ...ctx.state.profile, email }
      },
      setBalance(ctx, balance: number) {
        ctx.state.balance = balance
      },
    },
  })
}

function makeObserver(home: ReturnType<typeof createReactiveHome>, id = 'bob') {
  return home.node({
    state: { id },
  })
}

describe('AuthorizedView synchronous acquisition & lifecycle', () => {
  let windowRef: Window

  before(() => {
    windowRef = new Window({ url: 'http://localhost:5173/' })
    const globals = {
      document: windowRef.document,
      Event: windowRef.Event,
      MouseEvent: windowRef.MouseEvent,
      Node: windowRef.Node,
      HTMLElement: windowRef.HTMLElement,
      Text: windowRef.Text,
      Comment: windowRef.Comment,
    }
    Object.assign(globalThis, globals)
  })

  after(() => {
    windowRef.close()
  })

  // 1. valid Grant
  it('1. valid Grant: acquires AuthorizedView directly via grant.view() and home.authorizedView()', () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)
    const rel = home.relationship(observer, target)
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    // Direct acquisition via grant.view()
    const view1 = grant.view<UserAccount>()
    assert.ok(view1)
    assert.equal(view1.state.profile.name, 'Alice')
    assert.equal(view1.state.profile.email, 'alice@example.com')

    // Direct acquisition via home.authorizedView(source, target, grant)
    const view2 = home.authorizedView<UserAccount>(observer, target, grant)
    assert.ok(view2)
    assert.equal(view2.state.profile.name, 'Alice')
    assert.equal(view2.state.profile.email, 'alice@example.com')

    home.destroy()
  })

  // 2. invalid Grant
  it('2. invalid Grant: corrupted or fake grant throws KinAuthError on home.authorizedView()', () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)

    const fakeRel: Relationship = {
      id: 'fake-rel',
      source: makeObserver(home) as any, // mismatched source
      target: target as any,
      isDestroyed: false,
      grant: () => null as any,
      destroy: () => {},
    }

    const corruptedRelGrant: Grant = {
      id: 'fake-grant-id',
      capability: capability(['profile.name']),
      isRevoked: false,
      relationship: fakeRel,
      revoke: () => {},
      view: () => {
        throw new Error('Fake view method')
      },
    }

    assert.throws(
      () => home.authorizedView(observer, target, corruptedRelGrant),
      (err: unknown) => err instanceof KinAuthError && err.code === 'GRANT_MISMATCH'
    )

    home.destroy()
  })

  // 3. wrong observer
  it('3. wrong observer: throws GRANT_MISMATCH when passing a different source node', () => {
    const home = createReactiveHome()
    const observer1 = makeObserver(home, 'bob')
    const observer2 = makeObserver(home, 'charlie')
    const target = makeTarget(home)
    const rel = home.relationship(observer1, target)
    const grant = rel.grant(capability(['profile.name']))

    assert.throws(
      () => home.authorizedView(observer2, target, grant),
      (err: unknown) => err instanceof KinAuthError && err.code === 'GRANT_MISMATCH'
    )

    home.destroy()
  })

  // 4. wrong target
  it('4. wrong target: throws GRANT_MISMATCH when passing a different target node', () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target1 = makeTarget(home)
    const target2 = makeTarget(home)
    const rel = home.relationship(observer, target1)
    const grant = rel.grant(capability(['profile.name']))

    assert.throws(
      () => home.authorizedView(observer, target2, grant),
      (err: unknown) => err instanceof KinAuthError && err.code === 'GRANT_MISMATCH'
    )

    home.destroy()
  })

  // 5. wrong Home
  it('5. wrong Home: throws error when source or target belongs to a different Home', () => {
    const home1 = createReactiveHome()
    const home2 = createReactiveHome()
    const observer1 = makeObserver(home1)
    const target1 = makeTarget(home1)
    const observer2 = makeObserver(home2)
    const target2 = makeTarget(home2)

    const rel1 = home1.relationship(observer1, target1)
    const grant1 = rel1.grant(capability(['profile.name']))

    // Call home2.authorizedView with home1 nodes
    assert.throws(
      () => home2.authorizedView(observer1, target1, grant1),
      /Cross-Home authorizedView access is not supported/
    )

    // Call home1.authorizedView with a node from home2
    assert.throws(
      () => home1.authorizedView(observer2, target1, grant1),
      /Cross-Home authorizedView access is not supported/
    )

    // Call home1.authorizedView with target from home2
    assert.throws(
      () => home1.authorizedView(observer1, target2, grant1),
      /Cross-Home authorizedView access is not supported/
    )

    home1.destroy()
    home2.destroy()
  })

  // 6. revoked Grant
  it('6. revoked Grant: acquisition throws GRANT_REVOKED, and prior view throws on access', () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)
    const rel = home.relationship(observer, target)
    const grant = rel.grant(capability(['profile.name']))

    const view = grant.view<UserAccount>()
    assert.equal(view.state.profile.name, 'Alice')

    // Revoke the grant
    grant.revoke()
    assert.equal(grant.isRevoked, true)

    // New acquisition via grant.view() throws GRANT_REVOKED
    assert.throws(
      () => grant.view<UserAccount>(),
      (err: unknown) => err instanceof KinAuthError && err.code === 'GRANT_REVOKED'
    )

    // New acquisition via home.authorizedView() throws GRANT_REVOKED
    assert.throws(
      () => home.authorizedView(observer, target, grant),
      (err: unknown) => err instanceof KinAuthError && err.code === 'GRANT_REVOKED'
    )

    // Reading prior view throws GRANT_REVOKED
    assert.throws(
      () => { void view.state.profile.name },
      (err: unknown) => err instanceof KinAuthError && err.code === 'GRANT_REVOKED'
    )

    home.destroy()
  })

  // 7. destroyed Relationship
  it('7. destroyed Relationship: throws KinAuthError and invalidates views', () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)
    const rel = home.relationship(observer, target)
    const grant = rel.grant(capability(['profile.name']))

    const view = grant.view<UserAccount>()
    assert.equal(view.state.profile.name, 'Alice')

    rel.destroy()
    assert.equal(rel.isDestroyed, true)

    // grant.view() throws
    assert.throws(
      () => grant.view<UserAccount>(),
      (err: unknown) =>
        err instanceof KinAuthError &&
        (err.code === 'GRANT_REVOKED' || err.code === 'RELATIONSHIP_DESTROYED')
    )

    // home.authorizedView throws
    assert.throws(
      () => home.authorizedView(observer, target, grant),
      (err: unknown) =>
        err instanceof KinAuthError &&
        (err.code === 'GRANT_REVOKED' || err.code === 'RELATIONSHIP_DESTROYED')
    )

    // Reading prior view throws
    assert.throws(
      () => { void view.state.profile.name },
      (err: unknown) =>
        err instanceof KinAuthError &&
        (err.code === 'GRANT_REVOKED' || err.code === 'RELATIONSHIP_DESTROYED')
    )

    home.destroy()
  })

  // 8. destroyed target
  it('8. destroyed target: revokes grants, destroys relationship, and blocks view access', () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)
    const rel = home.relationship(observer, target)
    const grant = rel.grant(capability(['profile.name']))

    const view = grant.view<UserAccount>()
    assert.equal(view.state.profile.name, 'Alice')

    target.destroy()

    assert.equal(rel.isDestroyed, true)
    assert.equal(grant.isRevoked, true)

    assert.throws(
      () => grant.view<UserAccount>(),
      (err: unknown) =>
        err instanceof KinAuthError &&
        (err.code === 'GRANT_REVOKED' || err.code === 'RELATIONSHIP_DESTROYED')
    )

    assert.throws(
      () => home.authorizedView(observer, target, grant),
      (err: unknown) =>
        err instanceof KinAuthError &&
        (err.code === 'GRANT_REVOKED' || err.code === 'RELATIONSHIP_DESTROYED')
    )

    assert.throws(
      () => { void view.state.profile.name },
      (err: unknown) =>
        err instanceof KinAuthError &&
        (err.code === 'GRANT_REVOKED' || err.code === 'RELATIONSHIP_DESTROYED')
    )

    home.destroy()
  })

  // 9. unauthorized field
  it('9. unauthorized field: throws FIELD_NOT_GRANTED on top-level and nested access', () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)
    const rel = home.relationship(observer, target)
    const grant = rel.grant(capability(['profile.name']))
    const view = grant.view<UserAccount>()

    // Unauthorized top-level field
    assert.throws(
      () => { void view.state.balance },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )

    // Unauthorized nested fields
    assert.throws(
      () => { void view.state.profile.email },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    assert.throws(
      () => { void view.state.profile.address },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    assert.throws(
      () => { void view.state.profile.password },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )

    // ownKeys / Object.keys doesn't leak
    assert.deepEqual(Object.keys(view.state.profile), ['name'])

    home.destroy()
  })

  // 10. authorized field
  it('10. authorized field: reading granted fields returns current data reliably', () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)
    const rel = home.relationship(observer, target)
    const grant = rel.grant(capability(['profile.name', 'profile.email']))
    const view = grant.view<UserAccount>()

    assert.equal(view.state.profile.name, 'Alice')
    assert.equal(view.state.profile.email, 'alice@example.com')
    // Repeated reads
    assert.equal(view.state.profile.name, 'Alice')
    assert.equal(view.state.profile.email, 'alice@example.com')

    home.destroy()
  })

  // 11. nested capability
  it('11. nested capability: granular path isolation works as expected', () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)
    const rel = home.relationship(observer, target)
    const grant = rel.grant(capability(['profile.name', 'profile.email']))
    const view = grant.view<UserAccount>()

    assert.equal(view.state.profile.name, 'Alice')
    assert.equal(view.state.profile.email, 'alice@example.com')

    assert.throws(
      () => { void view.state.profile.address },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )
    assert.throws(
      () => { void view.state.profile.password },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )

    home.destroy()
  })

  // 12. capability snapshot immutability
  it('12. capability snapshot immutability: mutating array or attempting to mutate set has no effect', () => {
    const fields = ['profile.name']
    const cap = capability(fields)
    fields.push('balance') // mutate original input array

    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)
    const rel = home.relationship(observer, target)
    const grant = rel.grant(cap)

    const view = grant.view<UserAccount>()
    assert.equal(view.state.profile.name, 'Alice')

    // balance was NOT granted
    assert.throws(
      () => { void view.state.balance },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )

    // Mutating cap.read directly if attempted
    try {
      ;(cap.read as any).add('balance')
    } catch {
      // Expected if frozen/readonly
    }

    assert.throws(
      () => { void view.state.balance },
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )

    home.destroy()
  })

  // 13. subscription behavior
  it('13. subscription behavior: reactive subscriptions function without subscribeAs wrapper', async () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)
    const rel = home.relationship(observer, target)
    const grant = rel.grant(capability(['profile.name']))

    // Obtain view directly
    const view = grant.view<UserAccount>()

    let runCount = 0
    let observedName = ''

    // Normal Phase B subscription using the obtained view
    const sub = home.subscribe(() => {
      runCount++
      observedName = view.state.profile.name
    })

    assert.equal(runCount, 1)
    assert.equal(observedName, 'Alice')

    // Target mutates granted field
    target.actions.setName('Alicia')
    await home.flush()

    assert.equal(runCount, 2)
    assert.equal(observedName, 'Alicia')

    // Target mutates ungranted field
    target.actions.setBalance(50000)
    await home.flush()

    // Does NOT trigger subscriber
    assert.equal(runCount, 2)

    home.unsubscribe(sub)
    home.destroy()
  })

  // 14. revocation behavior
  it('14. revocation behavior: revoking grant terminates updates and causes subsequent reads to throw', async () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)
    const rel = home.relationship(observer, target)
    const grant = rel.grant(capability(['profile.name']))

    const view = grant.view<UserAccount>()
    let runCount = 0
    let lastError: unknown = null

    const sub = home.subscribe(() => {
      runCount++
      try {
        void view.state.profile.name
      } catch (err) {
        lastError = err
      }
    })

    assert.equal(runCount, 1)

    // Revoke the grant
    grant.revoke()

    // Mutate target
    target.actions.setName('Alice 2')
    await home.flush()

    // Subscriber ran because dependency was tracked, but read threw KinAuthError('GRANT_REVOKED')
    assert.equal(runCount, 2)
    assert.ok(lastError instanceof KinAuthError && lastError.code === 'GRANT_REVOKED')

    home.unsubscribe(sub)
    home.destroy()
  })

  // 15. cleanup
  it('15. cleanup: destroyed Home disallows acquisition, and UI mount unmounts cleanly', () => {
    const home = createReactiveHome()
    const observer = makeObserver(home)
    const target = makeTarget(home)
    const rel = home.relationship(observer, target)
    const grant = rel.grant(capability(['profile.name']))

    const view = grant.view<UserAccount>()

    // Mount UI in DOM using view.state
    const container = windowRef.document.createElement('div')
    windowRef.document.body.appendChild(container)

    const handle = mount(
      home,
      () =>
        element('div', { id: 'user-profile' },
          text(() => `User: ${view.state.profile.name}`)
        ),
      container as unknown as ParentNode
    )

    assert.equal(container.textContent, 'User: Alice')

    // Unmount
    handle.unmount()
    assert.equal(container.childNodes.length, 0)

    // Destroy home
    home.destroy()

    // home.authorizedView throws after home.destroy()
    assert.throws(
      () => home.authorizedView(observer, target, grant),
      /Cannot access AuthorizedView on a destroyed Home/
    )

    windowRef.document.body.removeChild(container)
  })
})
