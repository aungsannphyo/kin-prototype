# kin-prototype

A minimal frontend UI framework built from scratch around a **family/relationship mental model**.

This repository contains the **Phase A core runtime** — the foundational layer that everything else will be built on top of.

---

## Mental Model

The framework has one fundamental runtime entity:

```
Home
 └── Node
      ├── State
      ├── Actions
      └── Children
```

`Parent` and `Child` are **not** classes or types. They are **dynamic roles** derived from ownership:

| Situation | Role |
|---|---|
| Node owned by Home | `isChild === false` |
| Node owned by another Node | `isChild === true` |
| Node owns one or more Nodes | `isParent === true` |
| Node owns no Nodes | `isParent === false` |

A Node can be both Parent and Child simultaneously (a "middle" node in the tree).

**Example tree:**

```
Home
├── A          → isParent=true,  isChild=false
│   ├── C      → isParent=true,  isChild=true
│   │   └── E  → isParent=false, isChild=true
│   └── D      → isParent=false, isChild=true
└── B          → isParent=true,  isChild=false
    └── F      → isParent=false, isChild=true
```

---

## Phase A — What Was Built

### Core Primitives

| Primitive | Description |
|---|---|
| `Home` | Root container. Creates and owns root-level Nodes. Not a Node itself. |
| `Node<S>` | Generic node with optional State, optional Actions, and zero or more children. |
| `State` | Plain object owned by exactly one Node. Public surface is readonly. |
| `Actions` | The only mutation boundary. Actions receive a mutable `ctx.state`. |
| `Lifecycle` | `active → destroyed`. Nodes cannot mutate, create children, or invoke actions after destruction. |
| `Cascade Destroy` | Post-order destruction — children are destroyed before their parent. |

### API

```ts
import { createHome } from 'kin-prototype'

// Create a Home
const home = createHome()

// Create a root Node
const account = home.node({
  state: {
    balance: 100,
  },
  actions: {
    deposit(ctx, amount: number) {
      ctx.state.balance += amount
    },
    withdraw(ctx, amount: number) {
      ctx.state.balance -= amount
    },
  },
})

// Create a child Node
const transaction = account.child({
  state: {
    amount: 0,
  },
  actions: {
    setAmount(ctx, amount: number) {
      ctx.state.amount = amount
    },
  },
})

// Read state (readonly)
account.state.balance         // 100

// Mutate via actions only
account.actions.deposit(50)
account.state.balance         // 150

// Direct mutation throws at runtime
account.state.balance = 999   // TypeError

// Dynamic roles
account.isParent              // true
account.isChild               // false (owned by Home)
transaction.isParent          // false
transaction.isChild           // true  (owned by account)

// Destroy (cascades to all descendants)
account.destroy()
// transaction is also destroyed

// Idempotent — second call is a no-op
account.destroy()
```

### Key Design Rules

- **Single owner** — a Node has exactly one owner (either Home or another Node). There is no re-parenting API.
- **Action-only mutation** — `node.state` is a readonly Proxy outside of an Action. Direct assignment throws a `TypeError` at runtime.
- **Cascade destruction** — destroying a Node destroys all its descendants first (post-order), then detaches from its owner.
- **Dynamic roles** — `isParent` and `isChild` are derived getters, not stored booleans. They update automatically as the tree changes.
- **No `any`** — the entire implementation uses TypeScript generics. State type `S` flows from the node definition through to `ctx.state` and `node.state`.

---

## Project Structure

```
kin-prototype/
├── src/
│   ├── types.ts      # All type contracts (StateRecord, ActionContext, InternalNode, Home, …)
│   ├── node.ts       # createNode() — core node factory
│   ├── home.ts       # createHome() — root container factory
│   └── index.ts      # Public exports
├── test/
│   └── node.test.ts  # 31 tests across 22 suites
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## Running the Tests

```bash
npm install
npm test
```

Output:

```
ℹ tests 31
ℹ suites 22
ℹ pass 31
ℹ fail 0
```

### Test Coverage

| # | Test | What it verifies |
|---|---|---|
| 1 | Create Home | `createHome()` returns a valid Home |
| 2 | Create root Node | Root node has `isChild=false`, `isParent=false` |
| 3 | Node with State | State is readable; proxy is a different reference from raw state |
| 4 | Action mutation | `deposit` / `withdraw` mutate state correctly |
| 5 | Direct mutation blocked | Assigning to `node.state` throws `TypeError` at runtime |
| 6 | Child creation | `A.isParent=true`, `B.isChild=true`, `B.isParent=false` |
| 7 | Middle Node roles | `B.isChild=true` and `B.isParent=true` simultaneously |
| 8 | Child destruction | Destroying B removes it from A; `A.isParent` becomes false |
| 9 | Cascade destruction | Destroying A destroys all descendants (post-order) |
| 10 | Destroyed Node cannot mutate | Invoking an action after `destroy()` throws |
| 11 | Destroyed Node cannot create children | Calling `child()` after `destroy()` throws |
| 12 | Destroy is idempotent | Calling `destroy()` twice does not corrupt the runtime |
| 13 | No re-parenting API | `move`, `reparent`, `changeOwner`, `setOwner` do not exist |
| — | Invariants 1–8 | Single owner, no cycles, state isolation, action-only mutation, cascade, dynamic roles, Home boundary |
| — | Home.destroy() | Cascades to all root nodes; creating on destroyed Home throws |

---

## TypeScript

```bash
npm run typecheck
```

Strict mode is fully enabled: `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`. Zero `any` is used in the implementation.

---

## What Phase A Intentionally Does NOT Include

Phase A validates only the smallest possible core. The following are explicitly deferred:

- View / JSX
- Bond / Relationship / Grant
- Reactivity / Subscriptions / Derived state
- Async Actions
- Re-parenting
- Persistence / SSR
- DevTools / Compiler

---

## Deferred Findings

These are concrete observations from Phase A implementation to consider in later phases:

**Deep readonly state** — `ReadonlyState<S>` is shallow-readonly at the TypeScript level. Nested objects can still be mutated through the proxy at runtime. Phase B should decide whether deep freezing or a recursive proxy is needed.

**Action context extensibility** — `ActionContext<S>` is currently `{ state: S }` only. Future phases may need `ctx.dispatch`, `ctx.emit`, or `ctx.self`. The type is a named alias so adding fields is non-breaking.

**`_lifecycle` visibility** — `_lifecycle` is on the public interface (prefixed `_`) to support test observability. A published API should hide this behind a symbol or a dedicated `node.isDestroyed` getter.

**Home root enumeration** — Home has no way to enumerate its root nodes from the outside. DevTools and SSR phases will likely need a `home.roots` surface.
