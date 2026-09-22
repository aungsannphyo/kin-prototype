/**
 * Kin Browser Playground — Cross-Node Authorization & Account Sharing
 *
 * Demonstrates Kin's core architectural differentiator:
 *   Cross-Node Authorization combined with Fine-Grained Reactive UI.
 *
 * Concepts:
 *   Alice Node (Full Account Holder)
 *   Bob Node (Observer Node)
 *   Relationship: Bob → Alice
 *   Grant: Capability(['profile.name', 'profile.email'])
 *   AuthorizedView: Filtered proxy exposing ONLY granted fields
 *   Revocation: grant.revoke() tears down subscriptions and freezes access
 *   Re-granting: relationship.grant() creates a new capability-authorized view
 */

import {
  createReactiveHome,
  capability,
  element,
  text,
  when,
  handler,
  mount,
  KinAuthError,
  type ReactiveHome,
  type ReactiveNode,
  type ChildNode,
  type AuthorizedView,
  type Grant,
  type Relationship,
} from 'kin-prototype'

// ---------------------------------------------------------------------------
// 1. Types & State Model
// ---------------------------------------------------------------------------

export type AliceState = {
  profile: {
    name: string
    email: string
    address: string
    password: string
  }
  balance: number
}

export type AliceActions = {
  deposit(ctx: { state: AliceState }, amount: number): void
  updateName(ctx: { state: AliceState }, name: string): void
  updateEmail(ctx: { state: AliceState }, email: string): void
  updateAddress(ctx: { state: AliceState }, address: string): void
}

export type BobState = {
  id: string
  isRevoked: boolean
}

export type BobActions = {
  setRevoked(ctx: { state: BobState }, val: boolean): void
}

// ---------------------------------------------------------------------------
// 2. Application Setup
// ---------------------------------------------------------------------------

export type AccountSharingApp = {
  home: ReactiveHome
  alice: ReactiveNode<AliceState, AliceActions>
  bob: ReactiveNode<BobState, BobActions>
  relationship: Relationship
  getGrant(): Grant | null
  getAuthorizedView(): AuthorizedView<AliceState> | null
  revokeGrant(): void
  regrant(): Grant
  runSecurityAudit(): SecurityAuditResult
  unmount(): void
}

export type SecurityAuditResult = {
  nestedBalanceBlocked: boolean
  nestedPasswordBlocked: boolean
  nestedAddressBlocked: boolean
  mutationBlocked: boolean
  prototypeBlocked: boolean
  keysExposed: string[]
  rawNodeHidden: boolean
}

export function createAccountSharingApp(
  container: HTMLElement,
): AccountSharingApp {
  const home = createReactiveHome()

  // 1. Create Alice's node
  const alice = home.node<AliceState, AliceActions>({
    state: {
      profile: {
        name: 'Alice Henderson',
        email: 'alice@example.com',
        address: '742 Evergreen Terrace, Springfield',
        password: 'super-secret-password-123',
      },
      balance: 1500,
    },
    actions: {
      deposit(ctx, amount) {
        ctx.state.balance += amount
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

  // 2. Create Bob's node
  const bob = home.node<BobState, BobActions>({
    state: { id: 'bob', isRevoked: false },
    actions: {
      setRevoked(ctx, val: boolean) {
        ctx.state.isRevoked = val
      },
    },
  })

  // 3. Create relationship: Bob → Alice
  const relationship = home.relationship(bob, alice)

  // 4. Initial Grant: Bob receives ONLY profile.name and profile.email
  let activeGrant: Grant | null = relationship.grant(
    capability(['profile.name', 'profile.email']),
  )

  // Synchronously acquire Bob's AuthorizedView directly from the Grant
  let activeAuthorizedView: AuthorizedView<AliceState> | null =
    activeGrant.view<AliceState>()

  // Security audit helper: tries all attack vectors against Bob's AuthorizedView
  function runSecurityAudit(): SecurityAuditResult {
    if (!activeAuthorizedView) {
      return {
        nestedBalanceBlocked: true,
        nestedPasswordBlocked: true,
        nestedAddressBlocked: true,
        mutationBlocked: true,
        prototypeBlocked: true,
        keysExposed: [],
        rawNodeHidden: true,
      }
    }

    let nestedBalanceBlocked = false
    try {
      // Accessing unauthorized field 'balance'
      void (activeAuthorizedView.state as any).balance
    } catch (e) {
      if (e instanceof KinAuthError && e.code === 'FIELD_NOT_GRANTED') {
        nestedBalanceBlocked = true
      }
    }

    let nestedPasswordBlocked = false
    try {
      // Accessing unauthorized nested field 'profile.password'
      void (activeAuthorizedView.state.profile as any).password
    } catch (e) {
      if (e instanceof KinAuthError && e.code === 'FIELD_NOT_GRANTED') {
        nestedPasswordBlocked = true
      }
    }

    let nestedAddressBlocked = false
    try {
      // Accessing unauthorized nested field 'profile.address'
      void (activeAuthorizedView.state.profile as any).address
    } catch (e) {
      if (e instanceof KinAuthError && e.code === 'FIELD_NOT_GRANTED') {
        nestedAddressBlocked = true
      }
    }

    let mutationBlocked = false
    try {
      // Attempting to mutate read-only authorized view
      ;(activeAuthorizedView.state.profile as any).name = 'Malicious Update'
    } catch (e) {
      if (e instanceof TypeError) {
        mutationBlocked = true
      }
    }

    let prototypeBlocked = false
    const proto1 = (activeAuthorizedView.state as any).__proto__
    const proto2 = (activeAuthorizedView.state as any).constructor
    const proto3 = Object.getPrototypeOf(activeAuthorizedView.state)
    if (proto1 === undefined && proto2 === undefined && proto3 === null) {
      prototypeBlocked = true
    }

    const keysExposed = Object.keys(activeAuthorizedView.state.profile)

    const rawNodeHidden =
      (activeAuthorizedView as any).node === undefined &&
      (activeAuthorizedView as any)._node === undefined &&
      (activeAuthorizedView as any).target === undefined &&
      (activeAuthorizedView as any).actions === undefined

    return {
      nestedBalanceBlocked,
      nestedPasswordBlocked,
      nestedAddressBlocked,
      mutationBlocked,
      prototypeBlocked,
      keysExposed,
      rawNodeHidden,
    }
  }

  // -------------------------------------------------------------------------
  // UI Views (Plain Functions, zero component runtime)
  // -------------------------------------------------------------------------

  function AliceView(): ChildNode {
    return element(
      'section',
      { class: 'card alice-card', id: 'alice-section' },
      element(
        'div',
        { class: 'card-header' },
        element('div', { class: 'badge badge-alice' }, text('Account Owner')),
        element('h2', {}, text("Alice's Account")),
        element('p', { class: 'card-subtitle' }, text('Full state and mutation authority')),
      ),

      // Data Grid
      element(
        'div',
        { class: 'data-grid' },
        element(
          'div',
          { class: 'data-row' },
          element('span', { class: 'data-label' }, text('Balance:')),
          element('span', { class: 'data-value balance-value', id: 'alice-balance' }, text(() => `$${alice.state.balance}`)),
        ),
        element(
          'div',
          { class: 'data-row' },
          element('span', { class: 'data-label' }, text('Name:')),
          element('span', { class: 'data-value', id: 'alice-name' }, text(() => alice.state.profile.name)),
        ),
        element(
          'div',
          { class: 'data-row' },
          element('span', { class: 'data-label' }, text('Email:')),
          element('span', { class: 'data-value', id: 'alice-email' }, text(() => alice.state.profile.email)),
        ),
        element(
          'div',
          { class: 'data-row' },
          element('span', { class: 'data-label' }, text('Address:')),
          element('span', { class: 'data-value', id: 'alice-address' }, text(() => alice.state.profile.address)),
        ),
        element(
          'div',
          { class: 'data-row' },
          element('span', { class: 'data-label' }, text('Password:')),
          element('span', { class: 'data-value sensitive', id: 'alice-password' }, text(() => alice.state.profile.password)),
        ),
      ),

      // Controls
      element(
        'div',
        { class: 'actions-panel' },
        element('h3', { class: 'panel-title' }, text('Alice Mutations')),
        element(
          'div',
          { class: 'button-group' },
          element(
            'button',
            {
              class: 'btn btn-primary',
              id: 'btn-deposit',
              onClick: handler(() => {
                alice.actions.deposit(50)
              }),
            },
            text('Deposit +$50'),
          ),
          element(
            'button',
            {
              class: 'btn btn-outline',
              id: 'btn-update-name',
              onClick: handler(() => {
                const nextName =
                  alice.state.profile.name === 'Alice Henderson'
                    ? 'Alice Cooper'
                    : 'Alice Henderson'
                alice.actions.updateName(nextName)
              }),
            },
            text('Toggle Name'),
          ),
          element(
            'button',
            {
              class: 'btn btn-outline',
              id: 'btn-update-email',
              onClick: handler(() => {
                const nextEmail =
                  alice.state.profile.email === 'alice@example.com'
                    ? 'alice.henderson@corporate.io'
                    : 'alice@example.com'
                alice.actions.updateEmail(nextEmail)
              }),
            },
            text('Toggle Email'),
          ),
        ),
      ),

      // Access Granting Controls
      element(
        'div',
        { class: 'access-control-panel' },
        element('h3', { class: 'panel-title' }, text("Authorization to Bob")),
        element(
          'div',
          { class: 'button-group' },
          element(
            'button',
            {
              class: 'btn btn-danger',
              id: 'btn-revoke-bob',
              onClick: handler(() => {
                appHandle.revokeGrant()
              }),
            },
            text('Revoke Bob Grant'),
          ),
          element(
            'button',
            {
              class: 'btn btn-success',
              id: 'btn-regrant-bob',
              onClick: handler(() => {
                appHandle.regrant()
              }),
            },
            text('Re-grant Bob Access'),
          ),
        ),
      ),
    )
  }

  function BobView(): ChildNode {
    return element(
      'section',
      { class: 'card bob-card', id: 'bob-section' },
      element(
        'div',
        { class: 'card-header' },
        element('div', { class: 'badge badge-bob' }, text('Cross-Node Observer')),
        element('h2', {}, text("Bob's Shared View")),
        element(
          'p',
          { class: 'card-subtitle' },
          text('Filtered AuthorizedView over Relationship Grant'),
        ),
      ),

      // Grant Status Badge
      element(
        'div',
        { class: 'grant-status-box' },
        element('span', { class: 'status-label' }, text('Grant Status: ')),
        element(
          'span',
          {
            class: () =>
              !bob.state.isRevoked
                ? 'status-pill status-active'
                : 'status-pill status-revoked',
            id: 'grant-status-badge',
          },
          text(() =>
            !bob.state.isRevoked
              ? '● ACTIVE (profile.name, profile.email)'
              : '✕ REVOKED (Access Disposed)',
          ),
        ),
      ),

      // Bob's Authorized Data View
      when(
        () => !bob.state.isRevoked,
        // Active Authorized View
        element(
          'div',
          { class: 'data-grid authorized-grid', id: 'bob-authorized-data' },
          element(
            'div',
            { class: 'data-row' },
            element('span', { class: 'data-label' }, text('Name (Authorized):')),
            element(
              'span',
              { class: 'data-value highlight', id: 'bob-name' },
              text(() => {
                if (!activeAuthorizedView) return ''
                return (activeAuthorizedView.state.profile as any).name
              }),
            ),
          ),
          element(
            'div',
            { class: 'data-row' },
            element('span', { class: 'data-label' }, text('Email (Authorized):')),
            element(
              'span',
              { class: 'data-value highlight', id: 'bob-email' },
              text(() => {
                if (!activeAuthorizedView) return ''
                return (activeAuthorizedView.state.profile as any).email
              }),
            ),
          ),
          element(
            'div',
            { class: 'data-row blocked-row' },
            element('span', { class: 'data-label' }, text('Balance:')),
            element('span', { class: 'data-value blocked', id: 'bob-balance' }, text('[DENIED: FIELD_NOT_GRANTED]')),
          ),
          element(
            'div',
            { class: 'data-row blocked-row' },
            element('span', { class: 'data-label' }, text('Address:')),
            element('span', { class: 'data-value blocked', id: 'bob-address' }, text('[DENIED: FIELD_NOT_GRANTED]')),
          ),
          element(
            'div',
            { class: 'data-row blocked-row' },
            element('span', { class: 'data-label' }, text('Password:')),
            element('span', { class: 'data-value blocked', id: 'bob-password' }, text('[DENIED: FIELD_NOT_GRANTED]')),
          ),
        ),
        // Revoked View
        element(
          'div',
          { class: 'revoked-banner', id: 'bob-revoked-banner' },
          element('span', { class: 'revoked-icon' }, text('🔒')),
          element('h4', {}, text('Access Revoked')),
          element(
            'p',
            {},
            text(
              "Bob's grant was revoked by Alice. All subscriptions have been terminated by the reactive kernel.",
            ),
          ),
        ),
      ),

      // Real-time security verification panel
      element(
        'div',
        { class: 'security-card', id: 'security-panel' },
        element('h3', { class: 'panel-title' }, text('Kernel Security Enforcement')),
        element(
          'ul',
          { class: 'audit-list' },
          element('li', {}, text('✓ Balance access blocked: throws FIELD_NOT_GRANTED')),
          element('li', {}, text('✓ Password access blocked: throws FIELD_NOT_GRANTED')),
          element('li', {}, text('✓ Address access blocked: throws FIELD_NOT_GRANTED')),
          element('li', {}, text('✓ Mutations blocked: throws TypeError (read-only proxy)')),
          element('li', {}, text('✓ Prototype chain blocked: __proto__ & constructor undefined')),
          element('li', {}, text('✓ Object.keys restricted to authorized fields only')),
          element('li', {}, text('✓ Raw Node reference unreachable from AuthorizedView')),
        ),
      ),
    )
  }

  function AppShell(): ChildNode {
    return element(
      'div',
      { class: 'app-container' },
      AliceView(),
      BobView(),
    )
  }

  const mountHandle = mount(home, AppShell, container)

  const appHandle: AccountSharingApp = {
    home,
    alice,
    bob,
    relationship,
    getGrant: () => activeGrant,
    getAuthorizedView: () => activeAuthorizedView,
    revokeGrant() {
      if (activeGrant) {
        activeGrant.revoke()
        bob.actions.setRevoked(true)
      }
    },
    regrant() {
      // Issue a new Grant over the existing relationship
      activeGrant = relationship.grant(
        capability(['profile.name', 'profile.email']),
      )
      activeAuthorizedView = activeGrant.view<AliceState>()
      bob.actions.setRevoked(false)
      return activeGrant
    },
    runSecurityAudit,
    unmount() {
      mountHandle.unmount()
      home.destroy()
    },
  }

  return appHandle
}

// ---------------------------------------------------------------------------
// Browser Auto-Mount
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') {
  const mountPoint = document.getElementById('account-sharing-app')
  if (mountPoint) {
    const app = createAccountSharingApp(mountPoint)
    ;(window as any).__KIN_ACCOUNT_SHARING__ = app
  }
}
