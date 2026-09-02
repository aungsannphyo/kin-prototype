/**
 * Phase B — Reactive Kernel
 *
 * This module is intentionally Node-agnostic.
 * It contains only:
 *
 *   - FieldSubscriberIndex   field   → Set<SubscriberId>
 *   - SubscriberDependencyIndex  subscriber → Set<FieldKey>
 *   - TrackingContext        "which subscriber is currently executing?"
 *   - Scheduler              microtask-based flush, deduplicates pending runs
 *   - createReactiveScope()  factory that creates an isolated reactive runtime
 *
 * A "field key" is just a string.  Callers (reactive-node.ts) concatenate
 * node-id + field-name to produce a globally unique key, e.g. "n1:balance".
 *
 * Design principles encoded here:
 *   - No tree traversal.  update path is: field mutated → index lookup → schedule.
 *   - No equality check here — callers decide whether to notify (they compare
 *     old/new with Object.is before calling notifyField).
 *   - Dynamic deps: every time a subscriber re-runs, its dep set is rebuilt
 *     from scratch (collected during the run, old deps cleared first).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A Subscriber is a record managed by the reactive runtime.
 * The public-facing wrapper is ReactiveSubscriber (in types.ts).
 */
export interface Subscriber {
  readonly id: string
  /** The function to run when a dependency changes. */
  run: () => void
  /** Whether this subscriber has been explicitly disposed. */
  disposed: boolean
}

// ---------------------------------------------------------------------------
// Reactive scope
//
// All state is encapsulated inside a scope so multiple independent runtimes
// can coexist (e.g. multiple Home instances in the same process).
// ---------------------------------------------------------------------------

export interface ReactiveScope {
  // -- Subscriber lifecycle -------------------------------------------------
  /** Create and immediately run a subscriber. Returns its handle. */
  createSubscriber(run: () => void): Subscriber

  /** Dispose a subscriber — remove it from all indexes, never run again. */
  disposeSubscriber(sub: Subscriber): void

  /** Dispose ALL subscribers whose field keys start with the given prefix. */
  disposeByPrefix(prefix: string): void

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

  // -- Flush (exposed so tests can await microtasks explicitly) -------------
  /**
   * Returns the promise that resolves when the current pending flush
   * completes.  Resolves immediately if nothing is pending.
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
  /**
   * field → Set<SubscriberId>
   * "who cares about this field?"
   */
  const _fieldIndex = new Map<string, Set<string>>()

  /**
   * SubscriberId → Subscriber
   * All live subscribers.
   */
  const _subscribers = new Map<string, Subscriber>()

  /**
   * SubscriberId → Set<FieldKey>
   * "what fields does this subscriber depend on?"
   * Required for efficient cleanup when a subscriber is disposed or re-runs.
   */
  const _depIndex = new Map<string, Set<string>>()

  // ---- Tracking context ---------------------------------------------------
  // At most one subscriber is tracking at a time.
  // Set to the running subscriber before calling sub.run(), cleared after.
  let _tracking: Subscriber | null = null

  // ---- Scheduler ----------------------------------------------------------
  // A Set of subscriber IDs pending execution.
  // Flushed as a microtask (Promise.resolve().then(...)).
  const _pending = new Set<string>()
  let _flushScheduled = false
  // The promise for the current flush cycle.
  let _flushResolve: (() => void) | null = null
  let _flushPromise: Promise<void> = Promise.resolve()

  function _scheduleFlush(): void {
    if (_flushScheduled) return
    _flushScheduled = true
    _flushPromise = new Promise<void>((resolve) => {
      _flushResolve = resolve
    })
    // Use queueMicrotask for a clean microtask (no .then chaining overhead).
    queueMicrotask(_flush)
  }

  function _flush(): void {
    // Snapshot and clear pending before running — a subscriber may trigger
    // new mutations during its run (same-tick cascades), which will be
    // collected into a fresh _pending set and scheduled for the next microtask.
    const batch = [..._pending]
    _pending.clear()
    _flushScheduled = false

    for (const id of batch) {
      const sub = _subscribers.get(id)
      // Skip if disposed between schedule and flush.
      if (sub === undefined || sub.disposed) continue
      _runSubscriber(sub)
    }

    // Resolve the flush promise so tests can await it.
    const resolve = _flushResolve
    _flushResolve = null
    if (resolve !== null) resolve()
  }

  // ---- Subscriber execution -----------------------------------------------

  function _runSubscriber(sub: Subscriber): void {
    // 1. Clear existing dependencies so they are rebuilt from scratch.
    _clearDeps(sub.id)

    // 2. Set tracking context.
    const prev = _tracking
    _tracking = sub

    // 3. Run — reads inside the function will call trackField().
    try {
      sub.run()
    } finally {
      // 4. Restore tracking context (supports nested subscribers in the future).
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
        // Prune empty sets to avoid memory accumulation.
        if (subs.size === 0) _fieldIndex.delete(field)
      }
    }
    fields.clear()
  }

  function _addDep(id: string, fieldKey: string): void {
    // field → subscriber
    let subs = _fieldIndex.get(fieldKey)
    if (subs === undefined) {
      subs = new Set()
      _fieldIndex.set(fieldKey, subs)
    }
    subs.add(id)

    // subscriber → field
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
    // First run — synchronous, so initial dependencies are registered.
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
    // Collect IDs first to avoid mutating the map during iteration.
    const toDispose: Subscriber[] = []
    for (const [id, sub] of _subscribers) {
      // We only need to know if this subscriber has any dep matching the prefix.
      // But since subscriber IDs are unrelated to node IDs, we need to check
      // via the dep index: does this sub depend on any field with this prefix?
      // More efficient: check _depIndex for fields starting with prefix.
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

    // Also remove any orphaned field entries with this prefix
    // (e.g. fields that existed but had no subscribers at dispose time).
    for (const field of _fieldIndex.keys()) {
      if (field.startsWith(prefix)) {
        _fieldIndex.delete(field)
      }
    }
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

  function flushPromise(): Promise<void> {
    return _flushScheduled ? _flushPromise : Promise.resolve()
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
    notifyField,
    trackField,
    flushPromise,
    subscriberCount,
  }
}
