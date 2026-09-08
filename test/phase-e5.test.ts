/**
 * Phase E.5 — Real Application Composition & End-to-End Validation
 *
 * Integration tests that prove the existing Kin architecture can build a realistic
 * browser application using ONLY primitives established in Phases A–E.4.
 *
 * Tests cover the complete flow:
 *   State → Actions → Relationships → Grants → Deep Authorization
 *   → AuthorizedView → View Composition → DOM Renderer → Browser Event
 *   → EventHandler → Kin Action → State Mutation → Fine-Grained Reactive DOM Update
 *
 * Runner: node:test   Assertions: node:assert/strict
 * Uses happy-dom for DOM tests.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

import { createReactiveHome, capability, KinAuthError } from '../src/index.js'
import type { ReactiveNode, AuthorizedView } from '../src/index.js'
import {
  element,
  text,
  handler,
} from '../src/view/index.js'
import { mount } from '../src/dom/index.js'
import type { View } from '../src/dom/index.js'
import type { ChildNode } from '../src/view/index.js'

// ===========================================================================
// Type Definitions
// ===========================================================================

type AliceState = {
  profile: {
    name: string
    email: string
    address: string
    password: string
  }
  balance: number
}

type AliceActions = {
  deposit(ctx: { state: AliceState }, amount: number): void
  withdraw(ctx: { state: AliceState }, amount: number): void
  updateName(ctx: { state: AliceState }, name: string): void
  updateEmail(ctx: { state: AliceState }, email: string): void
  updateAddress(ctx: { state: AliceState }, address: string): void
}

// ===========================================================================
// DOM Environment
// ===========================================================================

let windowRef: Window

function installDom(): void {
  windowRef = new Window({ url: 'https://localhost/' })
  const globals = {
    document: windowRef.document,
    Event: windowRef.Event,
    Node: windowRef.Node,
    HTMLElement: windowRef.HTMLElement,
    Text: windowRef.Text,
    Comment: windowRef.Comment,
  }
  Object.assign(globalThis, globals)
}

function container(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

function click(el: Element): void {
  el.dispatchEvent(new Event('click', { bubbles: true }))
}

before(() => {
  installDom()
})

after(() => {
  windowRef.close()
})

// ===========================================================================
// Test Helpers
// ===========================================================================

function makeAlice(home: ReturnType<typeof createReactiveHome>): ReactiveNode<AliceState, AliceActions> {
  return home.node<AliceState, AliceActions>({
    state: {
      profile: {
        name: 'Alice',
        email: 'alice@example.com',
        address: '123 Main St',
        password: 's3cr3t',
      },
      balance: 1000,
    },
    actions: {
      deposit(ctx, amount) { ctx.state.balance += amount },
      withdraw(ctx, amount) { ctx.state.balance -= amount },
      updateName(ctx, name) { ctx.state.profile = { ...ctx.state.profile, name } },
      updateEmail(ctx, email) { ctx.state.profile = { ...ctx.state.profile, email } },
      updateAddress(ctx, address) { ctx.state.profile = { ...ctx.state.profile, address } },
    },
  })
}

function makeSetup() {
  const home = createReactiveHome()
  const alice = makeAlice(home)
  const bob = home.node({ state: { id: 'bob' } })
  const rel = home.relationship(bob, alice)
  return { home, alice, bob, rel }
}

// ===========================================================================
// E5-1 — Application composition
// ===========================================================================

describe('E5-1 — Application composition', () => {
  it('multiple plain View functions compose correctly', () => {
    function Header(): ChildNode {
      return element('h1', {}, text('Header'))
    }

    function Footer(): ChildNode {
      return element('footer', {}, text('Footer'))
    }

    function App(): ChildNode {
      return element('div', {}, Header(), Footer())
    }

    const home = createReactiveHome()
    const handle = mount(home, App, container())

    const h1 = document.querySelector('h1')
    const footer = document.querySelector('footer')
    assert.equal(h1?.textContent, 'Header')
    assert.equal(footer?.textContent, 'Footer')

    handle.unmount()
    home.destroy()
  })

  it('no component runtime is required', () => {
    // Views are plain functions, not component classes
    function Counter(): ChildNode {
      return element('button', {}, text('0'))
    }

    const home = createReactiveHome()
    const handle = mount(home, Counter, container())

    const btn = document.querySelector('button')
    assert.equal(btn?.textContent, '0')

    handle.unmount()
    home.destroy()
  })

  it('View functions return ChildNodes', () => {
    function MyView(): ChildNode {
      return element('div', {}, text('Hello'))
    }

    const node = MyView()
    // ChildNode is a discriminated union with type field
    assert.equal((node as { type: string }).type, 'element')

    const home = createReactiveHome()
    const handle = mount(home, MyView, container())

    const div = document.querySelector('div')
    assert.notEqual(div, null)

    handle.unmount()
    home.destroy()
  })
})

// ===========================================================================
// E5-2 — Alice Node
// ===========================================================================

describe('E5-2 — Alice Node', () => {
  it('state exists and is readable', () => {
    const { home, alice } = makeSetup()

    assert.equal(alice.state.balance, 1000)
    assert.equal(alice.state.profile.name, 'Alice')
    assert.equal(alice.state.profile.email, 'alice@example.com')

    home.destroy()
  })

  it('Actions mutate state correctly', async () => {
    const { home, alice } = makeSetup()

    alice.actions.deposit(500)
    await home.flush()
    assert.equal(alice.state.balance, 1500)

    alice.actions.updateName('Alice Updated')
    await home.flush()
    assert.equal(alice.state.profile.name, 'Alice Updated')

    home.destroy()
  })

  it('direct state mutation remains forbidden', () => {
    const { home, alice } = makeSetup()

    assert.throws(
      () => { (alice.state as unknown as Record<string, number>).balance = 999 },
      TypeError
    )

    home.destroy()
  })
})

// ===========================================================================
// E5-3 — Bob Node
// ===========================================================================

describe('E5-3 — Bob Node', () => {
  it('Bob is a separate Node', () => {
    const { home, alice, bob } = makeSetup()

    assert.notEqual(bob, alice)
    assert.equal(bob.state.id, 'bob')

    home.destroy()
  })

  it('Bob is not Alice\'s child merely because of access', () => {
    const { home, alice, bob } = makeSetup()

    assert.equal(alice.isChild, false)
    assert.equal(alice.isParent, false)
    assert.equal(bob.isChild, false)
    assert.equal(bob.isParent, false)

    home.destroy()
  })
})

// ===========================================================================
// E5-4 — Relationship
// ===========================================================================

describe('E5-4 — Relationship', () => {
  it('Bob → Alice relationship works using existing API', () => {
    const { home, alice, bob, rel } = makeSetup()

    assert.equal(rel.source, bob)
    assert.equal(rel.target, alice)
    assert.equal(rel.isDestroyed, false)

    home.destroy()
  })

  it('ownership remains unchanged after relationship', () => {
    const { home, alice, bob } = makeSetup()

    assert.equal(alice.isChild, false)
    assert.equal(alice.isParent, false)
    assert.equal(bob.isChild, false)
    assert.equal(bob.isParent, false)

    home.destroy()
  })
})

// ===========================================================================
// E5-5 — Grant
// ===========================================================================

describe('E5-5 — Grant', () => {
  it('profile.name and profile.email are authorized', async () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let seenName: string | null = null
    let seenEmail: string | null = null

    home.subscribeAs(bob, alice, grant, (view) => {
      seenName = (view.state.profile as { name: string }).name
      seenEmail = (view.state.profile as { email: string }).email
    })

    await home.flush()

    assert.equal(seenName, 'Alice')
    assert.equal(seenEmail, 'alice@example.com')

    home.destroy()
  })

  it('balance, profile.address, profile.password are unauthorized', () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    // balance should throw
    assert.throws(
      () => home.subscribeAs(bob, alice, grant, (view) => {
        void (view.state as unknown as Record<string, unknown>)['balance']
      }),
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )

    // profile.address should throw
    assert.throws(
      () => home.subscribeAs(bob, alice, grant, (view) => {
        void (view.state.profile as unknown as Record<string, unknown>)['address']
      }),
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED'
    )

    // profile.password should throw
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
// E5-6 — Authorized View
// ===========================================================================

describe('E5-6 — Authorized View', () => {
  it('Bob\'s View only receives authorized information', async () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: AuthorizedView<AliceState> | null = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    await home.flush()

    assert.notEqual(capturedView, null)
    const view = capturedView!

    // Should not expose actions
    assert.equal('actions' in view, false)

    // Should not expose destroy
    assert.equal('destroy' in view, false)

    // Should not expose ownership
    assert.equal('isParent' in view, false)
    assert.equal('isChild' in view, false)

    home.destroy()
  })
})

// ===========================================================================
// E5-7 — Unauthorized DOM exposure
// ===========================================================================

describe('E5-7 — Unauthorized DOM exposure', () => {
  it('unauthorized values NEVER appear in Bob\'s DOM', async () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: AuthorizedView<AliceState> | null = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    await home.flush()

    const view = capturedView!

    // Attempting to render unauthorized field should throw
    assert.throws(
      () => {
        mount(home, () => element('div', {},
          text(String((view.state as unknown as Record<string, unknown>)['balance']))
        ), container())
      },
      KinAuthError
    )

    home.destroy()
  })

  it('unauthorized fields are not merely hidden in DOM', async () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: AuthorizedView<AliceState> | null = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    await home.flush()

    const view = capturedView!

    // The value itself cannot be obtained, not just hidden
    assert.throws(
      () => String((view.state as unknown as Record<string, unknown>)['password']),
      KinAuthError
    )

    home.destroy()
  })
})

// ===========================================================================
// E5-8 — Alice browser interaction
// ===========================================================================

describe('E5-8 — Alice browser interaction', () => {
  it('click → EventHandler → Action → state → DOM update', async () => {
    const home = createReactiveHome()
    const alice = makeAlice(home)

    const handle = mount(
      home,
      () => element('button', {
        onClick: handler(() => alice.actions.deposit(100)),
      }, text(() => String(alice.state.balance))),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    assert.equal(btn.textContent, '1000')

    click(btn)
    await home.flush()

    assert.equal(alice.state.balance, 1100)
    assert.equal(btn.textContent, '1100')

    handle.unmount()
    home.destroy()
  })
})

// ===========================================================================
// E5-9 — No View rerender
// ===========================================================================

describe('E5-9 — No View rerender', () => {
  it('View invocation count remains one after Actions', async () => {
    const home = createReactiveHome()
    const alice = makeAlice(home)

    let viewRuns = 0

    const Counter: View = () => {
      viewRuns++
      return element('button', {
        onClick: handler(() => alice.actions.deposit(100)),
      }, text(() => String(alice.state.balance)))
    }

    const handle = mount(home, Counter, container())

    assert.equal(viewRuns, 1)

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    assert.equal(viewRuns, 1) // Did not rerun

    handle.unmount()
    home.destroy()
  })
})

// ===========================================================================
// E5-10 — Fine-grained bindings
// ===========================================================================

describe('E5-10 — Fine-grained bindings', () => {
  it('unrelated bindings do not run', async () => {
    const home = createReactiveHome()
    const alice = makeAlice(home)

    let balanceRuns = 0
    let nameRuns = 0

    const handle = mount(
      home,
      () => element('div', {},
        element('span', {}, text(() => { balanceRuns++; return String(alice.state.balance) })),
        element('span', {}, text(() => { nameRuns++; return alice.state.profile.name })),
      ),
      container(),
    )

    balanceRuns = 0
    nameRuns = 0

    // Change balance
    alice.actions.deposit(100)
    await home.flush()

    assert.equal(balanceRuns, 1)
    assert.equal(nameRuns, 0) // Name binding did not run

    // Change name
    alice.actions.updateName('New Name')
    await home.flush()

    assert.equal(balanceRuns, 1) // Balance binding did not run
    assert.equal(nameRuns, 1)

    handle.unmount()
    home.destroy()
  })
})

// ===========================================================================
// E5-11 — Authorized reactive update
// ===========================================================================

describe('E5-11 — Authorized reactive update', () => {
  it('changing Alice\'s name updates Bob\'s authorized DOM', async () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: AuthorizedView<AliceState> | null = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    await home.flush()

    const view = capturedView!

    let domName = 'initial'
    const handle = mount(
      home,
      () => element('div', {},
        text(() => { domName = (view.state.profile as { name: string }).name; return domName }),
      ),
      container(),
    )

    domName = 'initial'
    alice.actions.updateName('Alice Updated')
    await home.flush()

    assert.equal(domName, 'Alice Updated')

    handle.unmount()
    home.destroy()
  })
})

// ===========================================================================
// E5-12 — Unauthorized reactive isolation
// ===========================================================================

describe('E5-12 — Unauthorized reactive isolation', () => {
  it('changing Alice\'s balance does not update Bob\'s authorized bindings', async () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: AuthorizedView<AliceState> | null = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    await home.flush()

    const view = capturedView!

    let nameRuns = 0
    const handle = mount(
      home,
      () => element('div', {},
        text(() => { nameRuns++; return (view.state.profile as { name: string }).name }),
      ),
      container(),
    )

    nameRuns = 0

    // Change balance (unauthorized field)
    alice.actions.deposit(500)
    await home.flush()

    assert.equal(nameRuns, 0) // Name binding did not run

    handle.unmount()
    home.destroy()
  })
})

// ===========================================================================
// E5-13 — Grant revoke
// ===========================================================================

describe('E5-13 — Grant revoke', () => {
  it('existing revocation semantics work', async () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name']))

    let runs = 0
    home.subscribeAs(bob, alice, grant, (view) => {
      runs++
      void (view.state.profile as { name: string }).name
    })

    await home.flush()
    assert.equal(runs, 1)

    grant.revoke()
    assert.equal(grant.isRevoked, true)

    alice.actions.updateName('New Name')
    await home.flush()

    assert.equal(runs, 1) // Subscriber did not run after revoke

    home.destroy()
  })
})

// ===========================================================================
// E5-14 — Relationship destroy
// ===========================================================================

describe('E5-14 — Relationship destroy', () => {
  it('existing relationship/grant lifecycle preserved', () => {
    const { home, alice, bob, rel } = makeSetup()
    const grant = rel.grant(capability(['profile.name']))

    rel.destroy()

    assert.equal(rel.isDestroyed, true)
    assert.equal(grant.isRevoked, true)

    // Both nodes must still be alive
    assert.doesNotThrow(() => alice.state.balance)
    assert.doesNotThrow(() => { void bob.state })

    home.destroy()
  })
})

// ===========================================================================
// E5-15 — Node lifecycle
// ===========================================================================

describe('E5-15 — Node lifecycle', () => {
  it('Bob destruction does not destroy Alice', () => {
    const { home, alice, bob } = makeSetup()

    bob.destroy()

    assert.doesNotThrow(() => alice.state.balance)
    assert.doesNotThrow(() => alice.actions.deposit(100))

    home.destroy()
  })
})

// ===========================================================================
// E5-16 — DOM lifecycle
// ===========================================================================

describe('E5-16 — DOM lifecycle', () => {
  it('unmount removes DOM, listeners, subscriptions and is idempotent', async () => {
    const home = createReactiveHome()
    const alice = makeAlice(home)

    let handlerCalls = 0

    const handle = mount(
      home,
      () => element('button', {
        onClick: handler(() => { handlerCalls++ }),
      }, text(() => String(alice.state.balance))),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement

    handle.unmount()

    // DOM should be removed
    assert.equal(document.querySelector('button'), null)

    // Listener should not fire
    click(btn)
    await home.flush()
    assert.equal(handlerCalls, 0)

    // Unmount should be idempotent
    handle.unmount()
    handle.unmount()

    home.destroy()
  })
})

// ===========================================================================
// E5-17 — DOM identity
// ===========================================================================

describe('E5-17 — DOM identity', () => {
  it('reactive updates preserve node identity', async () => {
    const home = createReactiveHome()
    const alice = makeAlice(home)

    const handle = mount(
      home,
      () => element('button', {},
        text(() => String(alice.state.balance))),
      container(),
    )

    const btnBefore = document.querySelector('button') as HTMLButtonElement

    alice.actions.deposit(100)
    await home.flush()

    const btnAfter = document.querySelector('button') as HTMLButtonElement

    assert.equal(btnAfter, btnBefore) // Same DOM node

    handle.unmount()
    home.destroy()
  })
})

// ===========================================================================
// E5-18 — Complete integration
// ===========================================================================

describe('E5-18 — Complete integration', () => {
  it('full scenario: Alice → State → Action → Authorization → AuthorizedView → Bob DOM', async () => {
    const home = createReactiveHome()
    const alice = makeAlice(home)
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: AuthorizedView<AliceState> | null = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    await home.flush()

    const view = capturedView!

    // Mount Bob's view
    let domName = ''
    let domEmail = ''
    const handle = mount(
      home,
      () => element('div', {},
        text(() => { domName = (view.state.profile as { name: string }).name; return domName }),
        text(() => { domEmail = (view.state.profile as { email: string }).email; return domEmail }),
      ),
      container(),
    )

    // Initial state
    assert.equal(domName, 'Alice')
    assert.equal(domEmail, 'alice@example.com')

    // Alice updates name → Bob's DOM updates
    alice.actions.updateName('Alice Updated')
    await home.flush()
    assert.equal(domName, 'Alice Updated')
    assert.equal(domEmail, 'alice@example.com')

    // Alice updates balance → Bob's authorized bindings do NOT run
    alice.actions.deposit(500)
    await home.flush()
    assert.equal(domName, 'Alice Updated') // Unchanged
    assert.equal(domEmail, 'alice@example.com') // Unchanged

    handle.unmount()
    home.destroy()
  })

  it('full scenario: Bob/Alice browser event → EventHandler → Action → State → Reactive Binding → DOM', async () => {
    const home = createReactiveHome()
    const alice = makeAlice(home)

    const handle = mount(
      home,
      () => element('button', {
        onClick: handler(() => alice.actions.deposit(100)),
      }, text(() => String(alice.state.balance))),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    assert.equal(btn.textContent, '1000')

    // Browser event → EventHandler → Action → State → DOM
    click(btn)
    await home.flush()

    assert.equal(alice.state.balance, 1100)
    assert.equal(btn.textContent, '1100')

    handle.unmount()
    home.destroy()
  })
})
