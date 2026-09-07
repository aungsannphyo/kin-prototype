# Kin Phase D — Real-World Validation Demo

This directory contains a self-contained demonstration of the **Kin Phase D runtime**
in a realistic account-sharing scenario.

## Purpose

This demo validates that the Kin runtime can solve a realistic cross-node authorization
problem using the existing public API. It is **not** a Phase E feature or application
framework — it is a Phase D milestone validation exercise.

## Scenario

Alice owns an account with a full profile and a balance.
Bob is a separate independent node.

Alice creates a **Relationship** to Bob and issues a **Grant** with a restricted
**Capability** that allows Bob to read only `profile.name` and `profile.email`.

```text
Alice Node
  └── state: { profile: { name, email, address, password }, balance }

Bob Node
  └── state: { id: 'bob' }

Alice ──── Relationship ──── Bob
                │
             Grant
                │
    capability(['profile.name', 'profile.email'])
                │
          AuthorizedView
```

Bob's authorized view:

```
profile.name     ✓ allowed
profile.email    ✓ allowed
profile.address  ✗ FIELD_NOT_GRANTED
profile.password ✗ FIELD_NOT_GRANTED
balance          ✗ FIELD_NOT_GRANTED
```

## What it demonstrates

| Feature | Phase |
| ------- | ----- |
| `createReactiveHome()` + `home.node()` | A / B |
| Action-only state mutation | A |
| `home.relationship()` | C |
| `relationship.grant(capability([...]))` | C / D |
| `home.subscribeAs(alice, bob, grant, view => ...)` | C / D |
| Nested path authorization (`profile.name`) | D |
| Denied access throwing `FIELD_NOT_GRANTED` | C / D |
| Reactive updates (profile replacement triggers subscriber) | B / D |
| `grant.revoke()` — `GRANT_REVOKED` error | C |
| `relationship.destroy()` — Grants revoked, Nodes survive | C |
| Node destruction cascades to Relationships | C |

## How to run

```bash
npm run demo
```

or directly:

```bash
node --import tsx/esm demo/account-sharing.ts
```

## Reactive tracking — Phase D documented limitation

In Phase D, dependency tracking remains **top-level**. Reading
`view.state.profile.name` registers a dep on `profile` (the whole key),
not `profile.name` independently.

This means:

- **Replacing** the profile object (e.g. `ctx.state.profile = { ...profile, name: 'New' }`) **triggers** the subscriber. ✓
- **Mutating** `profile.name` in-place without replacing the object reference does **not** trigger the subscriber.

Deep reactive tracking (`profile.name` as an independent dep) is Phase E scope and is
intentionally not implemented here.

## Not Phase E

This demo does **not** introduce:

- A View class or rendering system
- A component lifecycle
- React / DOM integration
- JSX
- A renderer or virtual DOM
- Any new runtime API

It uses only the existing Kin public API as defined in Phase C/D.
