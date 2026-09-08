/**
 * Phase E.4 — Browser Interaction & Event-to-Action Boundary
 *
 * Tests that harden and validate the event interaction boundary:
 *
 *   DOM Event → EventHandler → Kin Action → State Mutation → Reactive Subscription → Targeted DOM Update
 *
 * Key architectural guarantees:
 *   - EventHandler branding is authoritative (not prop-name based)
 *   - Events invoke Kin Actions directly
 *   - View functions do not rerun on state changes
 *   - Fine-grained reactive bindings remain independent
 *   - Listeners are properly cleaned up
 *   - Authorization boundaries remain intact
 *   - No component runtime or synthetic events
 *
 * Runner: node:test   Assertions: node:assert/strict
 * Uses happy-dom for DOM tests.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

import { createReactiveHome, capability } from '../src/index.js'
import type { ReactiveNode } from '../src/index.js'
import {
  element,
  text,
  when,
  handler,
  isEventHandler,
} from '../src/view/index.js'
import { mount } from '../src/dom/index.js'
import type { View } from '../src/dom/index.js'
import type { ChildNode, PropValue } from '../src/view/index.js'
import type { AuthorizedView } from '../src/index.js'

// ---------------------------------------------------------------------------
// DOM environment
// ---------------------------------------------------------------------------

let windowRef: Window

function installDom(): void {
  windowRef = new Window({ url: 'https://localhost/' })
  const globals = {
    document: windowRef.document,
    Event: windowRef.Event,
    Node: windowRef.Node,
    HTMLElement: windowRef.HTMLElement,
    Text: windowRef.Text,
    Comment: windowRef.Comment,
  }
  Object.assign(globalThis, globals)
}

function container(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

function click(el: Element): void {
  el.dispatchEvent(new Event('click', { bubbles: true }))
}

before(() => {
  installDom()
})

after(() => {
  windowRef.close()
})

// ---------------------------------------------------------------------------
// E4-1 through E4-3 — Event handler identification
// ---------------------------------------------------------------------------

describe('E4-1 — Handler branding is authoritative', () => {
  it('handler() creates branded EventHandler recognized by isEventHandler', () => {
    const h = handler(() => {})
    assert.equal(isEventHandler(h), true)
  })

  it('plain function is NOT recognized as EventHandler', () => {
    const getter = () => 'value'
    assert.equal(isEventHandler(getter), false)
  })

  it('event detection does not depend on property name', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    let handlerCalled = false
    // Use a non-onXxx property name but still branded
    const handle = mount(
      home,
      element('button', {
        click: handler(() => {
          handlerCalled = true
          node.actions.increment()
        }),
      }, text(() => String(node.state.count))),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()
    assert.equal(handlerCalled, true)
    assert.equal(btn.textContent, '1')

    handle.unmount()
    home.destroy()
  })
})

describe('E4-2 — Plain getter with onXxx name is NOT treated as event', () => {
  it('getter named onClick is treated as reactive binding, not event', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    let runs = 0
    const handle = mount(
      home,
      element('button', {
        // This is a getter, not a handler (no brand)
        onClick: () => { runs++; return String(node.state.count) },
      }, text('Click')),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    // Getter should have been treated as reactive binding, not event listener
    // So click should do nothing (no action invocation)
    assert.equal(node.state.count, 0)

    handle.unmount()
    home.destroy()
  })
})

describe('E4-3 — isEventHandler type guard works correctly', () => {
  it('returns true only for branded handlers', () => {
    const branded = handler(() => {})
    const plain = (() => {}) as PropValue
    const arrow = (() => 'value') as PropValue

    assert.equal(isEventHandler(branded), true)
    assert.equal(isEventHandler(plain), false)
    assert.equal(isEventHandler(arrow), false)
  })
})

// ---------------------------------------------------------------------------
// E4-4 through E4-6 — Event → Action flow
// ---------------------------------------------------------------------------

describe('E4-4 — Event → Action → State mutation → DOM update', () => {
  it('complete event-to-Action-to-DOM flow works', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const handle = mount(
      home,
      element('button', {
        onClick: handler(() => node.actions.increment()),
      }, text(() => String(node.state.count))),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    assert.equal(btn.textContent, '0')

    click(btn)
    await home.flush()

    assert.equal(node.state.count, 1)
    assert.equal(btn.textContent, '1')

    handle.unmount()
    home.destroy()
  })
})

describe('E4-5 — Multiple independent event handlers', () => {
  it('multiple buttons with independent handlers work correctly', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: {
        increment(ctx) { ctx.state.count++ },
        decrement(ctx) { ctx.state.count-- },
      },
    })

    const handle = mount(
      home,
      element('div', {},
        element('button', {
          onClick: handler(() => node.actions.increment()),
        }, text('Inc')),
        element('button', {
          onClick: handler(() => node.actions.decrement()),
        }, text('Dec')),
      ),
      container(),
    )

    const buttons = document.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    const incBtn = buttons[0]
    const decBtn = buttons[1]

    click(incBtn)
    await home.flush()
    assert.equal(node.state.count, 1)

    click(decBtn)
    await home.flush()
    assert.equal(node.state.count, 0)

    handle.unmount()
    home.destroy()
  })
})

describe('E4-6 — Event handler receives native event', () => {
  it('handler receives actual browser event object', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    let receivedType: string | null = null
    const handle = mount(
      home,
      element('button', {
        onClick: handler((event) => {
          receivedType = (event as Event).type
          node.actions.increment()
        }),
      }, text('Click')),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    assert.equal(receivedType, 'click')

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E4-7 through E4-9 — No View rerender
// ---------------------------------------------------------------------------

describe('E4-7 — View functions do not rerun on state changes', () => {
  it('View function executes once during mount, not on event-triggered Actions', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    let viewRuns = 0

    const Counter: View = () => {
      viewRuns++
      return element('button', {
        onClick: handler(() => node.actions.increment()),
      }, text(() => String(node.state.count)))
    }

    const handle = mount(home, Counter, container())

    assert.equal(viewRuns, 1)

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    assert.equal(viewRuns, 1)
    assert.equal(btn.textContent, '1')

    handle.unmount()
    home.destroy()
  })
})

describe('E4-8 — Fine-grained reactive updates with events', () => {
  it('changing one field does not rerun bindings for other fields', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0, name: 'Alice' },
      actions: {
        increment(ctx) { ctx.state.count++ },
        rename(ctx, name: string) { ctx.state.name = name },
      },
    })

    let countRuns = 0
    let nameRuns = 0

    const handle = mount(
      home,
      element('div', {},
        element('button', {
          onClick: handler(() => node.actions.increment()),
        }, text(() => { countRuns++; return String(node.state.count) })),
        element('button', {
          onClick: handler(() => node.actions.rename('Bob')),
        }, text(() => { nameRuns++; return node.state.name })),
      ),
      container(),
    )

    const buttons = document.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    click(buttons[0])
    await home.flush()

    assert.equal(countRuns, 2) // initial + increment
    assert.equal(nameRuns, 1) // initial only

    click(buttons[1])
    await home.flush()

    assert.equal(countRuns, 2) // unchanged
    assert.equal(nameRuns, 2) // initial + rename

    handle.unmount()
    home.destroy()
  })
})

describe('E4-9 — State mutation through Action remains the only path', () => {
  it('event handlers must use Actions to mutate state', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const handle = mount(
      home,
      element('button', {
        onClick: handler(() => node.actions.increment()),
      }, text(() => String(node.state.count))),
      container(),
    )

    // Direct state mutation should still be blocked
    assert.throws(() => {
      ;(node.state as { count: number }).count = 5
    }, TypeError)

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    assert.equal(node.state.count, 1)

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E4-10 through E4-12 — Listener cleanup
// ---------------------------------------------------------------------------

describe('E4-10 — Listener cleanup on unmount', () => {
  it('unmount removes event listeners', async () => {
    const home = createReactiveHome()
    let calls = 0

    const handle = mount(
      home,
      element('button', {
        onClick: handler(() => { calls++ }),
      }, text('Click')),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    handle.unmount()

    click(btn)
    await home.flush()

    assert.equal(calls, 0)

    home.destroy()
  })
})

describe('E4-11 — Unmount is idempotent', () => {
  it('calling unmount multiple times is safe', async () => {
    const home = createReactiveHome()
    let calls = 0

    const handle = mount(
      home,
      element('button', {
        onClick: handler(() => { calls++ }),
      }, text('Click')),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    handle.unmount()
    handle.unmount()
    handle.unmount()

    click(btn)
    await home.flush()

    assert.equal(calls, 0)

    home.destroy()
  })
})

describe('E4-12 — No listener leaks after unmount', () => {
  it('all listeners are tracked and removed', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const handle = mount(
      home,
      element('div', {},
        element('button', {
          onClick: handler(() => node.actions.increment()),
        }, text('Inc')),
        element('button', {
          onClick: handler(() => node.actions.increment()),
        }, text('Inc2')),
      ),
      container(),
    )

    // Save button references before unmount
    const buttons = document.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    const buttonArray = Array.from(buttons)

    handle.unmount()

    // Both listeners should be removed
    for (const btn of buttonArray) {
      click(btn)
    }

    await home.flush()
    assert.equal(node.state.count, 0)

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E4-13 through E4-15 — Conditional listener cleanup
// ---------------------------------------------------------------------------

describe('E4-13 — Conditional listener lifecycle', () => {
  it('listener exists when conditional branch is active', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { enabled: true },
      actions: { toggle(ctx) { ctx.state.enabled = !ctx.state.enabled } },
    })

    let calls = 0
    const handle = mount(
      home,
      when(
        () => node.state.enabled,
        element('button', {
          onClick: handler(() => { calls++ }),
        }, text('Click')),
      ),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    assert.equal(calls, 1)

    handle.unmount()
    home.destroy()
  })
})

describe('E4-14 — Conditional listener removed when inactive', () => {
  it('listener is removed when branch becomes inactive', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { enabled: true },
      actions: { toggle(ctx) { ctx.state.enabled = !ctx.state.enabled } },
    })

    let calls = 0
    const handle = mount(
      home,
      when(
        () => node.state.enabled,
        element('button', {
          onClick: handler(() => { calls++ }),
        }, text('Click')),
      ),
      container(),
    )

    node.actions.toggle()
    await home.flush()

    const btn = document.querySelector('button')
    assert.equal(btn, null)

    handle.unmount()
    home.destroy()
  })
})

describe('E4-15 — Conditional listener recreated when reactivated', () => {
  it('new listener created when branch becomes active again', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { enabled: true },
      actions: { toggle(ctx) { ctx.state.enabled = !ctx.state.enabled } },
    })

    let calls = 0
    const handle = mount(
      home,
      when(
        () => node.state.enabled,
        element('button', {
          onClick: handler(() => { calls++ }),
        }, text('Click')),
      ),
      container(),
    )

    // First click
    const btn1 = document.querySelector('button') as HTMLButtonElement
    click(btn1)
    await home.flush()
    assert.equal(calls, 1)

    // Disable
    node.actions.toggle()
    await home.flush()
    assert.equal(document.querySelector('button'), null)

    // Re-enable
    node.actions.toggle()
    await home.flush()

    // Second click (new button, new listener)
    const btn2 = document.querySelector('button') as HTMLButtonElement
    assert.notEqual(btn2, null)
    click(btn2)
    await home.flush()
    assert.equal(calls, 2)

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E4-16 through E4-18 — Multiple listeners and duplicates
// ---------------------------------------------------------------------------

describe('E4-16 — Multiple independent listeners', () => {
  it('each element has its own listener', async () => {
    const home = createReactiveHome()

    let clicks = 0
    const handle = mount(
      home,
      element('div', {},
        element('button', {
          onClick: handler(() => { clicks++ }),
        }, text('Btn1')),
        element('button', {
          onClick: handler(() => { clicks++ }),
        }, text('Btn2')),
      ),
      container(),
    )

    const buttons = document.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    click(buttons[0])
    await home.flush()
    assert.equal(clicks, 1)

    click(buttons[1])
    await home.flush()
    assert.equal(clicks, 2)

    handle.unmount()
    home.destroy()
  })
})

describe('E4-17 — No duplicate listeners', () => {
  it('mounting once creates exactly one listener per event', async () => {
    const home = createReactiveHome()

    let calls = 0
    const handle = mount(
      home,
      element('button', {
        onClick: handler(() => { calls++ }),
      }, text('Click')),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    assert.equal(calls, 1)

    // Try clicking again - should still only be 1 call total
    click(btn)
    await home.flush()
    assert.equal(calls, 2)

    handle.unmount()
    home.destroy()
  })
})

describe('E4-18 — No duplicate listeners in conditional', () => {
  it('toggling conditional does not create duplicate listeners', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { enabled: true },
      actions: { toggle(ctx) { ctx.state.enabled = !ctx.state.enabled } },
    })

    let calls = 0
    const handle = mount(
      home,
      when(
        () => node.state.enabled,
        element('button', {
          onClick: handler(() => { calls++ }),
        }, text('Click')),
      ),
      container(),
    )

    // Toggle off
    node.actions.toggle()
    await home.flush()

    // Toggle on
    node.actions.toggle()
    await home.flush()

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    assert.equal(calls, 1)

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E4-19 through E4-21 — ReactiveGetter vs EventHandler
// ---------------------------------------------------------------------------

describe('E4-19 — ReactiveGetter vs EventHandler distinction', () => {
  it('element with both reactive getter and event handler works', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0, disabled: false },
      actions: {
        increment(ctx) { ctx.state.count++ },
        toggleDisabled(ctx) { ctx.state.disabled = !ctx.state.disabled },
      },
    })

    const handle = mount(
      home,
      element('button', {
        disabled: () => node.state.disabled,
        onClick: handler(() => node.actions.increment()),
      }, text(() => String(node.state.count))),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    assert.equal(btn.disabled, false)

    click(btn)
    await home.flush()
    assert.equal(btn.textContent, '1')

    node.actions.toggleDisabled()
    await home.flush()
    assert.equal(btn.disabled, true)

    handle.unmount()
    home.destroy()
  })
})

describe('E4-20 — isEventHandler distinguishes correctly', () => {
  it('mixed props are correctly categorized', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    let handlerRuns = 0

    const handle = mount(
      home,
      element('button', {
        onClick: handler(() => { handlerRuns++; node.actions.increment() }),
      }, text(() => String(node.state.count))),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    assert.equal(handlerRuns, 1)
    assert.equal(btn.textContent, '1')

    handle.unmount()
    home.destroy()
  })
})

describe('E4-21 — ReactiveGetter in event handler is NOT event', () => {
  it('reactive getter in onClick is treated as binding, not listener', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const handle = mount(
      home,
      element('button', {
        onClick: () => String(node.state.count),
      }, text('Click')),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    // Click should do nothing since onClick is a getter, not a handler
    assert.equal(node.state.count, 0)

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E4-22 through E4-24 — Authorization security
// ---------------------------------------------------------------------------

describe('E4-22 — AuthorizedView boundaries in event handlers', () => {
  it('event handler cannot access actions through AuthorizedView', async () => {
    const home = createReactiveHome()
    const source = home.node({ state: {}, actions: {} })
    const target = home.node({
      state: { balance: 100 },
      actions: { deposit(ctx, amount: number) { ctx.state.balance += amount } },
    })
    const rel = home.relationship(source, target)
    const grant = rel.grant(capability(['balance']))

    let capturedView: AuthorizedView<{ balance: number }> | null = null
    home.subscribeAs(source, target, grant, (v) => {
      capturedView = v as AuthorizedView<{ balance: number }>
    })

    await home.flush()

    assert.notEqual(capturedView, null)
    const view = capturedView!

    const handle = mount(
      home,
      element('button', {
        onClick: handler(() => {
          // Should not be able to access actions
          assert.equal('actions' in view, false)
        }),
      }, text('Click')),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    handle.unmount()
    home.destroy()
  })
})

describe('E4-23 — Event handler cannot escape AuthorizedView', () => {
  it('handler with AuthorizedView cannot access underlying Node', async () => {
    const home = createReactiveHome()
    const source = home.node({ state: {}, actions: {} })
    const target = home.node({
      state: { balance: 100 },
      actions: {},
    })
    const rel = home.relationship(source, target)
    const grant = rel.grant(capability(['balance']))

    let capturedView: AuthorizedView<{ balance: number }> | null = null
    home.subscribeAs(source, target, grant, (v) => {
      capturedView = v as AuthorizedView<{ balance: number }>
    })

    await home.flush()

    assert.notEqual(capturedView, null)
    const view = capturedView!

    const handle = mount(
      home,
      element('button', {
        onClick: handler(() => {
          // Should not be able to access internal internals
          assert.equal('destroy' in view, false)
          assert.equal('isParent' in view, false)
          assert.equal('isChild' in view, false)
        }),
      }, text('Click')),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    handle.unmount()
    home.destroy()
  })
})

describe('E4-24 — Renderer remains unaware of authorization', () => {
  it('renderer does not check authorization when attaching listeners', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    // Renderer should attach listener regardless of authorization context
    const handle = mount(
      home,
      element('button', {
        onClick: handler(() => node.actions.increment()),
      }, text(() => String(node.state.count))),
      container(),
    )

    const btn = document.querySelector('button') as HTMLButtonElement
    click(btn)
    await home.flush()

    assert.equal(btn.textContent, '1')

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E4-25 — Event handler closures
// ---------------------------------------------------------------------------

describe('E4-25 — Event handler closures work correctly', () => {
  it('handler closures can capture Node references', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const Counter = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('button', {
        onClick: handler(() => n.actions.increment()),
      }, text(() => String(n.state.count)))

    const handle = mount(home, () => Counter(node), container())

    const btn = document.querySelector('button') as HTMLButtonElement
    assert.equal(btn.textContent, '0')

    click(btn)
    await home.flush()

    assert.equal(btn.textContent, '1')

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E4-26 — Integration test: realistic counter
// ---------------------------------------------------------------------------

describe('E4-26 — Integration test: realistic counter interaction', () => {
  it('complete counter interaction: click → Action → DOM update', async () => {
    const home = createReactiveHome()
    const counter = home.node({
      state: {
        count: 0,
      },
      actions: {
        increment(ctx) {
          ctx.state.count++
        },
      },
    })

    let viewRuns = 0

    function Counter(n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode {
      viewRuns++
      return element(
        'button',
        {
          onClick: handler(() => {
            n.actions.increment()
          }),
        },
        text(() => String(n.state.count)),
      )
    }

    const handle = mount(home, () => Counter(counter), container())

    // Initial state
    assert.equal(viewRuns, 1)
    const btn = document.querySelector('button') as HTMLButtonElement
    assert.equal(btn.textContent, '0')

    // First click
    click(btn)
    await home.flush()
    assert.equal(counter.state.count, 1)
    assert.equal(btn.textContent, '1')
    assert.equal(viewRuns, 1) // View did not rerun

    // Second click
    click(btn)
    await home.flush()
    assert.equal(counter.state.count, 2)
    assert.equal(btn.textContent, '2')
    assert.equal(viewRuns, 1) // View did not rerun

    // Button DOM identity remains stable
    const btnAfter = document.querySelector('button') as HTMLButtonElement
    assert.equal(btnAfter, btn)

    // Exactly one listener exists
    handle.unmount()
    click(btnAfter)
    await home.flush()
    assert.equal(counter.state.count, 2) // No action after unmount

    home.destroy()
  })
})
