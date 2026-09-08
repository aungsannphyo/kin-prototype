# kin-prototype

A minimal frontend UI framework built from scratch around a **family/relationship mental model**.

This repository is an active prototype. Phases A, B, C, D, and E are complete.

---

## Mental Model

The framework has one fundamental runtime entity:

```
Home
 └── Node
      ├── State
      ├── Actions
      ├── Children
      ├── Reactivity (Phase B)
      └── Relationships (Phase C / D)
```

`Parent` and `Child` are **not** classes or types. They are **dynamic roles** derived from ownership:

| Situation                   | Role                 |
| --------------------------- | -------------------- |
| Node owned by Home          | `isChild === false`  |
| Node owned by another Node  | `isChild === true`   |
| Node owns one or more Nodes | `isParent === true`  |
| Node owns no Nodes          | `isParent === false` |

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

| Factory                | Status                           | When to use                                                                             |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| `createReactiveHome()` | **Active — use this**            | All new code. Phases C, D, and all future framework development build on this.          |
| `createHome()`         | **Retained — non-reactive only** | Low-level testing and Phase A contract verification. Not intended for application code. |

If you are building application code, use `createReactiveHome()`.

---

## Phase A — Core Runtime

Implemented and stable. No further changes planned.

### Primitives

| Primitive         | Description                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `Home`            | Root container. Creates and owns root-level Nodes. Not a Node itself.                            |
| `Node<S>`         | Generic node with optional State, optional Actions, and zero or more children.                   |
| `State`           | Plain object owned by exactly one Node. Public surface is readonly.                              |
| `Actions`         | The only mutation boundary. Actions receive a mutable `ctx.state`.                               |
| `Lifecycle`       | `active → destroyed`. Nodes cannot mutate, create children, or invoke actions after destruction. |
| `Cascade Destroy` | Post-order destruction — children are destroyed before their parent.                             |

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
import { createReactiveHome } from "kin-prototype";

const home = createReactiveHome();

const account = home.node({
  state: { balance: 100 },
  actions: {
    deposit(ctx, amount: number) {
      ctx.state.balance += amount;
    },
    withdraw(ctx, amount: number) {
      ctx.state.balance -= amount;
    },
  },
});

account.state.balance; // 100
account.state.balance = 999; // TypeError — readonly outside action

account.actions.deposit(50);
account.state.balance; // 150

const sub = home.subscribe(() => {
  console.log("balance:", account.state.balance);
});

home.unsubscribe(sub);
await home.flush();

account.destroy();
home.destroy();
```

### Reactivity Properties

- **Field-level tracking** — dependencies tracked at `nodeId:fieldName` level
- **Auto-tracking** — reading `node.state.field` inside a subscriber registers the dep automatically
- **Dynamic deps** — dep set rebuilt from scratch on every subscriber re-run
- **Batching** — multiple mutations before a flush → subscriber runs once per flush
- **Object.is equality** — same-value assignments do not notify
- **No tree traversal** — state update cost is O(subscribers for that field), independent of node count
- **Cascade cleanup** — destroying a node disposes all its field subscriptions

### Security Boundaries

- `node.state` (public) is a **read-only tracking proxy** — throws `TypeError` on write
- `ctx.state` (inside actions) is a **mutating proxy** — checks lifecycle; throws if node is destroyed
- `ReactiveScope` is **internal only** and not exposed through the public API

---

## Phase C — Cross-Node Authorization

Implemented and stable. Built on top of Phase B.

### How It Works

```text
Relationship
      ↓
    Grant
      ↓
  Capability
      ↓
Authorization (checked once at subscribeAs() time)
      ↓
AuthorizedView → Phase B tracking machinery
```

**Relationship**: "who is connected to whom". Does NOT itself grant access.

**Grant**: Revocable authorization over a Relationship. Issued via `relationship.grant(capability(...))`.

**Capability**: The specific fields the Grant allows reading. Enforced at read time through `AuthorizedView`.

**Authorization**: Checked once at `subscribeAs()` call time — never during state mutation.

### API

```ts
import { createReactiveHome, capability } from "kin-prototype";

const home = createReactiveHome();

const alice = home.node({ state: { balance: 100 } });
const bob = home.node({
  state: { balance: 50 },
  actions: {
    deposit(ctx, n: number) {
      ctx.state.balance += n;
    },
  },
});

const rel = home.relationship(alice, bob);
const grant = rel.grant(capability(["balance"]));

home.subscribeAs(alice, bob, grant, (view) => {
  console.log("Bob balance:", view.state.balance); // ✓ allowed
  // view.state.secret  → throws KinAuthError('FIELD_NOT_GRANTED')
  // view.actions       → undefined
});

grant.revoke(); // subscription automatically disposed
```

### Key Design Rules

- **Explicit Grant selection** — `subscribeAs()` requires the caller to supply the exact Grant. No implicit "first active Grant" search.
- **Authorization at subscription time** — `notifyField → _fieldIndex → schedule → flush` is completely unchanged.
- **AuthorizedView** — callback receives only `AuthorizedView<S>`, never the raw `ReactiveNode`.
- **Revocation** — revoking Grant A disposes only its own subscriptions; Grant B unaffected; re-granting does NOT restore old subscriptions.
- **Owner authority distinct** — no wildcard Capability. Owner authority is structural.

### Security Boundaries

- `AuthorizedView` exposes only `state` — no `actions`, `destroy`, `child`, `isParent`, `isChild`, or internal Symbols.
- `AuthorizedView` is `Object.freeze()`d — property injection rejected.
- Denied field reads throw `KinAuthError('FIELD_NOT_GRANTED')` with no dep registration.
- `KinAuthError` codes: `GRANT_REVOKED`, `RELATIONSHIP_DESTROYED`, `GRANT_MISMATCH`, `FIELD_NOT_GRANTED`, `NO_RELATIONSHIP`, `NO_GRANT`.
- Grant for A→B cannot authorize A→C or X→B (`GRANT_MISMATCH`).
- `readSnapshot` is captured defensively at Grant-creation time — post-issuance Capability mutation cannot expand access.

---

## Phase D — Deep/Nested Capability Authorization

Implemented and stable. Built on top of Phase C. No changes to the Phase B reactive kernel.

### What Phase D adds

Phase C Capability was top-level-field based: `capability(['balance'])` authorized the `balance` key and its entire subtree.

Phase D extends this with **explicit nested path authorization**:

```ts
capability(["balance", "profile.name", "profile.email"]);
```

This allows fine-grained control over which nested fields are accessible through the `AuthorizedView`.

### Path grammar

Valid paths follow JavaScript identifier rules:

```
segment := [a-zA-Z_$][a-zA-Z0-9_$]*
path    := segment ('.' segment)*
```

**Invalid paths** — rejected at `capability()` time with `TypeError`:

| Pattern                                       | Reason                    |
| --------------------------------------------- | ------------------------- |
| `""`                                          | Empty string              |
| `"0"`, `"items.0"`                            | Numeric segments          |
| `"__proto__"`, `"constructor"`, `"prototype"` | Prototype-chain names     |
| `"__anything"`                                | Double-underscore prefix  |
| `"profile."`, `".profile"`, `"a..b"`          | Invalid dot placement     |
| `"profile-name"`, `"profile name"`            | Non-identifier characters |

### Authorization semantics

Three rules apply at read time:

| Situation                                                             | Behavior                                     |
| --------------------------------------------------------------------- | -------------------------------------------- |
| Path is in capability exactly                                         | ✓ allow — return value                       |
| Path has an authorized ancestor (`'profile'` grants `'profile.name'`) | ✓ allow — return value (subtree grant)       |
| Path has an authorized descendant only                                | ✓ allow — return a **filtered nested proxy** |
| No match                                                              | ✗ throw `KinAuthError('FIELD_NOT_GRANTED')`  |

### API example

```ts
const rel = home.relationship(source, target);
const grant = rel.grant(
  capability(["balance", "profile.name", "profile.email"]),
);

home.subscribeAs(source, target, grant, (view) => {
  view.state.balance; // ✓ allowed
  view.state.profile.name; // ✓ allowed — filtered nested proxy
  view.state.profile.email; // ✓ allowed
  view.state.profile.password; // ✗ throws FIELD_NOT_GRANTED
  view.state.secret; // ✗ throws FIELD_NOT_GRANTED
});
```

### Subtree grant (Phase C backward compatibility)

`capability(["profile"])` still grants the entire `profile` subtree — all nested fields are readable. This is unchanged from Phase C.

### Reactive tracking — Phase D documented limitation

Reactive dependency tracking remains **top-level** in Phase D. Reading `view.state.profile.name` registers a dep on `nodeId:profile` (not `nodeId:profile.name`).

Consequences:

- **Replacing** the `profile` object (`ctx.state.profile = newProfile`) **triggers** the subscriber. ✓
- **Mutating** a nested field in-place (`ctx.state.profile.name = 'x'`) without replacing the object reference does **NOT** trigger the subscriber.

This is intentional. Deep reactive tracking (tracking `nodeId:profile.name` independently) is deferred to a future phase.

### Capability immutability

Two independent protection layers:

1. `capability(fields)` snapshots the input array at call time. Pushing to `fields` after the fact does not affect the Capability.
2. `_readSnapshot` inside each Grant is a fresh `Set` captured at Grant-creation time. Even if the Capability's `read` Set is cast and mutated, the Grant's snapshot is unaffected.

---

## Phase E — View / Rendering

Implemented and stable. Built on top of Phase A–D. No changes to the reactive kernel or authorization system.

### Architecture

Phase E introduces a declarative View layer that is **platform-independent** and **component-free**:

```
View Definition (plain function)
      ↓
ChildNode descriptor (immutable)
      ↓
Renderer (DOM in Phase E.2)
      ↓
DOM
```

### Phase E.1 — View Model

Immutable, platform-independent descriptor types:

| Type              | Description                                                                       |
| ----------------- | --------------------------------------------------------------------------------- |
| `ChildNode`       | Discriminated union: `ElementNode \| TextNode \| FragmentNode \| ConditionalNode` |
| `ElementNode`     | HTML/XML element with tag, props, children                                        |
| `TextNode`        | Text content (static string or reactive getter)                                   |
| `FragmentNode`    | Grouping node without DOM element                                                 |
| `ConditionalNode` | Condition-based branch (`when()`)                                                 |

**Key design**:

- No DOM dependency in E.1 — descriptors work without browser
- `EventHandler` branding via `handler()` — distinguishes event callbacks from reactive getters
- All descriptors are `Object.freeze()`d with readonly children arrays

### Phase E.2 — DOM Renderer

Fine-grained DOM renderer that:

- Walks the descriptor tree once at mount
- Creates one Kin subscription per reactive getter/condition
- Updates only the affected DOM node on state change
- No Virtual DOM, no diffing, no whole-tree rerender

**Update path** (unchanged kernel):

```
Action → mutation proxy → notifyField → _fieldIndex → schedule → flush
      → affected subscription → single DOM node update
```

### Phase E.3 — View Composition

**Views are plain functions**, not components:

```ts
function Header(): ChildNode {
  return element("header", {}, text("Kin"));
}

function Counter(node: ReactiveNode): ChildNode {
  return element(
    "button",
    { onClick: handler(() => node.actions.increment()) },
    text(() => String(node.state.count)),
  );
}

function App(node: ReactiveNode): ChildNode {
  return element("main", {}, Header(), Counter(node));
}
```

**Key guarantees**:

- View functions execute once at mount, not on every state change
- Composition is ordinary function composition
- No component instances, lifecycle hooks, or VDOM
- Fine-grained reactive bindings remain independent
- Authorization boundaries preserved

### Phase E.4 — Browser Interaction & Event-to-Action Boundary

**Phase E.4 hardens the event interaction path**:

```
DOM Event
  ↓
EventHandler (branded via handler())
  ↓
Application callback
  ↓
Kin Action
  ↓
State Mutation
  ↓
Reactive Subscription
  ↓
Targeted DOM Update
```

**Key architectural guarantees**:

- **EventHandler branding is authoritative** — `isEventHandler()` distinguishes event callbacks from reactive getters using the `EVENT_HANDLER_BRAND` symbol, NOT property name heuristics
- **Renderer is generic** — the DOM renderer knows about DOM, EventHandler, ChildNode, and subscriptions, but NOT about Actions, Nodes, Relationships, Grants, or authorization
- **Application code connects events to Kin Actions** — the renderer only executes the EventHandler; the application decides what the handler does
- **Native events** — handlers receive native browser events; no synthetic event system
- **No View rerender** — state updates patch only the affected DOM binding; View functions execute once at mount
- **Listener cleanup** — every DOM listener is tracked; unmount removes listeners, subscriptions, and DOM nodes
- **Conditional listeners** — conditional branches create/remove listeners as they mount/unmount; no duplicate or stale listeners
- **Authorization boundaries preserved** — AuthorizedView does not leak Node, Action, Grant, or Relationship internals to event handlers

**Event naming**:

The `onXxx` naming convention is only a property naming convention. The renderer converts `onClick` → `click`, `onInput` → `input`, etc., but any property name can be used as long as the value is a branded EventHandler.

**Example**:

```ts
function Counter(node: ReactiveNode): ChildNode {
  return element(
    "button",
    {
      onClick: handler(() => {
        node.actions.increment();
      }),
    },
    text(() => String(node.state.count)),
  );
}
```

**Event handler identification**:

```ts
// ✅ Correct — branded handler
onClick: handler(() => node.actions.increment());

// ❌ Wrong — plain getter treated as data binding, not event
onClick: () => String(node.state.count);

// ✅ Also correct — non-onXxx name with brand works
click: handler(() => node.actions.increment());
```

### API example

```ts
import {
  createReactiveHome,
  mount,
  element,
  text,
  handler,
} from "kin-prototype";

const home = createReactiveHome();
const counter = home.node({
  state: { count: 0 },
  actions: {
    increment(ctx) {
      ctx.state.count++;
    },
  },
});

const view = element(
  "button",
  { onClick: handler(() => counter.actions.increment()) },
  text(() => String(counter.state.count)),
);

const container = document.getElementById("app");
const handle = mount(home, view, container);

// Click triggers action → reactive update → DOM text changes
// No View function rerun

handle.unmount();
home.destroy();
```

### Phase E boundaries

**NOT implemented** (out of scope for E.1–E.3):

- JSX
- Virtual DOM
- Component instances/lifecycle
- Hooks (useState, useEffect, etc.)
- Deep reactive tracking (deferred)
- SSR/hydration
- Forms framework
- Routing

### Phase E project structure

```
src/
├── view/
│   ├── types.ts    # ChildNode descriptors
│   ├── factory.ts  # element(), text(), fragment(), when(), handler()
│   └── index.ts    # View module exports
├── dom/
│   ├── types.ts    # View, MountHandle
│   ├── renderer.ts # mount() with fine-grained bindings
│   └── index.ts    # DOM module exports
```

---

### Capability immutability

Two independent protection layers:

1. `capability(fields)` snapshots the input array at call time. Pushing to `fields` after the fact does not affect the Capability.
2. `_readSnapshot` inside each Grant is a fresh `Set` captured at Grant-creation time. Even if the Capability's `read` Set is cast and mutated, the Grant's snapshot is unaffected.

---

## Project Structure

```
kin-prototype/
├── src/
│   ├── types.ts            # Type contracts (Phase A + B + C)
│   ├── node.ts             # createNode() — Phase A node factory
│   ├── home.ts             # createHome() — Phase A non-reactive entry point
│   ├── reactive.ts         # Reactive kernel (FieldSubscriberIndex, scheduler)
│   ├── reactive-node.ts    # createReactiveNode() — Phase B reactive node factory
│   ├── reactive-home.ts    # createReactiveHome() — Phase B + C entry point
│   ├── relationship.ts     # Phase C/D Relationship, Grant, Capability + path validation
│   ├── grant.ts            # Phase C GrantStore
│   ├── authorization.ts    # Phase C/D authorization, AuthorizedView, nested proxy
│   ├── view/
│   │   ├── types.ts        # Phase E.1 — ChildNode descriptors
│   │   ├── factory.ts      # Phase E.1 — element(), text(), fragment(), when(), handler()
│   │   └── index.ts        # View module exports
│   ├── dom/
│   │   ├── types.ts        # Phase E.2 — View, MountHandle
│   │   ├── renderer.ts     # Phase E.2 — mount() with fine-grained bindings
│   │   └── index.ts        # DOM module exports
│   └── index.ts            # Public exports
├── test/
│   ├── node.test.ts                # Phase A tests (31)
│   ├── reactive.test.ts            # Phase B tests (35)
│   ├── reactive-hardening.test.ts  # Phase B hardening (26)
│   ├── phase-b-gate.test.ts        # Phase B gate (19)
│   ├── phase-c.test.ts             # Phase C + D tests (88 — 48 Phase C, 40 Phase D)
│   ├── phase-e1.test.ts            # Phase E.1 tests (24)
│   ├── phase-e2.test.ts            # Phase E.2 tests (28)
│   ├── phase-e3.test.ts            # Phase E.3 tests (22)
│   └── phase-e4.test.ts            # Phase E.4 tests (26)
├── benchmark/
│   └── bench.ts            # Benchmarks S1–S6, C1–C4
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
ℹ tests 371
ℹ pass  371
ℹ fail  0
```

Run typecheck:

```bash
npm run typecheck
```

Run benchmarks:

```bash
node --import tsx/esm benchmark/bench.ts
```

---

## Completed Phases

| Phase | Status      | Description                                                                                      |
| ----- | ----------- | ------------------------------------------------------------------------------------------------ |
| A     | ✅ Complete | Home, Node, Ownership, State, Actions, Lifecycle, Cascade Destroy                                |
| B     | ✅ Complete | Field-level reactivity, subscribers, batching, lifecycle cleanup                                 |
| C     | ✅ Complete | Relationship, Grant, Capability, Authorization, Cross-node access, AuthorizedView                |
| D     | ✅ Complete | Nested path authorization, path validation, filtered nested proxies, subtree grants              |
| E     | ✅ Complete | View model, DOM renderer, fine-grained reactive bindings, View composition, no component runtime |

---

## Deferred Findings

**Deep reactive tracking** — `node.state.profile.name` registers a dep on `"profile"`, not `"profile.name"`. In-place mutation of nested objects does not notify subscribers. Replacing the whole object does. Phase D authorization is fine-grained; Phase D reactivity is not. Deep reactive tracking (`nodeId:profile.name`) remains deferred beyond Phase E.

**`ReadonlyState<S>` is shallow** — TypeScript readonly does not cover nested objects. Runtime protection is enforced by the authorization proxy, not the TypeScript type system.

**`_lifecycle` visibility** — `_lifecycle` is on the internal node interface for test observability. A future published API should expose `node.isDestroyed` instead.

**Home root enumeration** — No public `home.roots` accessor. DevTools and SSR phases will need this.

**Action authorization** — `AuthorizedView` currently exposes only `state`. Authorizing specific action invocations on the target is deferred.
