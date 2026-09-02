# kin-prototype

A minimal frontend UI framework built from scratch around a **family/relationship mental model**.

This repository is an active prototype. Phases A and B are complete. Phase C (Relationship + Grant) is next.

---

## Mental Model

The framework has one fundamental runtime entity:

```
Home
 └── Node
      ├── State
      ├── Actions
      ├── Children
      └── Reactivity (Phase B)
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

## Entry Point Decision — `createHome` vs `createReactiveHome`

There are two Home factories in the codebase:

| Factory | Status | When to use |
|---|---|---|
| `createReactiveHome()` | **Active — use this** | All new code. Phase C, Phase D, and all future framework development build on this. |
| `createHome()` | **Retained — non-reactive only** | Low-level testing and Phase A contract verification. Not intended for application code. |

`createHome()` is kept because it validates the ownership/lifecycle invariants independently of reactivity. Its tests serve as a correctness baseline for the Node model. However, it is **not** the entry point for application development and will not be extended in future phases.

If you are building application code, use `createReactiveHome()`.

---

## Phase A — Core Runtime

Implemented and stable. No further changes planned.

### Primitives

| Primitive | Description |
|---|---|
| `Home` | Root container. Creates and owns root-level Nodes. Not a Node itself. |
| `Node<S>` | Generic node with optional State, optional Actions, and zero or more children. |
| `State` | Plain object owned by exactly one Node. Public surface is readonly. |
| `Actions` | The only mutation boundary. Actions receive a mutable `ctx.state`. |
| `Lifecycle` | `active → destroyed`. Nodes cannot mutate, create children, or invoke actions after destruction. |
| `Cascade Destroy` | Post-order destruction — children are destroyed before their parent. |

### Key Design Rules

- **Single owner** — a Node has exactly one owner (either Home or another Node). No re-parenting API.
- **Action-only mutation** — `node.state` is a readonly Proxy outside of an Action. Direct assignment throws a `TypeError` at runtime.
- **Cascade destruction** — destroying a Node destroys all descendants first (post-order), then detaches from its owner.
- **Dynamic roles** — `isParent` and `isChild` are derived getters, not stored booleans.
- **No `any`** — generics throughout. State type `S` flows from definition to `ctx.state` and `node.state`.

---

## Phase B — Fine-Grained Reactivity

Implemented and hardened. Built on top of Phase A.

### How It Works

```
Action mutates ctx.state.field
    → Object.is(prev, next) — skip if equal
    → scope.notifyField("nodeId:field")
    → FieldSubscriberIndex lookup  O(1)
    → affected subscribers scheduled
    → microtask flush
    → subscribers re-run, dependencies rebuilt
```

State updates never traverse the ownership tree or any relationship graph.

### API

```ts
import { createReactiveHome } from 'kin-prototype'

const home = createReactiveHome()

const account = home.node({
  state: { balance: 100 },
  actions: {
    deposit(ctx, amount: number) { ctx.state.balance += amount },
    withdraw(ctx, amount: number) { ctx.state.balance -= amount },
  },
})

const transaction = account.child({
  state: { amount: 0 },
  actions: {
    setAmount(ctx, amount: number) { ctx.state.amount = amount },
  },
})

// Read state (readonly — throws on direct write)
account.state.balance         // 100
account.state.balance = 999   // TypeError

// Mutate via actions only
account.actions.deposit(50)
account.state.balance         // 150

// Subscribe — callback runs immediately, re-runs when deps change
const sub = home.subscribe(() => {
  console.log('balance:', account.state.balance)
})

// Unsubscribe
home.unsubscribe(sub)

// Await flush (useful in tests)
await home.flush()

// Destroy (cascades to all descendants, cleans all subscriptions)
account.destroy()
home.destroy()
```

### Reactivity Properties

- **Field-level tracking** — dependencies are tracked at the `nodeId:fieldName` level
- **Auto-tracking** — reading `node.state.field` inside a subscriber registers the dep automatically
- **Dynamic deps** — dep set is rebuilt from scratch on every subscriber re-run
- **Batching** — multiple mutations before a flush → subscriber runs once per flush
- **Object.is equality** — same-value assignments do not notify
- **No tree traversal** — state update cost is O(subscribers for that field), independent of node count
- **Cascade cleanup** — destroying a node disposes all its field subscriptions

### Security Boundaries

- `node.state` (public) is a **read-only tracking proxy** — throws `TypeError` on write
- `ctx.state` (inside actions) is a **mutating proxy** — also checks lifecycle; throws if node is destroyed
- The reactive scope (`ReactiveScope`) is **internal only** and not exposed through the public API
- There is no path to call `notifyField()` or `trackField()` directly from consumer code

---

## Project Structure

```
kin-prototype/
├── src/
│   ├── types.ts            # Type contracts (Phase A + Phase B)
│   ├── node.ts             # createNode() — Phase A node factory
│   ├── home.ts             # createHome() — Phase A non-reactive entry point
│   ├── reactive.ts         # Reactive kernel (FieldSubscriberIndex, scheduler)
│   ├── reactive-node.ts    # createReactiveNode() — Phase B reactive node factory
│   ├── reactive-home.ts    # createReactiveHome() — Phase B entry point
│   └── index.ts            # Public exports
├── test/
│   ├── node.test.ts                # Phase A tests (31 tests)
│   ├── reactive.test.ts            # Phase B tests (35 tests)
│   └── reactive-hardening.test.ts  # Phase B hardening tests (26 tests)
├── benchmark/
│   └── bench.ts            # Phase B synthetic benchmark (S1–S6)
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

Expected output:

```
ℹ tests 92+
ℹ pass  92+
ℹ fail  0
```

Run typecheck:

```bash
npm run typecheck
```

Run benchmark:

```bash
node --import tsx/esm benchmark/bench.ts
```

---

## Completed Phases

| Phase | Status | Description |
|---|---|---|
| A | ✅ Complete | Home, Node, Ownership, State, Actions, Lifecycle, Cascade Destroy |
| B | ✅ Complete | Field-level reactivity, subscribers, batching, lifecycle cleanup |
| C | 🔜 Next | Relationship + Grant + cross-tree authorization |

---

## Deferred Findings

**Nested-path tracking** — `node.state.profile.name` registers a dep on `"profile"`, not `"profile.name"`. In-place mutation of nested objects does not notify. Replacing the whole object does. Phase C decision point.

**`ReadonlyState<S>` is shallow** — TypeScript readonly does not cover nested objects. Runtime protection exists only at the top level via the proxy.

**`_lifecycle` visibility** — `_lifecycle` is on the internal node interface for test observability. A future published API should expose `node.isDestroyed` instead.

**Home root enumeration** — No public `home.roots` accessor. DevTools and SSR phases will need this.
