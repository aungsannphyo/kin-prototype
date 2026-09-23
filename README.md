# Kin

Kin is a minimal, fine-grained reactive UI framework with built-in capability-based authorization and direct DOM rendering.

Kin is designed around a family/relationship mental model. Applications are structured as an ownership tree of stateful **Nodes** inside a container **Home**. Data sharing between nodes is explicitly authorized through **Relationships**, **Grants**, and **Capabilities**. Views are platform-independent, immutable descriptors rendered directly to the DOM with targeted, fine-grained updates — without a Virtual DOM diffing engine or component lifecycle runtime.

---

## Central Philosophy

* **Reactive State**: State is owned by Nodes and exposed as readonly data. Reading state fields inside reactive getters registers fine-grained subscriptions automatically.
* **Explicit Actions**: State mutations are strictly isolated to Actions. Outside of an Action, Node state is deeply immutable.
* **Ownership Tree**: Nodes exist in an explicit hierarchy (`Home → Node → Node children`) with deterministic post-order cascade destruction.
* **Authorization-First Sharing**: Cross-node data access is governed by revocable `Grant` tokens carrying scoped `Capability` paths, exposing capability-filtered `AuthorizedView` proxies.
* **Fine-Grained DOM Updates**: Subscriptions bind directly to individual DOM text nodes and element properties. When state changes, only affected bindings are updated.
* **Immutable View Descriptors**: Views are pure TypeScript functions returning frozen descriptor trees (`ElementNode`, `TextNode`, `FragmentNode`, `ConditionalNode`, `EachNode`).
* **Direct DOM Rendering**: The renderer translates descriptors directly into real DOM nodes. There is no Virtual DOM, no tree diffing, and no component instance runtime.

---

## Why Kin?

Traditional frontend frameworks typically couple state management, component tree hierarchies, and UI rendering together through a Virtual DOM or complex component lifecycle systems. Cross-cutting concerns like data authorization, access control, and cross-boundary sharing are often left to external state libraries or UI-level conditional checks.

Kin takes a different approach by treating **data ownership and authorization as core runtime primitives**:

```text
Home
 └── Node
      ├── State
      ├── Actions
      └── Relationships / Grants
```

When connecting a user interface to application state, Kin bypasses whole-component re-evaluation and tree diffing:

```text
State
  ↓
Reactive getter
  ↓
View descriptor
  ↓
DOM renderer
  ↓
Targeted DOM update
```

1. **Deterministic boundaries**: A Node cannot mutate another Node's state directly.
2. **Authorized observation**: An observer Node can only view fields explicitly permitted by an active `Grant`. Unauthorized fields throw at the proxy boundary before reaching the UI.
3. **Surgical reactivity**: State mutations schedule microtask flushes that update only the exact DOM text node or attribute registered to that field. View functions run once at mount time.

---

## Installation

Install Kin via npm:

```bash
npm install kin-prototype
```

### TypeScript Configuration

Kin is distributed as standard ES2022 modules with TypeScript declarations. Configure your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022", "DOM"],
    "strict": true
  }
}
```

*Note: Bundlers such as Vite, esbuild, and Rollup can also use `"moduleResolution": "bundler"`.*

---

## Quick Start

Here is a complete, minimal counter application demonstrating reactive state, an explicit Action, a declarative view descriptor, event handling, and DOM mounting:

```ts
import {
  createReactiveHome,
  element,
  text,
  handler,
  mount,
  type ReactiveNode,
  type ChildNode,
} from 'kin-prototype'

// 1. Define State and Actions types
type CounterState = {
  count: number
}

type CounterActions = {
  increment(ctx: { state: CounterState }): void
  decrement(ctx: { state: CounterState }): void
}

// 2. Create the reactive Home container
const home = createReactiveHome()

// 3. Create a Node owning state and actions
const counter = home.node<CounterState, CounterActions>({
  state: { count: 0 },
  actions: {
    increment(ctx) {
      ctx.state.count += 1
    },
    decrement(ctx) {
      ctx.state.count -= 1
    },
  },
})

// 4. Declare the view function (pure function returning immutable descriptors)
function CounterView(node: ReactiveNode<CounterState, CounterActions>): ChildNode {
  return element(
    'div',
    { class: 'counter-card' },
    element('h1', text('Kin Counter')),
    element('p', text(() => `Current count: ${node.state.count}`)),
    element(
      'button',
      { onClick: handler(() => node.actions.increment()) },
      text('+ Increment'),
    ),
    element(
      'button',
      { onClick: handler(() => node.actions.decrement()) },
      text('- Decrement'),
    ),
  )
}

// 5. Mount into a DOM container
const container = document.getElementById('app')!
const handle = mount(home, () => CounterView(counter), container)

// Later: clean up subscriptions, event listeners, and DOM elements
// handle.unmount()
// home.destroy()
```

---

## Core Concepts

### Home

The `Home` is the root container and lifecycle coordinator. It creates and owns root-level Nodes, coordinates reactive scheduling, manages cross-node Relationships, and cleans up all descendants when destroyed.

```ts
import { createReactiveHome } from 'kin-prototype'

const home = createReactiveHome()
```

### Node

A `Node` is the fundamental runtime entity in Kin. A Node holds:
* An owned **State** record.
* Bound **Actions**.
* Optional **Child Nodes** in the ownership hierarchy.

```ts
const userNode = home.node({
  state: { username: 'alice', online: true },
  actions: {
    setOnline(ctx, status: boolean) {
      ctx.state.online = status
    },
  },
})
```

A Node has dynamic structural roles (`isParent`, `isChild`) derived from its position in the ownership tree. Destroying a Node executes post-order cascade destruction on all of its child nodes, detaches its relationships, and revokes active grants.

### State

* **Ownership**: State is a plain object owned exclusively by one Node.
* **Readonly by default**: Outside of an Action, `node.state` is a readonly proxy. Direct assignments (`node.state.count = 5`) throw a runtime `TypeError`.
* **Automatic tracking**: Reading `node.state.field` inside a reactive getter registers a dependency on `nodeId:field`.
* **Deep cloning**: Initial state is deep-cloned on node creation to prevent caller aliasing.

### Actions

Actions are the **only** mutation boundary in Kin. Each action receives a mutable context `ctx` containing `ctx.state`.

```ts
const wallet = home.node({
  state: { balance: 100 },
  actions: {
    deposit(ctx, amount: number) {
      if (amount <= 0) throw new Error('Invalid amount')
      ctx.state.balance += amount
    },
  },
})

// Invoking an action:
wallet.actions.deposit(50)
console.log(wallet.state.balance) // 150
```

When an action mutates a property, Kin compares the value with `Object.is`. If changed, a notification is queued for microtask scheduling.

### Relationships

A `Relationship` represents a directional link between two Nodes (`source → target`) within the same Home. Creating a relationship does **not** grant access by itself; it establishes the trust channel across which Grants are issued.

```ts
const alice = home.node({ state: { balance: 100, name: 'Alice' } })
const bob = home.node({ state: { id: 'bob' } })

// Establish directional relationship from observer (bob) to target (alice)
const rel = home.relationship(bob, alice)
```

### Grants

A `Grant` is an access token issued over a Relationship. Grants are revocable at any time. Revoking a grant automatically disposes all linked subscriptions.

```ts
const grant = rel.grant(capability(['name']))

// Revoke access when no longer permitted
// grant.revoke()
```

### Capabilities

A `Capability` defines which fields of the target Node are readable. Capabilities support both top-level fields and nested dot-separated paths:

```ts
import { capability } from 'kin-prototype'

// Grants read access to 'profile.name' and 'profile.email', but not 'profile.password'
const cap = capability(['profile.name', 'profile.email'])
```

Path validation rejects invalid formats, numeric indexes, prototype properties (`__proto__`, `constructor`, `prototype`), and double-underscore prefixes.

### AuthorizedView

An `AuthorizedView` is a filtered, reactively-tracked view of a target Node's state. Unauthorized field reads throw a typed `KinAuthError` with code `'FIELD_NOT_GRANTED'`.

An `AuthorizedView` can be acquired synchronously or subscribed to reactively:

```ts
// 1. Direct synchronous acquisition via Grant:
const view = grant.view<AccountState>()
console.log(view.state.profile.name) // ✓ Alice
// console.log(view.state.profile.password) // ✗ Throws KinAuthError('FIELD_NOT_GRANTED')

// 2. Direct synchronous acquisition via Home:
const view2 = home.authorizedView<AccountState>(bob, alice, grant)

// 3. Reactive subscription:
const sub = home.subscribeAs(bob, alice, grant, (view) => {
  console.log('Observed name:', view.state.profile.name)
})
```

---

## Reactivity

Kin uses a fine-grained, dependency-tracking reactive kernel.

### How It Works

1. **Dependency Registration**: When a reactive getter (e.g. `() => node.state.count`) executes, property reads on `node.state` dynamically register field dependencies (`nodeId:field`).
2. **Action Execution**: When an action mutates a property, Kin checks `Object.is(previous, next)`. If different, the field is marked dirty.
3. **Batched Microtask Flush**: Dirty fields look up their subscribers in an $O(1)$ index. Affected subscriptions are scheduled and executed in a batched microtask flush.
4. **Surgical DOM Update**: Only the specific DOM text node or element property associated with that getter is modified.

```ts
// Reactive text binding:
element('p', text(() => `Score: ${game.state.score}`))

// Reactive attribute binding:
element('div', {
  class: () => game.state.isGameOver ? 'modal visible' : 'modal hidden',
})
```

### Reactive Scope & Batched Updates

Multiple mutations inside an action or across synchronous calls are automatically coalesced:

```ts
actions.updateProfile(ctx) {
  ctx.state.score += 10
  ctx.state.level += 1
  ctx.state.score += 5
}
// Dependent subscribers run exactly once during the next microtask flush.
```

### Documented Reactivity Limitation

Kin v0.1 tracks dependencies at the **top-level field** level (`nodeId:profile`).

* **Replacing** a nested object reference (`ctx.state.profile = { ...newProfile }`) triggers subscribers.
* **Mutating** a deep nested property in place (`ctx.state.profile.name = 'Bob'`) without changing the parent object reference does **not** trigger reactive subscribers.

Always update nested state by reassigning the top-level property:

```ts
// ✓ Correct: Reassign top-level property
ctx.state.profile = { ...ctx.state.profile, name: 'Bob' }

// ✗ Ineffective for top-level reactivity:
// ctx.state.profile.name = 'Bob'
```

---

## View System

Views in Kin are **pure functions** that return immutable descriptor trees. They are not framework components, have no internal state instances, and do not execute on every state change.

```text
View Function (executes once at mount)
  ↓
ChildNode Descriptor Tree (frozen)
  ↓
DOM Renderer (wires DOM elements & fine-grained subscribers)
  ↓
Live DOM
```

### Descriptors (`ChildNode`)

All view descriptors are frozen plain JavaScript objects:

| Descriptor | Description | Factory |
|---|---|---|
| `ElementNode` | HTML element with tag name, optional props, and children | `element()` |
| `TextNode` | Static or reactive DOM text node | `text()` |
| `FragmentNode` | Transparent grouping of children without a wrapper element | `fragment()` |
| `ConditionalNode` | Reactive branching structure | `when()` |
| `EachNode` | Dynamic keyed list structure | `each()` |

---

## Props and Reactive Props

The `element()` function creates element descriptors with support for static values, reactive getters, and branded event handlers:

```ts
element('input', {
  // Static props
  id: 'username-input',
  type: 'text',

  // Reactive prop getter
  value: () => form.state.username,
  disabled: () => form.state.isSubmitting,

  // Event handler
  onInput: handler((event) => {
    const input = event.target as HTMLInputElement
    form.actions.setUsername(input.value)
  }),
})
```

### Optional Props

Props are optional. When an element does not need attributes or listeners, pass children directly:

```ts
// Props omitted:
element('div',
  element('h1', text('Title')),
  element('p', text('Paragraph')),
)
```

### Supported Prop Values (`PropValue`)

* `string | number | boolean | null | undefined`: Static attribute/property.
* `ReactiveGetter`: A zero-argument function (`() => PropValue`) returning a primitive value.
* `EventHandler`: A callback branded via `handler()`.

---

## Events

In JavaScript, reactive getters (`() => string`) and event callbacks (`() => void`) have identical function signatures at runtime. To prevent heuristics and eliminate ambiguity, Kin requires explicit event handler branding using `handler()`:

```ts
import { handler } from 'kin-prototype'

element(
  'button',
  {
    onClick: handler((event) => {
      actions.handleClick()
    }),
  },
  text('Submit'),
)
```

### Why `handler()` Is Required

1. **Avoids property name heuristics**: Naming conventions like `on[A-Z]` fail when reactive getters represent state properties such as `online: () => state.online`.
2. **Authoritative wiring**: When the DOM renderer encounters a value branded by `handler()`, it adds a native DOM event listener (`addEventListener`).
3. **Native event passing**: The callback receives the standard native browser `Event`.
4. **Lifecycle tracking**: Every event listener is tracked by the renderer and cleanly detached upon unmount.

### Advanced Utility: `isEventHandler()`

Kin exports `isEventHandler(value)` to verify whether a given property value is a branded event handler:

```ts
import { isEventHandler, handler } from 'kin-prototype'

const click = handler(() => {})
isEventHandler(click) // true
isEventHandler(() => 'value') // false
```

---

## Keyed Lists with `each()`

Dynamic collections are rendered using the `each()` primitive. It reconciles real DOM nodes between comment anchors (`<!--kin-each-->` and `<!--/kin-each-->`) using key extractors:

```ts
import { each, element, text, handler, type ChildNode } from 'kin-prototype'

function TodoList(node: ReactiveNode<TodoState, TodoActions>): ChildNode {
  return element(
    'ul',
    { class: 'todo-list' },
    each(
      () => node.state.todos,
      (todo) => todo.id,
      (todo, getIndex) =>
        element(
          'li',
          { id: `todo-${todo.id}` },
          element('span', text(todo.title)),
          element(
            'button',
            { onClick: handler(() => node.actions.remove(todo.id)) },
            text('Delete'),
          ),
        ),
    ),
  )
}
```

### Guarantees of `each()`

* **Keyed identity retention**: Existing DOM nodes are preserved and repositioned; element instances are not recreated during reordering.
* **Item-local reactivity**: When an item's fields update, only that item's reactive bindings execute. Sibling items and parent collections do not rerender.
* **Surgical insertions and deletions**: Appending, prepending, and removing items only touch the affected DOM nodes.
* **Lifecycle disposal**: Removed items automatically have all associated reactive subscriptions and event listeners disposed recursively.
* **Duplicate key protection**: Duplicate keys throw a descriptive runtime error.

---

## Conditional Views with `when()`

The `when()` primitive provides declarative conditional branching:

```ts
import { when, element, text } from 'kin-prototype'

when(
  () => node.state.count < 0,
  element('p', { class: 'warning' }, text('Warning: Negative balance')),
  element('p', { class: 'info' }, text('Account in good standing')),
)
```

* **`condition`**: A reactive getter returning a boolean (`() => boolean`).
* **`consequent`**: The descriptor rendered when the condition evaluates to `true`.
* **`otherwise`** *(optional)*: The descriptor rendered when the condition evaluates to `false`.
* **Lifecycle**: When branches switch, old nodes, subscriptions, and listeners are unmounted and disposed before new branch nodes are materialized.

---

## Authorization + Views

Kin enables capability-based access control directly integrated into the view layer:

```text
Alice Node (owns sensitive state)
      ↓
Relationship (Bob → Alice)
      ↓
Grant (scoped capability: ['profile.name', 'profile.email'])
      ↓
Capability Filter
      ↓
AuthorizedView (Alice's state behind security proxy)
      ↓
Bob's Reactive DOM (renders only permitted fields)
```

### Example: Secure Account Sharing

```ts
import {
  createReactiveHome,
  capability,
  element,
  text,
  mount,
  type AuthorizedView,
} from 'kin-prototype'

const home = createReactiveHome()

// Alice owns sensitive account details
const alice = home.node({
  state: {
    balance: 5000,
    profile: {
      name: 'Alice Smith',
      email: 'alice@example.com',
      passwordHash: 'secret_hash_987',
    },
  },
  actions: {},
})

// Bob is an observer node
const bob = home.node({ state: { id: 'bob' } })

// Issue a grant permitting only name and email
const rel = home.relationship(bob, alice)
const grant = rel.grant(capability(['profile.name', 'profile.email']))

// Acquire Bob's authorized view
const bobView = grant.view<typeof alice.state>()

function SharedProfileView(view: AuthorizedView<typeof alice.state>) {
  return element(
    'div',
    { class: 'profile-card' },
    element('h3', text(() => `Name: ${view.state.profile.name}`)),   // ✓ Permitted
    element('p', text(() => `Email: ${view.state.profile.email}`)),  // ✓ Permitted
    // Reading view.state.balance throws KinAuthError('FIELD_NOT_GRANTED')
    // Reading view.state.profile.passwordHash throws KinAuthError('FIELD_NOT_GRANTED')
  )
}

mount(home, () => SharedProfileView(bobView), document.getElementById('shared-ui')!)
```

Unauthorized fields are protected at the proxy level. They cannot be read, bound, or leaked into the DOM.

---

## Lifecycle

The `mount()` function mounts a descriptor tree into a container element and returns a `MountHandle`:

```ts
import { mount } from 'kin-prototype'

const handle = mount(home, () => AppView(node), container)

// Teardown
handle.unmount()
```

### Teardown Guarantees

* **Subscriptions**: All reactive subscriptions created for text nodes, prop bindings, conditional branches, and keyed lists are cancelled.
* **DOM Event Listeners**: All native listeners attached via `handler()` are removed with `removeEventListener`.
* **DOM Cleanup**: Generated DOM nodes and comment markers are detached from the container.
* **Idempotency**: Calling `handle.unmount()` multiple times is safe and performs no duplicate work.

---

## Security Model

Kin incorporates runtime hardening developed and verified in Phase F:

* **Deep Readonly State**: `node.state` is protected by a readonly proxy outside of Actions. Prototype properties (`__proto__`, `constructor`, `prototype`) evaluate to `undefined`.
* **State Type Validation**: Initial state and action assignments accept only valid primitives, plain objects, and arrays. Special types (`Date`, `RegExp`, `Map`, `Set`, class instances) are rejected to eliminate prototype poisoning vectors.
* **Nested Mutation Defense**: Mutating nested state objects outside of actions throws a runtime `TypeError`.
* **Proxy Invariant Compliance**: Proxies maintain ECMAScript invariant compatibility with frozen and sealed targets.
* **Cross-Home Isolation**: Relationships, Grants, and AuthorizedViews cannot cross Home container boundaries.
* **Defensive Snapshots**: Capability paths are snapshotted on creation; mutating the original configuration array does not alter issued grants.

---

## API Reference

### Runtime Exports

Kin exports 13 public runtime symbols from `'kin-prototype'`:

```ts
import {
  createReactiveHome,
  createHome,
  capability,
  KinAuthError,
  element,
  text,
  fragment,
  when,
  each,
  handler,
  isEventHandler,
  isChildNode,
  mount,
} from 'kin-prototype'
```

| Symbol | Category | Description |
|---|---|---|
| `createReactiveHome()` | Core | Creates a reactive Home container with scheduling, relationships, and authorization. |
| `createHome()` | Core | Creates a non-reactive Phase A Home container (for testing/benchmarking). |
| `capability(fields)` | Authorization | Creates a validated, immutable `Capability` from an array of path strings. |
| `KinAuthError` | Authorization | Error class thrown on authorization failures (with `.code` discriminant). |
| `element(tag, props?, ...children)` | View | Creates an `ElementNode` descriptor (props are optional). |
| `text(value)` | View | Creates a `TextNode` descriptor from a static string or reactive getter. |
| `fragment(...children)` | View | Creates a `FragmentNode` descriptor grouping children without a wrapper DOM node. |
| `when(condition, consequent, otherwise?)` | View | Creates a `ConditionalNode` descriptor for reactive branching. |
| `each(collection, key, render)` | View | Creates an `EachNode` descriptor for keyed dynamic list reconciliation. |
| `handler(fn)` | Events | Brands a callback function as an authoritative `EventHandler`. |
| `isEventHandler(value)` | Utility | Runtime type guard returning `true` if `value` is an `EventHandler`. |
| `isChildNode(value)` | Utility | Runtime type guard returning `true` if `value` is a valid `ChildNode` descriptor. |
| `mount(home, view, container)` | DOM | Renders a descriptor tree into a DOM container and returns a `MountHandle`. |

### Important Types

```ts
import type {
  ReactiveHome,
  ReactiveNode,
  ReactiveNodeDefinition,
  ActionContext,
  ActionsMap,
  BoundActions,
  ReadonlyState,
  StateRecord,
  Subscriber,
  Home,
  Node,
  NodeDefinition,
  LifecycleState,
  Capability,
  Grant,
  Relationship,
  KinAuthErrorCode,
  AuthorizedView,
  View,
  MountHandle,
  ChildNode,
  ElementNode,
  TextNode,
  FragmentNode,
  ConditionalNode,
  EachNode,
  KeyExtractor,
  ItemRenderer,
  PropValue,
  ReactiveGetter,
  EventHandler,
} from 'kin-prototype'
```

*Note: Internal branding symbols (`EVENT_HANDLER_BRAND`, `CHILD_NODE_BRAND`) are module-private and intentionally excluded from public exports.*

---

## Architecture

Kin is organized into discrete architectural layers:

```text
Core Runtime       (Home, Node, State, Actions, Cascade Destruction)
    ↓
Reactivity         (ReactiveScope, FieldSubscriberIndex, Scheduler)
    ↓
Authorization      (Relationship, Grant, Capability, AuthorizedView)
    ↓
View Descriptors   (Immutable ChildNode Trees: Element, Text, When, Each)
    ↓
DOM Renderer       (Materialization, Fine-Grained Bindings, Keyed Reconciliation)
    ↓
Browser DOM        (Native Events, Targeted DOM Updates)
```

### Architectural Boundaries

Kin intentionally avoids traditional framework abstractions:
* **No Virtual DOM**: Real DOM nodes are created directly and patched in place.
* **No Component Runtime**: Views are plain functions returning descriptors. There are no component instances, hidden states, or component lifecycles.
* **No Router**: Kin focuses on state, authorization, and rendering. Application routing is left to standard web platform APIs or dedicated routing libraries.
* **No Global State Store**: Nodes own their state and coordinate through the Home hierarchy and authorized Relationships.
* **No SSR Runtime**: Kin v0.1 requires a global `document` environment (browser or test DOM like Happy DOM).

---

## Demos and Playgrounds

The repository contains runnable integration demos and interactive browser applications:

* **Reactive Counter**: `playground/index.html`
* **Keyed Dynamic List (`each`)**: `playground/todo.html`
* **Capability-Based Account Sharing**: `playground/account-sharing.html`
* **Console Demo**: `demo/account-sharing.ts` (`npm run demo`)
* **Browser Demo Script**: `demo/browser-app.ts` (`npm run browser-demo`)

To run the interactive playground locally:

```bash
npm run playground:dev
```

---

## Running Tests

Kin has a comprehensive test suite with 638 tests covering Phases A through G:

```bash
npm test
```

Expected result:

```text
# tests 638
# suites 281
# pass 633
# fail 0
# skipped 5
```

Type checking:

```bash
npm run typecheck
```

Building the package:

```bash
npm run build
```

---

## License

MIT © Aung Sann Phyo
