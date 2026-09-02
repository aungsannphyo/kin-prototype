/**
 * Phase B — Reactive Kernel
 *
 * This module is intentionally Node-agnostic.
 * It contains only:
 *
 *   - FieldSubscriberIndex       field → Set<SubscriberId>
 *   - SubscriberDependencyIndex  subscriber → Set<FieldKey>
 *   - TrackingContext            "which subscriber is currently executing?"
 *   - Scheduler                 microtask-based flush, deduplicates pending runs
 *   - createReactiveScope()     factory that creates an isolated reactive runtime
 *
 * A "field key" is just a string.  Callers (reactive-node.ts) concatenate
 * node-id + field-name to produce a globally unique key, e.g. "n1:balance".
 *
 * Design principles encoded here:
 *   - No tree traversal.  Update path: field mutated → index lookup → schedule.
 *   - No equality check here — callers compare old/new with Object.is before
 *     calling notifyField.
 *   - Dynamic deps: every time a subscriber re-runs, its dep set is rebuilt
 *     from scratch (collected during the run, old deps cleared first).
 *
 * --- Scheduler invariants ---
 *   _flushScheduled  true between _scheduleFlush() and the microtask firing.
 *   _flushing        true for the entire synchronous execution of _flush(),
 *                    including all subscriber runs within that cycle.
 *   flushPromise()   returns _flushPromise (the current cycle's promise) when
 *                    _flushScheduled OR _flushing is true; otherwise returns
 *                    Promise.resolve() immediately.
 *   This ensures that callers who call flushPromise() from inside a subscriber
 *   run (i.e. while _flushing=true, _flushScheduled=false) still get a promise
 *   that resolves only after the full flush cycle completes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A Subscriber is a record managed by the reactive runtime.
 */
export interface Subscriber {
  readonly id: string
  /** The function to run when a dependency changes. */
  run: () => void
  /** Whether this subscriber has been explicitly disposed. */
  disposed: boolean
}

// ---------------------------------------------------------------------------
// Reactive scope interface
// ---------------------------------------------------------------------------

export interface ReactiveScope {
  // -- Subscriber lifecycle -------------------------------------------------
  /** Create and immediately run a subscriber. Returns its handle. */
  createSubscriber(run: () => void): Subscriber

  /** Dispose a subscriber — remove it from all indexes, never run again. */
  disposeSubscriber(sub: Subscriber): void

  /** Dispose ALL subscribers whose field keys start with the given prefix. */
  disposeByPrefix(prefix: string): void

  /**
   * Dispose ALL live subscribers in this scope.
   * Called by ReactiveHome.destroy() to clean up zero-dep subscribers that
   * disposeByPrefix() cannot reach (they have no field entries to match on).
   */
  disposeAll(): void

  // -- Mutation notification ------------------------------------------------
  /**
   * Called by reactive-node when a field is about to be mutated.
   * Schedules all subscribers of that field for re-execution.
   */
  notifyField(fieldKey: string): void

  // -- Tracking (called from within the reactive read proxy) ----------------
  /**
   * Called when a field is read during a subscriber execution.
   * Registers: subscriber → field, field → subscriber.
   */
  trackField(fieldKey: string): void

  // -- Flush ----------------------------------------------------------------
  /**
   * Returns a promise that resolves when the current pending flush cycle
   * completes.  Resolves immediately if no flush is pending or in progress.
   */
  flushPromise(): Promise<void>

  // -- Debug / test surface -------------------------------------------------
  /** Returns the number of live (non-disposed) subscribers. */
  subscriberCount(): number
}

// ---------------------------------------------------------------------------
// ID generators
// ---------------------------------------------------------------------------

let _nextSubId = 0
function nextSubId(): string {
  return `s${++_nextSubId}`
}

// ---------------------------------------------------------------------------
// createReactiveScope
// ---------------------------------------------------------------------------

export function createReactiveScope(): ReactiveScope {
  // field → Set<subscriberId>  — "who depends on this field?"
  const _fieldIndex = new Map<string, Set<string>>()

  // subscriberId → Subscriber
  const _subscribers = new Map<string, Subscriber>()

  // subscriberId → Set<fieldKey>  — "what fields does this subscriber depend on?"
  const _depIndex = new Map<string, Set<string>>()

  // ---- Tracking context ---------------------------------------------------
  let _tracking: Subscriber | null = null

  // ---- Scheduler ----------------------------------------------------------
  const _pending = new Set<string>()
  let _flushScheduled = false
  // BUG-1 FIX: separate flag for "flush body currently executing".
  // flushPromise() must return the live promise when either _flushScheduled
  // (queued but not started) OR _flushing (started but not resolved yet).
  let _flushing = false
  let _flushResolve: (() => void) | null = null
  let _flushPromise: Promise<void> = Promise.resolve()

  function _scheduleFlush(): void {
    if (_flushScheduled || _flushing) return  // already scheduled or running
    _flushScheduled = true
    _flushPromise = new Promise<void>((resolve) => {
      _flushResolve = resolve
    })
    // Schedule the flush as a Promise microtask rather than queueMicrotask.
    // Promise .then() callbacks and queueMicrotask callbacks are both
    // microtasks, but node:test in Node 22 correctly drains Promise chains
    // when awaiting a test. Using queueMicrotask can leave the callback
    // pending past the point where node:test considers the event loop idle.
    void Promise.resolve().then(_flush)
  }

  function _flush(): void {
    // Process all pending subscribers, including any added by mutations
    // that happen during subscriber runs (cascades). We loop until _pending
    // is empty so that the entire causal chain is flushed in one cycle.
    // This guarantees:
    //   1. A single await home.flush() drains all cascaded mutations.
    //   2. No dangling Promise.resolve().then(_flush) microtasks are left
    //      pending after the flush completes.
    //   3. The flush promise resolves only after all cascades are done.
    _flushScheduled = false
    _flushing = true

    try {
      // Loop until no new pending work was generated.
      while (_pending.size > 0) {
        const batch = [..._pending]
        _pending.clear()
        for (const id of batch) {
          const sub = _subscribers.get(id)
          if (sub === undefined || sub.disposed) continue
          _runSubscriber(sub)
        }
      }
    } finally {
      _flushing = false
      const resolve = _flushResolve
      _flushResolve = null
      if (resolve !== null) resolve()
    }
  }

  // ---- Subscriber execution -----------------------------------------------

  function _runSubscriber(sub: Subscriber): void {
    _clearDeps(sub.id)
    const prev = _tracking
    _tracking = sub
    try {
      sub.run()
    } finally {
      _tracking = prev
    }
  }

  // ---- Dependency management -----------------------------------------------

  function _clearDeps(id: string): void {
    const fields = _depIndex.get(id)
    if (fields === undefined) return
    for (const field of fields) {
      const subs = _fieldIndex.get(field)
      if (subs !== undefined) {
        subs.delete(id)
        if (subs.size === 0) _fieldIndex.delete(field)
      }
    }
    fields.clear()
  }

  function _addDep(id: string, fieldKey: string): void {
    let subs = _fieldIndex.get(fieldKey)
    if (subs === undefined) {
      subs = new Set()
      _fieldIndex.set(fieldKey, subs)
    }
    subs.add(id)

    let fields = _depIndex.get(id)
    if (fields === undefined) {
      fields = new Set()
      _depIndex.set(id, fields)
    }
    fields.add(fieldKey)
  }

  // ---- Public API ---------------------------------------------------------

  function createSubscriber(run: () => void): Subscriber {
    const sub: Subscriber = {
      id: nextSubId(),
      run,
      disposed: false,
    }
    _subscribers.set(sub.id, sub)
    _depIndex.set(sub.id, new Set())
    _runSubscriber(sub)
    return sub
  }

  function disposeSubscriber(sub: Subscriber): void {
    if (sub.disposed) return
    sub.disposed = true
    _clearDeps(sub.id)
    _depIndex.delete(sub.id)
    _subscribers.delete(sub.id)
    _pending.delete(sub.id)
  }

  function disposeByPrefix(prefix: string): void {
    const toDispose: Subscriber[] = []
    for (const [id, sub] of _subscribers) {
      const fields = _depIndex.get(id)
      if (fields !== undefined) {
        for (const field of fields) {
          if (field.startsWith(prefix)) {
            toDispose.push(sub)
            break
          }
        }
      }
    }
    for (const sub of toDispose) {
      disposeSubscriber(sub)
    }

    // BUG-3 FIX: snapshot _fieldIndex keys before iterating to avoid relying
    // on implementation-defined Map mutation-during-iteration behaviour.
    const orphanedFields = [..._fieldIndex.keys()].filter(f => f.startsWith(prefix))
    for (const field of orphanedFields) {
      _fieldIndex.delete(field)
    }
  }

  // BUG-2 FIX + cascade-flush leak fix: dispose every remaining subscriber
  // AND eagerly flush so no Promise.resolve().then(_flush) microtask remains
  // pending in the queue after cleanup. node:test (Node 22) detects dangling
  // microtask-promise chains and cancels the test with "Promise resolution is
  // still pending" if any are left when the test function returns.
  function disposeAll(): void {
    // If a flush is scheduled, run it eagerly and synchronously right now.
    // This drains _pending, resolves _flushResolve, and sets _flushScheduled=false.
    // The already-queued Promise.resolve().then(_flush) will still fire later,
    // but _pending will be empty and _flushScheduled=false so it becomes a no-op.
    if (_flushScheduled || _flushing) {
      _flush()
    }

    // Snapshot first — disposeSubscriber mutates _subscribers.
    const all = [..._subscribers.values()]
    for (const sub of all) {
      disposeSubscriber(sub)
    }
    // Belt-and-suspenders: clear both indexes entirely.
    _fieldIndex.clear()
    _depIndex.clear()
    _pending.clear()
    // Ensure the flush promise is resolved so no awaiter hangs.
    const resolve = _flushResolve
    _flushResolve = null
    _flushScheduled = false
    _flushing = false
    if (resolve !== null) resolve()
    _flushPromise = Promise.resolve()
  }

  function notifyField(fieldKey: string): void {
    const subs = _fieldIndex.get(fieldKey)
    if (subs === undefined || subs.size === 0) return
    for (const id of subs) {
      const sub = _subscribers.get(id)
      if (sub !== undefined && !sub.disposed) {
        _pending.add(id)
      }
    }
    _scheduleFlush()
  }

  function trackField(fieldKey: string): void {
    if (_tracking === null || _tracking.disposed) return
    _addDep(_tracking.id, fieldKey)
  }

  // BUG-1 FIX: return live promise whenever scheduled OR currently flushing.
  function flushPromise(): Promise<void> {
    return (_flushScheduled || _flushing) ? _flushPromise : Promise.resolve()
  }

  function subscriberCount(): number {
    let count = 0
    for (const sub of _subscribers.values()) {
      if (!sub.disposed) count++
    }
    return count
  }

  return {
    createSubscriber,
    disposeSubscriber,
    disposeByPrefix,
    disposeAll,
    notifyField,
    trackField,
    flushPromise,
    subscriberCount,
  }
}
