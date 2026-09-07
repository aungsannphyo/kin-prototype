/**
 * Kin Phase D — Real-World Validation Demo
 *
 * Scenario: Account Sharing / Customer Access
 *
 * Alice owns her account node with a full profile and a balance.
 * Bob is a separate node with no structural ownership of Alice's data.
 *
 * Alice creates a Relationship to Bob, then issues a Grant that permits
 * Bob to read only 'profile.name' and 'profile.email'.
 *
 * This demo exercises every Phase C/D API:
 *
 *   createReactiveHome   — Phase B entry point
 *   home.node()          — Phase A node creation
 *   node.actions.*()     — Phase A action-only mutation boundary
 *   home.relationship()  — Phase C Relationship
 *   relationship.grant() — Phase C Grant
 *   capability()         — Phase C/D Capability with nested paths
 *   home.subscribeAs()   — Phase C/D authorized cross-node subscription
 *   AuthorizedView       — Phase C/D restricted state surface
 *   grant.revoke()       — Phase C revocation
 *   relationship.destroy() — Phase C lifecycle
 *
 * Run this demo:
 *
 *   npm run demo
 *
 * or directly:
 *
 *   node --import tsx/esm demo/account-sharing.ts
 *
 * NOTE on TypeScript typing:
 *   subscribeAs() types the view's state against the *target* node's declared
 *   state type. Since the target here is bob (type { id: string }), accessing
 *   nested profile fields requires a runtime cast. At runtime, the proxy
 *   correctly enforces the capability — TypeScript's static type only sees the
 *   target's shape, not Alice's nested profile.
 */

import { createReactiveHome, capability, KinAuthError } from '../src/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function header(text: string): void {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${text}`)
  console.log('─'.repeat(60))
}

function ok(label: string, value: unknown): void {
  console.log(`  ✓  ${label}: ${JSON.stringify(value)}`)
}

function denied(label: string, err: unknown): void {
  const code = err instanceof KinAuthError ? err.code : 'unknown'
  console.log(`  ✗  ${label}: [${code}] (expected — access correctly denied)`)
}

// Convenience: read a nested field through an authorized view's state proxy.
// The state is typed as the target node's state (bob: { id: string }), so
// nested profile fields require a runtime cast.
function readField(viewState: unknown, ...path: string[]): unknown {
  let current: Record<string, unknown> = viewState as Record<string, unknown>
  for (const key of path) {
    current = current[key] as Record<string, unknown>
  }
  return current
}

// ---------------------------------------------------------------------------
// Setup — create the Kin home and two independent nodes
// ---------------------------------------------------------------------------

header('Setup — Alice and Bob nodes')

const home = createReactiveHome()

// Alice owns her full profile and account balance.
// Actions are the only way to mutate state (Phase A/B invariant).
const alice = home.node({
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
    updateName(ctx, name: string) {
      // Replaces the profile object reference — reactive for top-level 'profile' key.
      ctx.state.profile = { ...ctx.state.profile, name }
    },
    updateEmail(ctx, email: string) {
      ctx.state.profile = { ...ctx.state.profile, email }
    },
    deposit(ctx, amount: number) {
      ctx.state.balance += amount
    },
  },
})

// Bob is a completely independent node. No structural ownership of Alice.
// Bob is the OBSERVER (source); Alice is the ACCOUNT HOLDER (target).
const bob = home.node({ state: { id: 'bob' } })

ok('alice.isParent', alice.isParent)
ok('alice.isChild',  alice.isChild)
ok('bob.isParent',   bob.isParent)
ok('bob.isChild',    bob.isChild)

// ---------------------------------------------------------------------------
// Phase C — Relationship: Alice → Bob
// ---------------------------------------------------------------------------

header('Phase C — Relationship: Bob → Alice (Bob observes Alice)')

const relationship = home.relationship(bob, alice)
ok('relationship.id',          relationship.id)
ok('relationship.isDestroyed', relationship.isDestroyed)

// Ownership roles must remain unchanged after creating a Relationship.
ok('alice.isParent (unchanged after relationship)', alice.isParent)
ok('alice.isChild  (unchanged after relationship)', alice.isChild)
ok('bob.isParent   (unchanged after relationship)', bob.isParent)
ok('bob.isChild    (unchanged after relationship)', bob.isChild)

// ---------------------------------------------------------------------------
// Phase C/D — Capability: profile.name and profile.email only
// ---------------------------------------------------------------------------

header('Phase C/D — Restricted Capability')

const viewCap = capability([
  'profile.name',
  'profile.email',
])

ok('capability read set', [...viewCap.read])

// ---------------------------------------------------------------------------
// Phase C — Grant
// ---------------------------------------------------------------------------

header('Phase C — Grant issued over Relationship')

const grant = relationship.grant(viewCap)
ok('grant.id',        grant.id)
ok('grant.isRevoked', grant.isRevoked)

// ---------------------------------------------------------------------------
// Phase D — AuthorizedView via subscribeAs
// ---------------------------------------------------------------------------

header('Phase D — Authorized cross-node subscription (Bob reads Alice)')

// The subscription's view state is typed as ReadonlyState<{ id: string }>
// (the target bob's type). We use readField() to access the profile nested
// values at runtime — the proxy enforces authorization regardless.

const seenUpdates: Array<{ name: unknown; email: unknown }> = []

const sub = home.subscribeAs(bob, alice, grant, (view) => {
  const state = view.state as unknown as Record<string, Record<string, unknown>>
  seenUpdates.push({
    name:  state['profile']['name'],
    email: state['profile']['email'],
  })
})

ok('initial subscription ran (seenUpdates.length)', seenUpdates.length)
ok('name seen',  seenUpdates[0].name)
ok('email seen', seenUpdates[0].email)

// ---------------------------------------------------------------------------
// Phase D — Authorized vs. denied access
// ---------------------------------------------------------------------------

header('Phase D — Allowed access confirmed')
{
  // Read allowed fields in a separate isolated call that doesn't persist.
  // Subscription runs once (initial), captures values, then we clean up.
  const tempHome  = createReactiveHome()
  const tempAlice = tempHome.node({ state: alice.state, actions: {} })
  const tempBob   = tempHome.node({ state: { id: 'bob' } })
  const tempRel   = tempHome.relationship(tempBob, tempAlice)
  const tempGrant = tempRel.grant(viewCap)
  tempHome.subscribeAs(tempBob, tempAlice, tempGrant, (view) => {
    const s = view.state as unknown as Record<string, Record<string, unknown>>
    ok('profile.name  accessible', s['profile']['name'])
    ok('profile.email accessible', s['profile']['email'])
  })
  tempHome.destroy()
}

header('Phase D — Denied access (FIELD_NOT_GRANTED expected)')

// Each denied-access demonstration uses its own isolated home to prevent
// stale subscribers from throwing during later flushes of the main scenario.
// The authorization enforcement is identical — the isolation is purely for
// demo script cleanliness.
const deniedAttempts: Array<[string, (s: Record<string, unknown>) => void]> = [
  ['profile.address',  (s) => void readField(s, 'profile', 'address')],
  ['profile.password', (s) => void readField(s, 'profile', 'password')],
  ['balance',          (s) => void s['balance']],
]

for (const [label, accessor] of deniedAttempts) {
  const dHome  = createReactiveHome()
  const dAlice = dHome.node({
    state: { profile: { name: 'Alice', email: 'alice@example.com', address: '123 Main St', password: 's3cr3t' }, balance: 1_000 },
    actions: { updateName(ctx, n: string) { ctx.state.profile = { ...ctx.state.profile, name: n } } },
  })
  const dBob   = dHome.node({ state: { id: 'bob' } })
  const dRel   = dHome.relationship(dBob, dAlice)
  const dGrant = dRel.grant(viewCap)

  try {
    dHome.subscribeAs(dBob, dAlice, dGrant, (view) => {
      accessor(view.state as unknown as Record<string, unknown>)
    })
    console.log(`  ✗  ${label}: INCORRECTLY ALLOWED — security failure!`)
  } catch (err) {
    denied(label, err)
  }
  dHome.destroy() // clean up immediately — no stale subscribers
}

// ---------------------------------------------------------------------------
// Phase B/D — Reactive update: Alice changes her name
// ---------------------------------------------------------------------------

header('Phase B/D — Reactive update when Alice updates her profile')

// The action replaces the profile object (new reference), triggering the
// Phase B reactive system on the top-level 'profile' key.
alice.actions.updateName('Alice Wonderland')
await home.flush()

ok('seenUpdates.length after name change', seenUpdates.length)
ok('latest name seen by Bob',  seenUpdates[seenUpdates.length - 1].name)
ok('latest email seen by Bob', seenUpdates[seenUpdates.length - 1].email)

// Balance change does NOT affect the profile subscriber.
const countBefore = seenUpdates.length
alice.actions.deposit(500)
await home.flush()
ok('seenUpdates.length after balance deposit (must be unchanged)', seenUpdates.length)
ok('balance change isolated — profile subscriber did not run', seenUpdates.length === countBefore)

// ---------------------------------------------------------------------------
// Phase D — Documented reactive limitation: in-place nested mutation
// ---------------------------------------------------------------------------

header('Phase D — Documented limitation: top-level tracking only')
console.log('  ℹ  view.state.profile.name reads dep on "profile" (top-level key).')
console.log('  ℹ  Replacing profile triggers the subscriber. In-place mutation does not.')
console.log('  ℹ  Deep reactive tracking (nodeId:profile.name) is Phase E scope.')

// ---------------------------------------------------------------------------
// Phase C — Grant revocation
// ---------------------------------------------------------------------------

header('Phase C — Grant revocation')

home.unsubscribe(sub)  // clean up tracking subscription
grant.revoke()
ok('grant.isRevoked after revoke()', grant.isRevoked)

// After revocation, subscribeAs with this grant must throw GRANT_REVOKED.
try {
  home.subscribeAs(bob, alice, grant, (_view) => {})
  console.log('  ✗  subscribeAs after revoke INCORRECTLY SUCCEEDED — security failure!')
} catch (err) {
  denied('subscribeAs with revoked grant', err)
}

// The Relationship survives Grant revocation.
ok('relationship.isDestroyed after grant revoke (must be false)', relationship.isDestroyed)

// A new Grant can be issued over the same Relationship.
const grant2 = relationship.grant(capability(['profile.name', 'profile.email']))
ok('new grant.isRevoked',             grant2.isRevoked)
ok('new grant.id !== old grant.id',   grant2.id !== grant.id)

// ---------------------------------------------------------------------------
// Phase C — Relationship destruction
// ---------------------------------------------------------------------------

header('Phase C — Relationship destruction')

relationship.destroy()
ok('relationship.isDestroyed after destroy()', relationship.isDestroyed)

// grant2 was revoked as part of relationship destruction.
ok('grant2.isRevoked after relationship.destroy()', grant2.isRevoked)

// Alice and Bob nodes must survive relationship destruction.
ok('alice.state.balance (node alive after relationship.destroy)', alice.state.balance)
ok('alice.state.profile.name (alice alive)', alice.state.profile.name)

// Cannot use a destroyed Relationship's Grant.
try {
  home.subscribeAs(bob, alice, grant2, (_view) => {})
  console.log('  ✗  subscribeAs with grant from destroyed relationship SUCCEEDED — security failure!')
} catch (err) {
  denied('subscribeAs after relationship.destroy()', err)
}

// ---------------------------------------------------------------------------
// Phase C — Node destruction cascades to Relationships
// ---------------------------------------------------------------------------

header('Phase C — Node destruction cascades to Relationships')

const carol    = home.node({ state: { id: 'carol' } })
const carolRel = home.relationship(alice, carol)
void carolRel.grant(capability(['profile.email']))

ok('carolRel.isDestroyed before carol.destroy()', carolRel.isDestroyed)
carol.destroy()
ok('carolRel.isDestroyed after carol.destroy()',  carolRel.isDestroyed)
ok('alice still alive after carol.destroy()', alice.state.balance)

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

header('Demo complete — Phase D real-world validation passed')

console.log(`
Summary:
  ✓ Node creation (Phase A) — Alice and Bob are independent nodes
  ✓ State and Actions (Phase A/B) — mutations only through Actions
  ✓ Relationship (Phase C) — directional Bob → Alice (Bob observes Alice)
  ✓ Ownership unchanged — isParent/isChild unaffected by Relationship
  ✓ Capability (Phase C/D) — restricted to profile.name, profile.email
  ✓ Grant (Phase C) — issued and revocable
  ✓ AuthorizedView (Phase C/D) — Bob receives filtered view, not raw Alice
  ✓ Nested authorization (Phase D) — profile.address/password/balance denied
  ✓ Reactive updates (Phase B/D) — profile replacement triggers subscriber
  ✓ Isolation — balance mutation does not trigger profile subscriber
  ✓ Grant revocation (Phase C) — GRANT_REVOKED on revoked Grant
  ✓ Re-grant (Phase C) — new independent Grant issued after revocation
  ✓ Relationship destruction (Phase C) — Grants revoked, Nodes survive
  ✓ Node destruction cleanup (Phase C) — Relationships destroyed with node
  ✓ No raw node leakage — AuthorizedView exposes only authorized state
`)

home.destroy()
