/**
 * Phase G.1 — Keyed List Primitive each() Lifecycle & Stress Testing
 *
 * Tests the 16 architectural requirements for each():
 *  1. Initial list rendering
 *  2. Empty list rendering & transition to empty
 *  3. Append
 *  4. Prepend
 *  5. Middle insertion
 *  6. Middle removal
 *  7. Last removal
 *  8. Replacement
 *  9. Reordering ([A, B, C] -> [C, A, B])
 * 10. Duplicate keys rejection with deterministic error
 * 11. Item-local fine-grained reactivity
 * 12. Event handlers inside items
 * 13. Parent unmount lifecycle
 * 14. Home destruction
 * 15. Subscription cleanup on removed items
 * 16. Comprehensive DOM identity preservation (===)
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

import {
  createReactiveHome,
  element,
  text,
  each,
  handler,
  mount,
  type ReactiveHome,
} from '../src/index.js'

let windowRef: Window

function installDom(): void {
  windowRef = new Window({ url: 'http://localhost:5173/each-test.html' })
  const globals = {
    document: windowRef.document,
    Event: windowRef.Event,
    MouseEvent: windowRef.MouseEvent,
    Node: windowRef.Node,
    HTMLElement: windowRef.HTMLElement,
    HTMLInputElement: windowRef.HTMLInputElement,
    HTMLButtonElement: windowRef.HTMLButtonElement,
    HTMLUListElement: windowRef.HTMLUListElement,
    HTMLLIElement: windowRef.HTMLLIElement,
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

type Item = { id: string; text: string }
type ListState = { items: Item[] }
type ListActions = {
  setItems(ctx: { state: ListState }, items: Item[]): void
  updateText(ctx: { state: ListState }, id: string, text: string): void
}

function createListFixture(home: ReactiveHome, initialItems: Item[] = []) {
  const node = home.node<ListState, ListActions>({
    state: { items: initialItems },
    actions: {
      setItems(ctx, items: Item[]) {
        ctx.state.items = items
      },
      updateText(ctx, id: string, text: string) {
        ctx.state.items = ctx.state.items.map((it) =>
          it.id === id ? { ...it, text } : it,
        )
      },
    },
  })
  return node
}

describe('Phase G.1 — each() Keyed List Primitive Lifecycle', () => {
  it('1. Initial list rendering: mounts collection in correct order', () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: '1', text: 'Alpha' },
      { id: '2', text: 'Beta' },
      { id: '3', text: 'Gamma' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      { id: 'list' },
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', { id: `item-${item.id}` }, text(item.text)),
      ),
    )

    const handle = mount(home, view, container)
    const ul = container.querySelector('#list') as HTMLUListElement
    assert.ok(ul, 'UL mounted')

    const lis = ul.querySelectorAll('li')
    assert.equal(lis.length, 3)
    assert.equal(lis[0]?.textContent, 'Alpha')
    assert.equal(lis[1]?.textContent, 'Beta')
    assert.equal(lis[2]?.textContent, 'Gamma')

    handle.unmount()
  })

  it('2. Empty list: initial empty renders comments only; populated to empty removes all items', async () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [])

    const container = document.createElement('div')
    const view = element(
      'ul',
      { id: 'list' },
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', { id: `item-${item.id}` }, text(item.text)),
      ),
    )

    const handle = mount(home, view, container)
    const ul = container.querySelector('#list') as HTMLUListElement
    assert.equal(ul.querySelectorAll('li').length, 0)

    // Populate
    node.actions.setItems([
      { id: 'a', text: 'Apple' },
      { id: 'b', text: 'Banana' },
    ])
    await home.flush()
    assert.equal(ul.querySelectorAll('li').length, 2)

    // Clear back to empty
    node.actions.setItems([])
    await home.flush()
    assert.equal(ul.querySelectorAll('li').length, 0)

    handle.unmount()
  })

  it('3. Append: adds item at end and preserves existing DOM identity', async () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', { id: `li-${item.id}` }, text(item.text)),
      ),
    )

    const handle = mount(home, view, container)
    const liA = container.querySelector('#li-a')
    const liB = container.querySelector('#li-b')
    assert.ok(liA && liB)

    // Append C
    node.actions.setItems([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ])
    await home.flush()

    const lis = container.querySelectorAll('li')
    assert.equal(lis.length, 3)
    assert.equal(lis[0], liA, 'liA identity preserved')
    assert.equal(lis[1], liB, 'liB identity preserved')
    assert.equal(lis[2]?.textContent, 'C')

    handle.unmount()
  })

  it('4. Prepend: adds item at start and preserves existing DOM identity', async () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', { id: `li-${item.id}` }, text(item.text)),
      ),
    )

    const handle = mount(home, view, container)
    const liB = container.querySelector('#li-b')
    const liC = container.querySelector('#li-c')

    // Prepend A
    node.actions.setItems([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ])
    await home.flush()

    const lis = container.querySelectorAll('li')
    assert.equal(lis.length, 3)
    assert.equal(lis[0]?.textContent, 'A')
    assert.equal(lis[1], liB, 'liB identity preserved')
    assert.equal(lis[2], liC, 'liC identity preserved')

    handle.unmount()
  })

  it('5. Middle insertion: inserts item between siblings and preserves identities', async () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: 'a', text: 'A' },
      { id: 'c', text: 'C' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', { id: `li-${item.id}` }, text(item.text)),
      ),
    )

    const handle = mount(home, view, container)
    const liA = container.querySelector('#li-a')
    const liC = container.querySelector('#li-c')

    // Insert B between A and C
    node.actions.setItems([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ])
    await home.flush()

    const lis = container.querySelectorAll('li')
    assert.equal(lis.length, 3)
    assert.equal(lis[0], liA, 'liA identity preserved')
    assert.equal(lis[1]?.textContent, 'B')
    assert.equal(lis[2], liC, 'liC identity preserved')

    handle.unmount()
  })

  it('6. Middle removal: removes middle item and disposes its node', async () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', { id: `li-${item.id}` }, text(item.text)),
      ),
    )

    const handle = mount(home, view, container)
    const liA = container.querySelector('#li-a')
    const liB = container.querySelector('#li-b')
    const liC = container.querySelector('#li-c')

    // Remove B
    node.actions.setItems([
      { id: 'a', text: 'A' },
      { id: 'c', text: 'C' },
    ])
    await home.flush()

    const lis = container.querySelectorAll('li')
    assert.equal(lis.length, 2)
    assert.equal(lis[0], liA, 'liA identity preserved')
    assert.equal(lis[1], liC, 'liC identity preserved')
    assert.equal(liB?.parentNode, null, 'liB removed from DOM')

    handle.unmount()
  })

  it('7. Last removal: removes final item cleanly', async () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', { id: `li-${item.id}` }, text(item.text)),
      ),
    )

    const handle = mount(home, view, container)
    const liA = container.querySelector('#li-a')
    const liB = container.querySelector('#li-b')
    const liC = container.querySelector('#li-c')

    // Remove C
    node.actions.setItems([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ])
    await home.flush()

    const lis = container.querySelectorAll('li')
    assert.equal(lis.length, 2)
    assert.equal(lis[0], liA)
    assert.equal(lis[1], liB)
    assert.equal(liC?.parentNode, null, 'liC removed from DOM')

    handle.unmount()
  })

  it('8. Replacement: [A, B, C] -> [A, X, C] preserves A and C, destroys B, mounts X', async () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', { id: `li-${item.id}` }, text(item.text)),
      ),
    )

    const handle = mount(home, view, container)
    const liA = container.querySelector('#li-a')
    const liB = container.querySelector('#li-b')
    const liC = container.querySelector('#li-c')

    // Replace B with X
    node.actions.setItems([
      { id: 'a', text: 'A' },
      { id: 'x', text: 'X' },
      { id: 'c', text: 'C' },
    ])
    await home.flush()

    const lis = container.querySelectorAll('li')
    assert.equal(lis.length, 3)
    assert.equal(lis[0], liA, 'liA preserved')
    assert.equal(lis[1]?.textContent, 'X', 'X inserted')
    assert.equal(lis[2], liC, 'liC preserved')
    assert.equal(liB?.parentNode, null, 'liB removed')

    handle.unmount()
  })

  it('9. Reordering: [A, B, C] -> [C, A, B] preserves all DOM element identities and moves them', async () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', { id: `li-${item.id}` }, text(item.text)),
      ),
    )

    const handle = mount(home, view, container)
    const liA = container.querySelector('#li-a')
    const liB = container.querySelector('#li-b')
    const liC = container.querySelector('#li-c')

    // Reorder to [C, A, B]
    node.actions.setItems([
      { id: 'c', text: 'C' },
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ])
    await home.flush()

    const lis = container.querySelectorAll('li')
    assert.equal(lis.length, 3)
    assert.equal(lis[0], liC, 'liC moved to first position')
    assert.equal(lis[1], liA, 'liA moved to second position')
    assert.equal(lis[2], liB, 'liB moved to third position')

    handle.unmount()
  })

  it('10. Duplicate keys: throws descriptive deterministic error and prevents corruption', () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: 'dup', text: 'First' },
      { id: 'dup', text: 'Second' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', {}, text(item.text)),
      ),
    )

    assert.throws(
      () => {
        mount(home, view, container)
      },
      (err: Error) => {
        return (
          err instanceof Error &&
          err.message.includes('Duplicate key "dup" detected in each()')
        )
      },
    )
  })

  it('11. Item-local reactivity: updating item content updates text without recreating element', async () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: '1', text: 'Initial 1' },
      { id: '2', text: 'Initial 2' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) =>
          element(
            'li',
            { id: `item-${item.id}` },
            text(() => {
              const current = node.state.items.find((it) => it.id === item.id)
              return current ? current.text : ''
            }),
          ),
      ),
    )

    const handle = mount(home, view, container)
    const li1 = container.querySelector('#item-1')
    const li2 = container.querySelector('#item-2')
    assert.equal(li1?.textContent, 'Initial 1')

    // Update text of item 1
    node.actions.updateText('1', 'Updated 1')
    await home.flush()

    assert.equal(li1?.textContent, 'Updated 1')
    assert.equal(container.querySelector('#item-1'), li1, 'li1 identity preserved')
    assert.equal(container.querySelector('#item-2'), li2, 'li2 identity preserved')

    handle.unmount()
  })

  it('12. Event handlers inside items: clicks invoke actions correctly', () => {
    const home = createReactiveHome()
    let clickedId: string | null = null

    const node = createListFixture(home, [
      { id: 'item-x', text: 'Item X' },
      { id: 'item-y', text: 'Item Y' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) =>
          element(
            'li',
            {},
            element(
              'button',
              {
                id: `btn-${item.id}`,
                onClick: handler(() => {
                  clickedId = item.id
                }),
              },
              text(item.text),
            ),
          ),
      ),
    )

    const handle = mount(home, view, container)
    const btnY = container.querySelector('#btn-item-y') as HTMLButtonElement
    assert.ok(btnY)

    click(btnY)
    assert.equal(clickedId, 'item-y')

    handle.unmount()
  })

  it('13. Parent unmount: unmounting cleans up all item nodes, anchors, and listeners', async () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      { id: 'ul-root' },
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', { id: `li-${item.id}` }, text(item.text)),
      ),
    )

    const handle = mount(home, view, container)
    assert.equal(container.querySelectorAll('li').length, 2)

    // Unmount
    handle.unmount()
    assert.equal(container.querySelectorAll('li').length, 0)
    assert.equal(container.childNodes.length, 0)

    // Mutating state after unmount must have no effect
    node.actions.setItems([{ id: 'c', text: 'C' }])
    await home.flush()
    assert.equal(container.childNodes.length, 0)
  })

  it('14. Home destruction: destroys home cleanly without errors', () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [{ id: '1', text: 'One' }])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', {}, text(item.text)),
      ),
    )

    mount(home, view, container)
    assert.equal(container.querySelectorAll('li').length, 1)

    // Destroy home
    assert.doesNotThrow(() => {
      home.destroy()
    })
  })

  it('15. Subscription cleanup: removed items dispose their internal subscriptions', async () => {
    const home = createReactiveHome()
    let item1ComputeCount = 0

    const node = createListFixture(home, [
      { id: '1', text: 'One' },
      { id: '2', text: 'Two' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) =>
          element(
            'li',
            { id: `item-${item.id}` },
            text(() => {
              if (item.id === '1') {
                item1ComputeCount++
              }
              const found = node.state.items.find((it) => it.id === item.id)
              return found ? found.text : ''
            }),
          ),
      ),
    )

    const handle = mount(home, view, container)
    const initialCount = item1ComputeCount
    assert.ok(initialCount >= 1)

    // Remove item 1
    node.actions.setItems([{ id: '2', text: 'Two' }])
    await home.flush()
    const countAfterRemove = item1ComputeCount

    // Mutate state again
    node.actions.setItems([{ id: '2', text: 'Two Updated' }])
    await home.flush()

    // Compute count for item 1 must NOT have incremented because it was disposed!
    assert.equal(
      item1ComputeCount,
      countAfterRemove,
      'Item 1 subscription was disposed and did not recompute',
    )

    handle.unmount()
  })

  it('16. Comprehensive DOM identity preservation across multiple mutation steps', async () => {
    const home = createReactiveHome()
    const node = createListFixture(home, [
      { id: '1', text: 'One' },
      { id: '2', text: 'Two' },
      { id: '3', text: 'Three' },
    ])

    const container = document.createElement('div')
    const view = element(
      'ul',
      {},
      each(
        () => node.state.items,
        (item) => item.id,
        (item) => element('li', { id: `item-${item.id}` }, text(item.text)),
      ),
    )

    const handle = mount(home, view, container)
    const n1 = container.querySelector('#item-1')
    const n2 = container.querySelector('#item-2')
    const n3 = container.querySelector('#item-3')

    // Step 1: Reorder to [3, 1, 2]
    node.actions.setItems([
      { id: '3', text: 'Three' },
      { id: '1', text: 'One' },
      { id: '2', text: 'Two' },
    ])
    await home.flush()

    let lis = container.querySelectorAll('li')
    assert.equal(lis[0], n3)
    assert.equal(lis[1], n1)
    assert.equal(lis[2], n2)

    // Step 2: Remove 2, insert 4 in middle -> [3, 4, 1]
    node.actions.setItems([
      { id: '3', text: 'Three' },
      { id: '4', text: 'Four' },
      { id: '1', text: 'One' },
    ])
    await home.flush()

    lis = container.querySelectorAll('li')
    assert.equal(lis.length, 3)
    assert.equal(lis[0], n3, 'n3 retained')
    assert.equal(lis[1]?.textContent, 'Four')
    assert.equal(lis[2], n1, 'n1 retained')
    assert.equal(n2?.parentNode, null, 'n2 removed')

    handle.unmount()
  })
})
