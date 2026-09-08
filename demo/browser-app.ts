/**
 * Kin Phase E.5 — Real Application Composition & End-to-End Validation
 *
 * Browser Application Demo: Account Sharing / Customer Access
 *
 * This demo proves that the existing Kin architecture can build a realistic
 * browser application using ONLY primitives established in Phases A–E.4.
 *
 * Scenario:
 *   Alice owns an account with balance and profile.
 *   Bob is a separate observer node.
 *   Bob → Alice relationship with restricted grant (profile.name, profile.email).
 *
 * Architecture:
 *   State → Actions → Relationships → Grants → Deep Authorization
 *   → AuthorizedView → View Composition → DOM Renderer → Browser Event
 *   → EventHandler → Kin Action → State Mutation → Fine-Grained Reactive DOM Update
 *
 * Run this demo:
 *
 *   npm run browser-demo
 *
 * or directly:
 *
 *   node --import tsx/esm demo/browser-app.ts
 *
 * NOTE: This is a DOM-based demo. It requires a browser environment or happy-dom.
 * For automated testing, see test/phase-e5.test.ts.
 */

import { createReactiveHome, capability, type ReactiveNode, type AuthorizedView } from '../src/index.js'
import {
  element,
  text,
  handler,
} from '../src/view/index.js'
import { mount } from '../src/dom/index.js'

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
// View Components (Plain Functions - No Component Runtime)
// ===========================================================================

function SectionHeader(title: string): ReturnType<typeof element> {
  return element('h2', {}, text(title))
}

function LabeledField(label: string, value: string | number): ReturnType<typeof element> {
  return element('div', { style: 'margin: 8px 0;' },
    element('strong', {}, text(`${label}: `)),
    text(String(value))
  )
}

function Button(
  label: string,
  onClickHandler: ReturnType<typeof handler>,
): ReturnType<typeof element> {
  return element('button', {
    onClick: onClickHandler,
    style: 'margin: 4px; padding: 4px 8px;',
  }, text(label))
}

// ===========================================================================
// Alice's Account View (Full Access)
// ===========================================================================

function AccountBalance(node: ReactiveNode<AliceState, AliceActions>): ReturnType<typeof element> {
  return element('div', { style: 'margin: 16px 0; padding: 12px; background: #f0f0f0; border-radius: 4px;' },
    LabeledField('Balance', `$${node.state.balance}`),
    element('div', { style: 'margin-top: 8px;' },
      Button('Deposit $100', handler(() => node.actions.deposit(100))),
      Button('Withdraw $100', handler(() => node.actions.withdraw(100))),
    )
  )
}

function AccountProfile(node: ReactiveNode<AliceState, AliceActions>): ReturnType<typeof element> {
  return element('div', { style: 'margin: 16px 0; padding: 12px; background: #f9f9f9; border-radius: 4px;' },
    LabeledField('Name', node.state.profile.name),
    LabeledField('Email', node.state.profile.email),
    LabeledField('Address', node.state.profile.address),
    LabeledField('Password', '••••••••'),
    element('div', { style: 'margin-top: 12px;' },
      Button('Update Name', handler(() => node.actions.updateName('Alice Updated'))),
      Button('Update Email', handler(() => node.actions.updateEmail('alice.updated@example.com'))),
    )
  )
}

function AliceAccount(node: ReactiveNode<AliceState, AliceActions>): ReturnType<typeof element> {
  return element('section', { style: 'margin: 16px; padding: 16px; border: 2px solid #333; border-radius: 8px;' },
    SectionHeader("Alice's Account"),
    AccountBalance(node),
    AccountProfile(node),
  )
}

// ===========================================================================
// Bob's Shared View (Authorized Access Only)
// ===========================================================================

function SharedProfile(view: AuthorizedView<AliceState>): ReturnType<typeof element> {
  // view.state is a filtered proxy - only authorized fields are accessible
  // Attempting to read balance, address, or password would throw KinAuthError
  return element('div', { style: 'margin: 16px 0; padding: 12px; background: #e8f5e9; border-radius: 4px;' },
    LabeledField('Name', (view.state.profile as { name: string }).name),
    LabeledField('Email', (view.state.profile as { email: string }).email),
    LabeledField('Balance', 'NOT AVAILABLE'),
    LabeledField('Address', 'NOT AVAILABLE'),
    LabeledField('Password', 'NOT AVAILABLE'),
  )
}

function BobSharedView(view: AuthorizedView<AliceState>): ReturnType<typeof element> {
  return element('section', { style: 'margin: 16px; padding: 16px; border: 2px solid #4caf50; border-radius: 8px;' },
    SectionHeader("Bob — Shared Access"),
    text('Bob can only see profile.name and profile.email through AuthorizedView'),
    SharedProfile(view),
  )
}

// ===========================================================================
// Main Application View
// ===========================================================================

function App(
  aliceNode: ReactiveNode<AliceState, AliceActions>,
  bobView: AuthorizedView<AliceState>,
): ReturnType<typeof element> {
  return element('div', { style: 'font-family: system-ui; max-width: 600px; margin: 0 auto;' },
    element('h1', { style: 'text-align: center;' }, text('Kin Phase E.5 — Account Sharing Demo')),
    AliceAccount(aliceNode),
    BobSharedView(bobView),
    element('div', { style: 'margin: 16px; padding: 16px; background: #fff3cd; border-radius: 4px;' },
      text('Security: Bob cannot access balance, address, or password. Authorization is enforced by Grant/AuthorizedView, not by DOM hiding.'),
    )
  )
}

// ===========================================================================
// Application Setup
// ===========================================================================

export async function createAccountSharingApp(container: HTMLElement): Promise<() => void> {
  // Create the Kin home
  const home = createReactiveHome()

  // Create Alice's account node with full state and actions
  const alice = home.node<AliceState, AliceActions>({
    state: {
      profile: {
        name: 'Alice',
        email: 'alice@example.com',
        address: '123 Main St, Yangon',
        password: 's3cr3t',
      },
      balance: 1000,
    },
    actions: {
      deposit(ctx, amount) {
        ctx.state.balance += amount
      },
      withdraw(ctx, amount) {
        ctx.state.balance -= amount
      },
      updateName(ctx, name) {
        ctx.state.profile = { ...ctx.state.profile, name }
      },
      updateEmail(ctx, email) {
        ctx.state.profile = { ...ctx.state.profile, email }
      },
      updateAddress(ctx, address) {
        ctx.state.profile = { ...ctx.state.profile, address }
      },
    },
  })

  // Create Bob as a separate observer node
  const bob = home.node({ state: { id: 'bob' } })

  // Create relationship: Bob (source/observer) → Alice (target/account holder)
  const relationship = home.relationship(bob, alice)

  // Create grant with restricted capability
  const grant = relationship.grant(capability(['profile.name', 'profile.email']))

  // Create authorized subscription - Bob receives only authorized view
  let authorizedView: AuthorizedView<AliceState> | null = null
  home.subscribeAs(bob, alice, grant, (view) => {
    authorizedView = view
  })

  await home.flush()

  if (!authorizedView) {
    throw new Error('Failed to create authorized view')
  }

  // Mount the application (authorizedView is non-null after check)
  const view = () => App(alice, authorizedView!)
  const handle = mount(home, view, container)

  // Return cleanup function
  return () => {
    handle.unmount()
    home.destroy()
  }
}

// ===========================================================================
// Entry Point (for manual testing in browser)
// ===========================================================================

if (globalThis.document !== undefined) {
  // Running in browser or happy-dom environment
  const container = globalThis.document.getElementById('app')
  if (container) {
    createAccountSharingApp(container).then((cleanup) => {
      console.log('Account sharing app mounted. Call cleanup() to unmount.')
      ;(globalThis as any).__appCleanup = cleanup
    }).catch((err) => {
      console.error('Failed to mount app:', err)
    })
  } else {
    console.error('Container element with id="app" not found')
  }
} else {
  console.log('This demo requires a DOM environment. Run with happy-dom or in a browser.')
}
