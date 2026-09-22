/**
 * Comprehensive Counter Lifecycle & Browser Application Verification
 *
 * Verifies:
 * 1. Initial render (Initial state: count 0)
 * 2. Complete event-to-DOM update cycle:
 *    Click Increment -> Event Handler -> Kin Action -> State Mutation ->
 *    Dependency Notification -> Targeted DOM update (count = 1, then 2)
 * 3. Decrement (count decreases correctly)
 * 4. DOM Identity preservation (identical references before and after state updates)
 * 5. Reactive precision (only the text node updates, unrelated nodes never touched)
 * 6. Cleanup via mount().unmount():
 *    - Subscriptions disposed
 *    - Event listeners removed
 *    - Future state changes do not update destroyed DOM
 * 7. Error handling & invalid lifecycle operations:
 *    - Double unmount idempotency
 *    - Calling mount() without DOM document
 *    - Post-unmount state mutations
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

import {
  createReactiveHome,
  element,
  text,
  handler,
  mount,
} from '../src/index.js'
import type { ReactiveHome } from '../src/index.js'

let windowRef: Window

function installDom(): void {
  windowRef = new Window({ url: 'http://localhost:5173/' })
  const globals = {
    document: windowRef.document,
    Event: windowRef.Event,
    MouseEvent: windowRef.MouseEvent,
    Node: windowRef.Node,
    HTMLElement: windowRef.HTMLElement,
    Text: windowRef.Text,
    Comment: windowRef.Comment,
  }
  Object.assign(globalThis, globals)
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

type CounterState = { count: number }
type CounterActions = {
  increment(ctx: { state: CounterState }): void
  decrement(ctx: { state: CounterState }): void
}

function createCounterApp(home: ReactiveHome) {
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

  const view = element(
    'div',
    { class: 'counter-card' },
    element('span', { class: 'counter-label' }, text('count')),
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
            counter.actions.increment()
          }),
        },
        text('+'),
      ),
    ),
  )

  return { counter, view }
}

describe('Counter Application — Lifecycle, DOM Identity & Cleanup', () => {
  it('1. Initial render: displays initial count 0', () => {
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const { counter, view } = createCounterApp(home)
    const handle = mount(home, view, container)

    const countDisplay = container.querySelector('.count-display')
    const counterLabel = container.querySelector('.counter-label')
    const btnIncrement = container.querySelector('#btn-increment')
    const btnDecrement = container.querySelector('#btn-decrement')

    assert.ok(countDisplay, 'count display element exists')
    assert.ok(counterLabel, 'counter label exists')
    assert.ok(btnIncrement, 'increment button exists')
    assert.ok(btnDecrement, 'decrement button exists')

    assert.equal(counterLabel.textContent, 'count')
    assert.equal(countDisplay.textContent, '0')
    assert.equal(counter.state.count, 0)

    handle.unmount()
    container.remove()
    home.destroy()
  })

  it('2. Complete event-to-DOM update cycle: increment (0 -> 1 -> 2)', async () => {
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const { counter, view } = createCounterApp(home)
    const handle = mount(home, view, container)

    const countDisplay = container.querySelector('.count-display')!
    const btnIncrement = container.querySelector('#btn-increment')!

    // Click increment: 0 -> 1
    click(btnIncrement)
    await home.flush()
    assert.equal(counter.state.count, 1, 'state mutated to 1')
    assert.equal(countDisplay.textContent, '1', 'DOM updated to 1')

    // Click increment again: 1 -> 2
    click(btnIncrement)
    await home.flush()
    assert.equal(counter.state.count, 2, 'state mutated to 2')
    assert.equal(countDisplay.textContent, '2', 'DOM updated to 2')

    handle.unmount()
    container.remove()
    home.destroy()
  })

  it('3. Decrement: decreases count correctly (2 -> 1 -> 0 -> -1)', async () => {
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const { counter, view } = createCounterApp(home)
    const handle = mount(home, view, container)

    const countDisplay = container.querySelector('.count-display')!
    const btnIncrement = container.querySelector('#btn-increment')!
    const btnDecrement = container.querySelector('#btn-decrement')!

    // Increment twice
    click(btnIncrement)
    await home.flush()
    click(btnIncrement)
    await home.flush()
    assert.equal(countDisplay.textContent, '2')

    // Decrement once
    click(btnDecrement)
    await home.flush()
    assert.equal(counter.state.count, 1)
    assert.equal(countDisplay.textContent, '1')

    // Decrement to 0
    click(btnDecrement)
    await home.flush()
    assert.equal(counter.state.count, 0)
    assert.equal(countDisplay.textContent, '0')

    // Decrement below 0
    click(btnDecrement)
    await home.flush()
    assert.equal(counter.state.count, -1)
    assert.equal(countDisplay.textContent, '-1')

    handle.unmount()
    container.remove()
    home.destroy()
  })

  it('4. DOM Identity: elements retain exact object identity across updates', async () => {
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const { counter, view } = createCounterApp(home)
    const handle = mount(home, view, container)

    // Capture DOM element references before mutation
    const initialCard = container.querySelector('.counter-card')!
    const initialLabel = container.querySelector('.counter-label')!
    const initialDisplay = container.querySelector('.count-display')!
    const initialControls = container.querySelector('.controls')!
    const initialBtnInc = container.querySelector('#btn-increment')!
    const initialBtnDec = container.querySelector('#btn-decrement')!
    const initialTextNode = initialDisplay.firstChild as Text

    assert.equal(initialDisplay.textContent, '0')
    assert.equal(initialTextNode.nodeType, 3, 'Text node')

    // Perform multiple state updates via clicks and actions
    click(initialBtnInc)
    await home.flush()
    click(initialBtnInc)
    await home.flush()
    counter.actions.decrement()
    await home.flush()

    // Capture DOM element references after mutations
    const afterCard = container.querySelector('.counter-card')!
    const afterLabel = container.querySelector('.counter-label')!
    const afterDisplay = container.querySelector('.count-display')!
    const afterControls = container.querySelector('.controls')!
    const afterBtnInc = container.querySelector('#btn-increment')!
    const afterBtnDec = container.querySelector('#btn-decrement')!
    const afterTextNode = afterDisplay.firstChild as Text

    // Exact reference equality verification
    assert.strictEqual(afterCard, initialCard, 'Card element identity preserved')
    assert.strictEqual(afterLabel, initialLabel, 'Label element identity preserved')
    assert.strictEqual(afterDisplay, initialDisplay, 'Display div element identity preserved')
    assert.strictEqual(afterControls, initialControls, 'Controls div element identity preserved')
    assert.strictEqual(afterBtnInc, initialBtnInc, 'Increment button identity preserved')
    assert.strictEqual(afterBtnDec, initialBtnDec, 'Decrement button identity preserved')
    assert.strictEqual(afterTextNode, initialTextNode, 'Text node identity preserved (in-place data update)')

    assert.equal(afterDisplay.textContent, '1')

    handle.unmount()
    container.remove()
    home.destroy()
  })

  it('5. Reactive precision: count change does NOT touch or recreate unrelated nodes', async () => {
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const { counter, view } = createCounterApp(home)
    const handle = mount(home, view, container)

    const label = container.querySelector('.counter-label')!
    const btnInc = container.querySelector('#btn-increment')!

    // Attach custom expando properties to verify nodes are never replaced or cloned
    ;(label as any).__test_marker__ = 'unrelated-label'
    ;(btnInc as any).__test_marker__ = 'unrelated-button'

    // Mutate state multiple times
    click(btnInc)
    await home.flush()
    click(btnInc)
    await home.flush()
    click(btnInc)
    await home.flush()

    assert.equal((container.querySelector('.counter-label') as any).__test_marker__, 'unrelated-label')
    assert.equal((container.querySelector('#btn-increment') as any).__test_marker__, 'unrelated-button')
    assert.equal(counter.state.count, 3)

    handle.unmount()
    container.remove()
    home.destroy()
  })

  it('6. Cleanup: unmount disposes subscriptions, removes event listeners, and stops DOM updates', async () => {
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const { counter, view } = createCounterApp(home)
    const handle = mount(home, view, container)

    const card = container.querySelector('.counter-card')!
    const display = container.querySelector('.count-display')!
    const btnInc = container.querySelector('#btn-increment')!
    const textNode = display.firstChild as Text

    // Verify initial mounting in container
    assert.equal(container.childNodes.length, 1)
    assert.equal(card.parentNode, container)
    assert.equal(display.textContent, '0')

    // Unmount the application
    handle.unmount()

    // 6a. DOM nodes removed from container and from parents
    assert.equal(container.childNodes.length, 0, 'Container should be empty after unmount')
    assert.equal(card.parentNode, null, 'Root node detached from parent')
    assert.equal(textNode.parentNode, null, 'Child text node detached from parent element')

    // 6b. Future state changes do NOT update the destroyed/detached DOM
    counter.actions.increment()
    await home.flush()
    assert.equal(counter.state.count, 1, 'Kin node state still increments')
    assert.equal(textNode.data, '0', 'Detached Text node was NOT updated (remains 0)')

    // 6c. Event listeners are removed
    // Clicking the detached button should NOT trigger increment anymore
    click(btnInc)
    await home.flush()
    assert.equal(counter.state.count, 1, 'Event listener was removed; click did not fire action')

    container.remove()
    home.destroy()
  })

  it('7. Error handling & invalid lifecycle operations', () => {
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const { counter, view } = createCounterApp(home)
    const handle = mount(home, view, container)

    // 7a. Double unmount is idempotent and does not throw
    assert.doesNotThrow(() => {
      handle.unmount()
    }, 'first unmount succeeds')

    assert.doesNotThrow(() => {
      handle.unmount()
    }, 'second unmount is idempotent and does not throw')

    // 7b. Calling mount() without document
    const origDoc = globalThis.document
    try {
      // @ts-ignore
      delete globalThis.document
      assert.throws(
        () => mount(home, view, container),
        /mount\(\) requires a DOM document/,
        'mount throws TypeError when document is undefined',
      )
    } finally {
      globalThis.document = origDoc
    }

    // 7c. Post-unmount operations on Kin node remain valid without reviving DOM
    assert.doesNotThrow(() => {
      counter.actions.decrement()
      counter.actions.increment()
    }, 'Action execution on Node after unmount does not throw')

    container.remove()
    home.destroy()
  })
})
