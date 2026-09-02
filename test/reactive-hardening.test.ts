/**
 * Phase B — Hardening Test Suite
 *
 * Covers gaps and edge cases identified during the audit.
 *
 * Async discipline
 * ────────────────
 * home.flush() returns the promise for the CURRENT scheduled flush cycle.
 * After that cycle resolves, any mutation that happened *during* the flush
 * (cascading mutation) schedules a NEW microtask and a NEW promise.
 * For cascading tests we drain with a helper that polls until quiet.
 *
 * Categories
 * ──────────
 * SCH  Scheduler correctness
 * LCD  Lifecycle / cleanup
 * DYN  Dynamic dependency tracking
 * ISO  Subscriber isolation
 * EQL  Object.is equality semantics
 * ACT  Action-boundary / mutation guards
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createReactiveHome } from '../src/index.js'
import { createReactiveScope } from '../src/reactive.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Drain cascaded microtask flush cycles.
 *
 * Each reactive flush is scheduled with queueMicrotask, which runs in the
 * microtask checkpoint AFTER the current await.  Awaiting Promise.resolve()
 * yields to the microtask queue one step at a time.  Repeating this `cycles`
 * times drains `cycles` levels of cascading queueMicrotask-based flushes.
 *
 * We never use setImmediate or setTimeout here — node:test's event-loop drain
 * check in Node 22 cancels any test that leaves a macro-task pending.
 */
async function drain(cycles = 10): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await Promise.resolve()
  }
}

// ---------------------------------------------------------------------------
// SCH-1  flushPromise() called from INSIDE a subscriber still resolves after
//        the full flush cycle finishes.
// ---------------------------------------------------------------------------

describe('SCH-1 — flushPromise() called mid-flush resolves after full cycle', () => {
  it('promise captured inside subscriber resolves after all runs complete', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { x: 0 },
      actions: { set(ctx, v: number) { ctx.state.x = v } },
    })

    const order: string[] = []
    let innerPromise: Promise<void> | null = null

    home.subscribe(() => {
      order.push('A:start')
      void node.state.x
      // Capture flush promise from inside the subscriber run (mid-flush).
      innerPromise = home.flush()
      order.push('A:end')
    })
    home.subscribe(() => {
      order.push('B')
      void node.state.x
    })

    order.length = 0
    node.actions.set(1)
    await home.flush()

    assert.ok(innerPromise !== null)

    let innerResolved = false
    void (innerPromise as Promise<void>).then(() => { innerResolved = true })
    await Promise.resolve() // one microtask to let .then() fire

    assert.ok(innerResolved, 'innerPromise must be resolved after outer flush completes')
    assert.ok(order.includes('A:start'))
    assert.ok(order.includes('B'))

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// SCH-2  Mutation inside a subscriber schedules a NEW microtask cycle.
//        The secondary subscriber runs in the next cycle, not synchronously.
// ---------------------------------------------------------------------------

describe('SCH-2 — Mutation inside subscriber schedules a new flush cycle', () => {
  it('secondary mutation runs in next cycle, not synchronously mid-flush', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { a: 0, b: 0 },
      actions: {
        setA(ctx, v: number) { ctx.state.a = v },
        setB(ctx, v: number) { ctx.state.b = v },
      },
    })

    const order: string[] = []

    home.subscribe(() => {
      const val = node.state.a
      if (val > 0) {
        order.push(`a-sub:${val}`)
        node.actions.setB(val * 10)
        order.push('a-sub:after-setB')
      }
    })
    home.subscribe(() => {
      const val = node.state.b
      if (val > 0) order.push(`b-sub:${val}`)
    })

    order.length = 0

    node.actions.setA(3)
    // First flush: a-sub runs, calls setB, which schedules a second flush.
    await home.flush()
    // Drain the cascaded flush.
    await drain()

    assert.deepEqual(order, [
      'a-sub:3',
      'a-sub:after-setB',  // setB completes before b-sub runs
      'b-sub:30',          // b-sub runs in the next cycle
    ])

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// SCH-3  Consecutive flush cycles resolve their promises independently.
// ---------------------------------------------------------------------------

describe('SCH-3 — Consecutive flush cycles resolve independently', () => {
  it('three separate mutations each flush and update state correctly', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { v: 0 },
      actions: { set(ctx, n: number) { ctx.state.v = n } },
    })

    const seen: number[] = []
    home.subscribe(() => { seen.push(node.state.v) })
    seen.length = 0

    node.actions.set(1)
    await home.flush()
    assert.deepEqual(seen, [1])

    node.actions.set(2)
    await home.flush()
    assert.deepEqual(seen, [1, 2])

    node.actions.set(3)
    await home.flush()
    assert.deepEqual(seen, [1, 2, 3])

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// SCH-4  Two fields mutated synchronously before flush → subscriber runs once.
// ---------------------------------------------------------------------------

describe('SCH-4 — Same subscriber deduplication across two mutations', () => {
  it('subscriber watching x and y runs exactly once when both mutate', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { x: 0, y: 0 },
      actions: {
        setX(ctx, v: number) { ctx.state.x = v },
        setY(ctx, v: number) { ctx.state.y = v },
      },
    })

    let runs = 0
    home.subscribe(() => {
      runs++
      void node.state.x
      void node.state.y
    })
    runs = 0

    node.actions.setX(1)
    node.actions.setY(2)
    await home.flush()

    assert.equal(runs, 1)
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// SCH-5  flushPromise() resolves immediately when nothing is pending.
// ---------------------------------------------------------------------------

describe('SCH-5 — flushPromise() resolves immediately when idle', () => {
  it('awaiting flush with no pending mutations settles quickly', async () => {
    const home = createReactiveHome()

    let resolved = false
    const p = home.flush()
    void p.then(() => { resolved = true })
    await Promise.resolve() // one microtask
    await Promise.resolve() // second microtask for the .then()
    assert.ok(resolved)

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// LCD-1  Zero-dep subscribers are cleaned by disposeAll().
// ---------------------------------------------------------------------------

describe('LCD-1 — home.destroy() cleans zero-dep subscribers', () => {
  it('disposeByPrefix cannot reach zero-dep sub; disposeAll does', () => {
    const scope = createReactiveScope()
    let runs = 0
    const sub = scope.createSubscriber(() => { runs++ })

    assert.equal(runs, 1)
    assert.equal(sub.disposed, false)

    // disposeByPrefix cannot touch this subscriber — it has no field entries.
    scope.disposeByPrefix('n99:')
    assert.equal(sub.disposed, false, 'disposeByPrefix must not touch zero-dep sub')

    scope.disposeAll()
    assert.equal(sub.disposed, true, 'disposeAll must dispose zero-dep sub')
    assert.equal(scope.subscriberCount(), 0)
  })

  it('home.destroy() is idempotent after cleaning zero-dep subs', () => {
    const home = createReactiveHome()
    void home.node({ state: { x: 0 } })
    home.subscribe(() => { /* reads nothing */ })
    home.subscribe(() => { /* reads nothing */ })

    assert.doesNotThrow(() => {
      home.destroy()
      home.destroy()
    })
  })
})

// ---------------------------------------------------------------------------
// LCD-2  Scheduled-then-disposed subscriber does not execute.
// ---------------------------------------------------------------------------

describe('LCD-2 — Scheduled-then-disposed subscriber does not run', () => {
  it('sub disposed between schedule and flush never executes', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { x: 0 },
      actions: { set(ctx, v: number) { ctx.state.x = v } },
    })

    let runs = 0
    const sub = home.subscribe(() => { runs++; void node.state.x })
    runs = 0

    node.actions.set(1)            // schedules the subscriber
    home.unsubscribe(sub)          // dispose before microtask fires

    assert.equal(sub.disposed, true)
    await home.flush()
    assert.equal(runs, 0, 'disposed subscriber must not run')
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// LCD-3  disposeAll() is idempotent.
// ---------------------------------------------------------------------------

describe('LCD-3 — disposeAll() is idempotent', () => {
  it('calling disposeAll twice does not throw', () => {
    const scope = createReactiveScope()
    scope.createSubscriber(() => { /* no-op */ })

    assert.doesNotThrow(() => {
      scope.disposeAll()
      scope.disposeAll()
    })
    assert.equal(scope.subscriberCount(), 0)
  })
})

// ---------------------------------------------------------------------------
// LCD-4  Node destroyed while a mutation of that node is pending.
// ---------------------------------------------------------------------------

describe('LCD-4 — Node destroy while mutation is queued', () => {
  it('subscriber is not called for a queued mutation on a destroyed node', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { v: 0 },
      actions: { set(ctx, n: number) { ctx.state.v = n } },
    })

    let runs = 0
    home.subscribe(() => { runs++; void node.state.v })
    runs = 0

    node.actions.set(1)   // queues subscriber
    node.destroy()        // destroys node, disposes subscriber

    await home.flush()
    assert.equal(runs, 0, 'subscriber of destroyed node must not run')
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// DYN-1  Full dynamic dependency scenario from the spec (Step 6).
// ---------------------------------------------------------------------------

describe('DYN-1 — Dynamic dep: enabled-branch switching', () => {
  it('deps update correctly when enabled branch toggles', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { enabled: false, a: 0, b: 0 },
      actions: {
        setEnabled(ctx, v: boolean) { ctx.state.enabled = v },
        setA(ctx, v: number)        { ctx.state.a = v },
        setB(ctx, v: number)        { ctx.state.b = v },
      },
    })

    let runs = 0
    home.subscribe(() => {
      runs++
      if (node.state.enabled) {
        void node.state.a
      } else {
        void node.state.b
      }
    })

    // Initial: enabled=false, deps = { enabled, b }
    assert.equal(runs, 1)

    // Change b → runs (dep)
    node.actions.setB(1)
    await home.flush()
    assert.equal(runs, 2)

    // Change a → must NOT run (not a dep yet)
    node.actions.setA(99)
    await home.flush()
    assert.equal(runs, 2, 'a must not trigger while enabled=false')

    // Enable → runs; deps now { enabled, a }
    node.actions.setEnabled(true)
    await home.flush()
    assert.equal(runs, 3)

    // Change a → runs
    node.actions.setA(100)
    await home.flush()
    assert.equal(runs, 4)

    // Change b → must NOT run (dropped from deps)
    node.actions.setB(99)
    await home.flush()
    assert.equal(runs, 4, 'b must not trigger while enabled=true')

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// DYN-2  Subscriber that reads nothing after a re-run has zero deps.
// ---------------------------------------------------------------------------

describe('DYN-2 — Subscriber with zero deps after re-run', () => {
  it('further mutations do not trigger a zero-dep subscriber', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { flag: true, value: 0 },
      actions: {
        setFlag(ctx, v: boolean) { ctx.state.flag = v },
        setValue(ctx, v: number) { ctx.state.value = v },
      },
    })

    let runs = 0
    home.subscribe(() => {
      runs++
      if (node.state.flag) {
        void node.state.value
      }
    })

    assert.equal(runs, 1)  // initial: deps = { flag, value }

    node.actions.setFlag(false)
    await home.flush()
    assert.equal(runs, 2)  // re-ran: deps = { flag }

    node.actions.setValue(42)
    await home.flush()
    assert.equal(runs, 2, 'value mutation must not trigger when flag=false')

    // Same-value flag — no notification
    node.actions.setFlag(false)
    await home.flush()
    assert.equal(runs, 2)

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// ISO-1  Strict cross-node subscriber isolation.
// ---------------------------------------------------------------------------

describe('ISO-1 — Strict cross-node subscriber isolation', () => {
  it('mutating node A does not trigger any subscriber of node B', async () => {
    const home = createReactiveHome()
    const nodeA = home.node({
      state: { balance: 0, name: 'A' },
      actions: {
        setBalance(ctx, v: number) { ctx.state.balance = v },
        setName(ctx, v: string)    { ctx.state.name = v },
      },
    })
    const nodeB = home.node({
      state: { balance: 0, name: 'B' },
      actions: {
        setBalance(ctx, v: number) { ctx.state.balance = v },
        setName(ctx, v: string)    { ctx.state.name = v },
      },
    })

    let aBalRuns = 0, aNameRuns = 0, bBalRuns = 0, bNameRuns = 0
    home.subscribe(() => { aBalRuns++;  void nodeA.state.balance })
    home.subscribe(() => { aNameRuns++; void nodeA.state.name })
    home.subscribe(() => { bBalRuns++;  void nodeB.state.balance })
    home.subscribe(() => { bNameRuns++; void nodeB.state.name })
    aBalRuns = aNameRuns = bBalRuns = bNameRuns = 0

    nodeA.actions.setBalance(100)
    await home.flush()
    assert.equal(aBalRuns,  1)
    assert.equal(aNameRuns, 0)
    assert.equal(bBalRuns,  0)
    assert.equal(bNameRuns, 0)

    nodeB.actions.setName('BB')
    await home.flush()
    assert.equal(aBalRuns,  1)
    assert.equal(aNameRuns, 0)
    assert.equal(bBalRuns,  0)
    assert.equal(bNameRuns, 1)

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// ISO-2  No ownership-tree traversal during notification.
// ---------------------------------------------------------------------------

describe('ISO-2 — No ownership-tree traversal during notification', () => {
  it('child state mutation does not trigger parent subscriber', async () => {
    const home = createReactiveHome()
    const parent = home.node({
      state: { pv: 0 },
      actions: { set(ctx, v: number) { ctx.state.pv = v } },
    })
    const child = parent.child({
      state: { cv: 0 },
      actions: { set(ctx, v: number) { ctx.state.cv = v } },
    })

    let pRuns = 0, cRuns = 0
    home.subscribe(() => { pRuns++; void parent.state.pv })
    home.subscribe(() => { cRuns++;  void child.state.cv })
    pRuns = cRuns = 0

    child.actions.set(42)
    await home.flush()
    assert.equal(cRuns,  1, 'child sub must run')
    assert.equal(pRuns, 0, 'parent sub must NOT run — no tree traversal')

    parent.actions.set(99)
    await home.flush()
    assert.equal(pRuns, 1, 'parent sub must run')
    assert.equal(cRuns,  1, 'child sub must NOT run again')

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// EQL-1  Object.is equality edge cases.
// ---------------------------------------------------------------------------

describe('EQL-1 — Object.is equality edge cases', () => {
  it('NaN → NaN does not notify', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { v: NaN },
      actions: { setNaN(ctx) { ctx.state.v = NaN } },
    })
    let runs = 0
    home.subscribe(() => { runs++; void node.state.v })
    runs = 0

    node.actions.setNaN()
    await home.flush()
    assert.equal(runs, 0)
    home.destroy()
  })

  it('+0 → -0 notifies', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { v: 0 },
      actions: { setNegZero(ctx) { ctx.state.v = -0 } },
    })
    let runs = 0
    home.subscribe(() => { runs++; void node.state.v })
    runs = 0

    node.actions.setNegZero()
    await home.flush()
    assert.equal(runs, 1)
    home.destroy()
  })

  it('same object reference does not notify', async () => {
    const shared = { nested: 1 }
    const home = createReactiveHome()
    const node = home.node({
      state: { obj: shared },
      actions: { set(ctx, o: { nested: number }) { ctx.state.obj = o } },
    })
    let runs = 0
    home.subscribe(() => { runs++; void node.state.obj })
    runs = 0

    node.actions.set(shared)   // same reference → Object.is = true
    await home.flush()
    assert.equal(runs, 0, 'same reference must not notify')
    home.destroy()
  })

  it('different object reference with same content DOES notify', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { obj: { nested: 1 } },
      actions: { set(ctx, o: { nested: number }) { ctx.state.obj = o } },
    })
    let runs = 0
    home.subscribe(() => { runs++; void node.state.obj })
    runs = 0

    node.actions.set({ nested: 1 })   // different reference
    await home.flush()
    assert.equal(runs, 1, 'different reference must notify')
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// ACT-1  Action called from inside a subscriber run.
// ---------------------------------------------------------------------------

describe('ACT-1 — Action called from inside a subscriber run', () => {
  it('mutation inside subscriber triggers second subscriber in next cycle', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { trigger: 0, result: 0 },
      actions: {
        setTrigger(ctx, v: number) { ctx.state.trigger = v },
        setResult(ctx, v: number)  { ctx.state.result = v },
      },
    })

    let triggerRuns = 0, resultRuns = 0

    home.subscribe(() => {
      triggerRuns++
      const t = node.state.trigger
      if (t > 0) node.actions.setResult(t * 2)
    })
    home.subscribe(() => {
      resultRuns++
      void node.state.result
    })

    triggerRuns = resultRuns = 0

    node.actions.setTrigger(5)
    await home.flush()   // first cycle: trigger-sub runs, schedules result-sub
    await drain()        // drain cascaded flush

    assert.equal(triggerRuns, 1)
    assert.equal(resultRuns,  1)
    assert.equal(node.state.result, 10)

    home.destroy()
  })

  it('dep tracking is correct after an action is called inside a subscriber', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { a: 0, b: 0 },
      actions: {
        setA(ctx, v: number) { ctx.state.a = v },
        setB(ctx, v: number) { ctx.state.b = v },
      },
    })

    let runs = 0
    home.subscribe(() => {
      runs++
      void node.state.a       // dep: only a
      node.actions.setB(1)    // side-effect — b is NOT read, so not a dep
    })

    runs = 0

    node.actions.setA(1)
    await home.flush()
    await drain()

    assert.equal(runs, 1, 'subscriber must run once for a mutation')

    // b is not read by this subscriber, so mutating b must not trigger it.
    node.actions.setB(99)
    await home.flush()
    assert.equal(runs, 1, 'b mutation must not trigger sub — only a is a dep')

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// ACT-2  Reactive node preserves Phase A lifecycle guards (sync tests).
// ---------------------------------------------------------------------------

describe('ACT-2 — Reactive node preserves Phase A lifecycle guards', () => {
  it('invoking action on destroyed reactive node throws', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { v: 0 },
      actions: { inc(ctx) { ctx.state.v++ } },
    })
    node.destroy()
    assert.throws(() => node.actions.inc(), /destroyed/i)
    home.destroy()
  })

  it('creating child on destroyed reactive node throws', () => {
    const home = createReactiveHome()
    const node = home.node({})
    node.destroy()
    assert.throws(() => node.child({}), /destroyed/i)
    home.destroy()
  })

  it('destroy is idempotent on reactive node', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { v: 0 } })
    assert.doesNotThrow(() => {
      node.destroy()
      node.destroy()
    })
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// ACT-3  Dual proxy: action ctx.state mutable, public node.state readonly.
// ---------------------------------------------------------------------------

describe('ACT-3 — Dual proxy: ctx.state mutable, node.state readonly', () => {
  it('action writes through ctx.state; node.state reflects the update', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { balance: 100 },
      actions: { deposit(ctx, amount: number) { ctx.state.balance += amount } },
    })

    node.actions.deposit(50)
    assert.equal(node.state.balance, 150)
    home.destroy()
  })

  it('writing directly to node.state throws TypeError', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { balance: 0 } })
    assert.throws(
      () => { (node.state as unknown as Record<string, number>).balance = 999 },
      TypeError
    )
    assert.equal(node.state.balance, 0)
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// NOTE — Bounded self-mutation does not corrupt runtime.
// ---------------------------------------------------------------------------

describe('NOTE — Bounded self-mutation does not corrupt runtime', () => {
  it('subscriber with a stopping condition terminates cleanly', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { counter: 0 },
      actions: { inc(ctx) { ctx.state.counter++ } },
    })

    home.subscribe(() => {
      const c = node.state.counter
      if (c < 3) node.actions.inc()
    })

    // Drain all cascading microtask cycles.
    await drain(20)

    assert.equal(node.state.counter, 3)

    // Runtime must not be corrupted — a fresh subscriber works normally.
    let runs = 0
    home.subscribe(() => { runs++; void node.state.counter })
    runs = 0

    node.actions.inc()   // counter → 4
    await home.flush()
    assert.equal(runs, 1)
    assert.equal(node.state.counter, 4)

    home.destroy()
  })
})
