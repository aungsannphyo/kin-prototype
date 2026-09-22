# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/).

---

## [0.1.0-alpha.1] — 2026-09-22

### First internal alpha release.

This release packages the Kin prototype as an importable TypeScript module.
It is intended for internal review and early adopter feedback only.

---

### Core concepts

| Concept | Description |
|---|---|
| `Home` | Root container. Creates and owns root-level Nodes. |
| `Node` | The only runtime entity. Holds state, actions, and children. |
| `Relationship` | Directional connection between two Nodes (source → target). Does not confer access by itself. |
| `Grant` | Access token issued over a Relationship. Carries a `Capability`. |
| `Capability` | Describes which fields of the target Node are readable. |
| `AuthorizedView` | Capability-filtered, reactively-tracked view of a target Node's state. |

### View layer

| Export | Description |
|---|---|
| `element(tag, props, ...children)` | Create an ElementNode descriptor. |
| `text(value)` | Create a TextNode descriptor (static or reactive getter). |
| `fragment(...children)` | Group children without a wrapping DOM element. |
| `when(condition, then, otherwise?)` | Conditional branch descriptor. |
| `handler(fn)` | Wrap a callback as a branded EventHandler. |
| `mount(home, view, container)` | Render a descriptor tree into a DOM container. Returns `MountHandle`. |

---

### What is included

#### Phase A — Core Runtime
- `createHome()` / `Node` / `Home`
- Ownership tree (Home → Node → Node children)
- Deep readonly state proxy (mutation blocked outside Actions)
- Cascade destroy (post-order)

#### Phase B — Fine-Grained Reactivity
- `createReactiveHome()` / `ReactiveNode`
- Microtask-based scheduler with deduplication and cascade-flush
- Top-level field dependency tracking
- `subscribe()` / `unsubscribe()` / `flush()`

#### Phase C — Cross-Node Authorization
- `Relationship` / `Grant` / `Capability` / `capability()`
- `subscribeAs(source, target, grant, run)` — authorized cross-node subscription
- Grant revocation disposes linked subscriptions
- Node destruction cascades to its Relationships and their Grants
- `KinAuthError` with typed `code` discriminant

#### Phase D — Nested Capability Authorization
- Dot-separated capability paths: `capability(['profile.name', 'profile.email'])`
- Filtered nested proxy (Rule 1–4 path matching)
- Subtree grants: `capability(['profile'])` authorizes all sub-fields
- Deep path grants: `capability(['profile.name'])` exposes a filtered proxy at `profile`

#### Phase E — View / DOM Rendering
- Platform-independent descriptor types (`ChildNode` discriminated union)
- DOM renderer with fine-grained Kin subscribers (no Virtual DOM)
- Reactive text bindings, reactive prop bindings, event listeners
- Conditional branches with mount/unmount lifecycle
- `unmount()` idempotent cleanup (subscriptions + listeners + DOM nodes)

#### Phase F — Security Hardening
- State deep-clone on node creation (caller cannot alias internal state)
- State model enforcement: only primitives, plain objects, and arrays accepted
- Proxy invariant fixes for frozen/sealed/non-extensible targets
- Prototype pollution blocked (`__proto__`, `constructor`, `prototype` return `undefined`)

---

### Architectural constraints (intentional non-features for 0.1.x)

- No React-style components
- No Virtual DOM
- No router
- No global state management
- No SSR
- No deep reactive tracking (top-level fields only)
- No wildcard capabilities
- No RBAC
- Reactive dependency tracking is top-level only: `node.state.profile.name` tracks `profile`, not `profile.name`

---

### Known limitations

- `deepCloneState` clones plain objects and arrays at node-creation time. Assigning an external object reference back via an Action will always be treated as "different" even if the content is identical, because the internal value is a clone. This is correct behaviour — identity semantics apply to the cloned internal value.
- The DOM renderer requires a global `document` (browser or happy-dom in tests). SSR is out of scope.
- Cross-Home Relationships are not supported.

---

### Breaking changes

None — this is the first release.

---

[0.1.0-alpha.1]: https://github.com/aungsannphyo/kin-prototype/releases/tag/v0.1.0-alpha.1
