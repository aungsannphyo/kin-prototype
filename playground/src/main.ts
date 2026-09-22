/**
 * Kin Browser Playground — Counter Application
 *
 * Demonstrates the complete reactive loop using ONLY Kin's public API:
 *
 *   Browser Event
 *     → Kin Action (increment / decrement)
 *     → State Mutation (counter.state.count changes)
 *     → Reactive Dependency (subscriber re-runs for the 'count' field)
 *     → View Update (ReactiveGetter re-evaluated)
 *     → DOM Update (Text.data written directly — no VDOM, no diffing)
 *
 * Public API imports only — zero internal symbols or private modules.
 */

import {
  createReactiveHome,
  element,
  text,
  handler,
  mount,
} from 'kin-prototype'

// ---------------------------------------------------------------------------
// 1. Home — the reactive runtime container
// ---------------------------------------------------------------------------

const home = createReactiveHome()

// ---------------------------------------------------------------------------
// 2. Node — owns state + actions
// ---------------------------------------------------------------------------

type CounterState = { count: number }
type CounterActions = {
  increment(ctx: { state: CounterState }): void
  decrement(ctx: { state: CounterState }): void
}

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

// ---------------------------------------------------------------------------
// 3. View — immutable descriptor built from Kin view factories
//
//    element()  — creates ElementNode descriptor
//    text()     — creates TextNode; accepts ReactiveGetter for live binding
//    handler()  — wraps callback as branded EventHandler (not a ReactiveGetter)
//    mount()    — walks descriptor once, creates DOM, wires subscriptions
// ---------------------------------------------------------------------------

const view = element(
  'div',
  { class: 'counter-card' },

  element('span', { class: 'counter-label' }, text('count')),

  // ReactiveGetter: subscribed once; only this Text node updates on change
  element('div', { class: 'count-display' }, text(() => String(counter.state.count))),

  element(
    'div',
    { class: 'controls' },
    element(
      'button',
      {
        class: 'btn btn-decrement',
        id: 'btn-decrement',
        onClick: handler(() => {
          flashFlow()
          counter.actions.decrement()
        }),
      },
      text('−'),
    ),
    element(
      'button',
      {
        class: 'btn btn-increment',
        id: 'btn-increment',
        onClick: handler(() => {
          flashFlow()
          counter.actions.increment()
        }),
      },
      text('+'),
    ),
  ),
)

// ---------------------------------------------------------------------------
// 4. Mount — render descriptor tree into real browser DOM
// ---------------------------------------------------------------------------

const container = document.getElementById('app')
if (!container) throw new Error('Missing #app element')

const handle = mount(home, view, container)

// Expose internal references on window for browser testing & lifecycle inspection
if (typeof window !== 'undefined') {
  ;(window as any).__KIN_APP__ = {
    home,
    counter,
    handle,
    view,
    container,
  }
}

// ---------------------------------------------------------------------------
// 5. Data-flow visualiser (not part of Kin — plain DOM animation to prove
//    the data flow in real time)
// ---------------------------------------------------------------------------

const FLOW_STEPS = ['flow-event', 'flow-action', 'flow-state', 'flow-dep', 'flow-view', 'flow-dom']
let _animTimer: ReturnType<typeof setTimeout> | null = null

function flashFlow(): void {
  if (_animTimer !== null) {
    clearTimeout(_animTimer)
    FLOW_STEPS.forEach(id => document.getElementById(id)?.classList.remove('active'))
  }

  let delay = 0
  for (const id of FLOW_STEPS) {
    const stepDelay = delay
    setTimeout(() => {
      document.getElementById(id)?.classList.add('active')
    }, stepDelay)
    delay += 110
  }

  _animTimer = setTimeout(() => {
    FLOW_STEPS.forEach(id => document.getElementById(id)?.classList.remove('active'))
    _animTimer = null
  }, delay + 400)
}
