/**
 * Phase B Gate Tests
 *
 * Regression tests for the two architectural fixes applied at the
 * Phase B → Phase C boundary:
 *
 *   FIX 1 — Sealed reactive internals (_scope, _nodeId removed from public API)
 *   FIX 2 — Lifecycle guard on the mutating proxy (leaked ctx.state cannot
 *            mutate a destroyed node)
 *
 * These tests encode security-boundary contracts, not implementation details.
 * They should remain green for the entire life of the project.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createReactiveHome } from '../src/index.js'

// ---------------------------------------------------------------------------
// FIX 1 — Sealed internals
// ---------------------------------------------------------------------------

describe('FIX 1 — _scope is not accessible on the public node API', () => {
  it('node does not expose _scope', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { x: 0 } }) as unknown as Record<string, unknown>
    assert.equal('_scope' in node, false, '_scope must not exist on the public node')
    home.destroy()
  })

  it('node does not expose _nodeId', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { x: 0 } }) as unknown as Record<string, unknown>
    assert.equal('_nodeId' in node, false, '_nodeId must not exist on the public node')
    home.destroy()
  })

  it('ReactiveScope is not accessible through the public index', async () => {
    // ReactiveScope was removed from the public exports.
    // This test verifies the import boundary by checking that no
    // scope-like object is reachable from a standard consumer import.
    const mod = await import('../src/index.js')
    const exports = Object.keys(mod)
    assert.equal(
      exports.includes('ReactiveScope'),
      false,
      'ReactiveScope must not appear in the public index exports'
    )
    assert.equal(
      exports.includes('createReactiveScope'),
      false,
      'createReactiveScope must not appear in the public index exports'
    )
  })

  it('a consumer cannot forge a field notification through the node reference', () => {
    // The attack vector: if _scope were accessible, a caller could do:
    //   node._scope.notifyField("n1:balance")
    // and trigger subscribers without a real mutation.
    // With _scope removed, the only way to trigger a notification is
    // through a legitimate Action.
    const home = createReactiveHome()
    const node = home.node({
      state: { balance: 0 },
      actions: { set(ctx, v: number) { ctx.state.balance = v } },
    })

    let runs = 0
    home.subscribe(() => { runs++; void node.state.balance })
    runs = 0

    // Attempt to access _scope from the public interface — must not exist.
    const n = node as unknown as Record<string, unknown>
    assert.equal(n['_scope'], undefined, '_scope must be undefined on node')
    assert.equal(n['_nodeId'], undefined, '_nodeId must be undefined on node')

    // No notification was triggered — run count remains 0.
    assert.equal(runs, 0, 'no subscriber run must occur without a real action')

    home.destroy()
  })

  it('the only way to trigger a subscriber is through a legitimate Action mutation', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { balance: 0 },
      actions: { set(ctx, v: number) { ctx.state.balance = v } },
    })

    let runs = 0
    home.subscribe(() => { runs++; void node.state.balance })
    runs = 0

    // Trigger through a real Action — this must work.
    node.actions.set(100)
    await home.flush()
    assert.equal(runs, 1, 'legitimate action must trigger subscriber')
    assert.equal(node.state.balance, 100)

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// FIX 2 — Lifecycle guard on the mutating proxy
// ---------------------------------------------------------------------------

describe('FIX 2 — Mutating proxy lifecycle guard', () => {
  it('action can mutate an active node state normally', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { value: 0 },
      actions: { set(ctx, v: number) { ctx.state.value = v } },
    })

    node.actions.set(42)
    assert.equal(node.state.value, 42)
    home.destroy()
  })

  it('destroyed node cannot mutate through normal Action invocation', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { value: 0 },
      actions: { inc(ctx) { ctx.state.value++ } },
    })

    node.destroy()

    // The bound action wrapper calls assertActive() before the action body
    // runs, so the error is thrown at action invocation.
    assert.throws(
      () => node.actions.inc(),
      /destroyed/i,
      'invoking action on destroyed node must throw'
    )
    home.destroy()
  })

  it('leaked mutating proxy cannot mutate a destroyed node', () => {
    // This is the key regression test for FIX 2.
    // Without the fix, if a reference to ctx.state escapes the action,
    // it could mutate _rawState on a destroyed node because the proxy
    // had no lifecycle guard.
    const home = createReactiveHome()

    // We capture ctx.state by leaking it out of the action closure.
    let leaked: Record<string, number> | null = null
    const node = home.node({
      state: { value: 0 },
      actions: {
        leak(ctx) {
          leaked = ctx.state as unknown as Record<string, number>
        },
      },
    })

    // Run the action to capture the mutating proxy reference.
    node.actions.leak()
    assert.ok(leaked !== null, 'leaked reference must have been captured')

    // Narrow the type so the compiler knows it's not null from here on.
    const leakedProxy = leaked as Record<string, number>

    // Verify it works while the node is alive.
    // (Even though direct write is discouraged, the proxy is still active.)
    leakedProxy.value = 1
    assert.equal(node.state.value, 1)

    // Destroy the node.
    node.destroy()

    // Now the leaked proxy must refuse mutation.
    assert.throws(
      () => { leakedProxy.value = 999 },
      /destroyed/i,
      'leaked mutating proxy must throw when node is destroyed'
    )

    // Verify the value was NOT changed.
    // node.state is still readable after destruction.
    assert.equal(node.state.value, 1, 'value must not have changed after guard threw')

    home.destroy()
  })

  it('leaked mutating proxy delete trap rejects after destruction', () => {
    const home = createReactiveHome()
    let leakedRaw: Record<string, unknown> | null = null
    const node = home.node({
      state: { x: 1 },
      actions: { leak(ctx) { leakedRaw = ctx.state as unknown as Record<string, unknown> } },
    })

    node.actions.leak()
    const leakedProxy = leakedRaw as unknown as Record<string, unknown>
    node.destroy()

    // deleteProperty on a destroyed-node's mutating proxy must throw.
    assert.throws(
      () => { delete leakedProxy.x },
      /destroyed/i,
      'delete trap on leaked proxy must throw after node destroy'
    )
    home.destroy()
  })

  it('existing readonly node.state proxy behavior is unchanged after FIX 2', () => {
    // FIX 2 only touches the mutating proxy.
    // The tracking (readonly) proxy behavior must not have changed.
    const home = createReactiveHome()
    const node = home.node({
      state: { balance: 100 },
      actions: { set(ctx, v: number) { ctx.state.balance = v } },
    })

    // Read works fine.
    assert.equal(node.state.balance, 100)

    // Direct write still throws TypeError (readonly proxy — different error type).
    assert.throws(
      () => { (node.state as unknown as Record<string, number>).balance = 500 },
      TypeError,
      'direct write to node.state must still throw TypeError'
    )

    // Value unchanged.
    assert.equal(node.state.balance, 100)

    // Action write still works.
    node.actions.set(200)
    assert.equal(node.state.balance, 200)

    home.destroy()
  })

  it('subscriber is not triggered by a blocked leaked-proxy write', async () => {
    // Even though the leaked proxy throws, no subscriber should have been
    // notified — the guard fires before notifyField() is called.
    const home = createReactiveHome()
    let leaked: Record<string, number> | null = null
    const node = home.node({
      state: { value: 0 },
      actions: {
        leak(ctx) { leaked = ctx.state as unknown as Record<string, number> },
        set(ctx, v: number) { ctx.state.value = v },
      },
    })

    let runs = 0
    home.subscribe(() => { runs++; void node.state.value })
    runs = 0

    node.actions.leak()
    const leakedProxy2 = leaked as unknown as Record<string, number>
    node.destroy()

    // Attempt write on leaked proxy — must throw and not notify.
    try {
      leakedProxy2.value = 999
    } catch {
      // Expected — guard threw.
    }

    await home.flush()
    assert.equal(runs, 0, 'subscriber must NOT run after blocked proxy write')
    home.destroy()
  })
})
