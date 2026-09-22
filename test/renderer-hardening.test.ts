/**
 * Renderer Hardening & Edge-Case Validation
 *
 * Stresses:
 * 1. Full Transition Cycle:
 *    Empty -> One -> Multiple -> Remove First -> Remove Middle -> Remove Last -> Empty
 * 2. Completion cycle: Incomplete -> Complete -> Incomplete
 * 3. when() conditional subscription and listener creation/destruction
 * 4. Destroyed DOM branch isolation (no reactions to state, no event firing)
 * 5. Stable DOM node identity verification
 * 6. Subscription leak & duplicate subscription checks
 * 7. Event listener leak & duplicate listener checks
 * 8. Stale DOM updates & updates after unmount
 * 9. Node destruction behavior
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

import {
  createReactiveHome,
  element,
  text,
  when,
  handler,
  mount,
} from '../src/index.js'
import {
  mountTodoApp,
  resetTodoIdCounter,
} from '../playground/src/todo.js'

let windowRef: Window

function installDom(): void {
  windowRef = new Window({ url: 'http://localhost:5173/todo.html' })
  const globals = {
    document: windowRef.document,
    Event: windowRef.Event,
    MouseEvent: windowRef.MouseEvent,
    KeyboardEvent: windowRef.KeyboardEvent,
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

describe('Renderer Hardening — Todo Lifecycle & State Transitions', () => {
  it('Transition: Empty -> One -> Multiple -> Remove First -> Remove Middle -> Remove Last -> Empty', async () => {
    resetTodoIdCounter()
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    // Step 1: Initial Empty
    const app = mountTodoApp(home, container, [])
    await home.flush()

    assert.ok(container.querySelector('#todo-empty'), 'Empty state visible initially')
    assert.equal(container.querySelector('#todo-list')?.children.length, 0)
    assert.equal(container.querySelector('#remaining-count')?.textContent, '0 remaining')

    // Step 2: Empty -> One Todo
    app.node.actions.addTodo('Task 1')
    await home.flush()

    assert.equal(container.querySelector('#todo-empty'), null, 'Empty state removed')
    const list = container.querySelector('#todo-list')!
    assert.equal(list.children.length, 1)
    const item1 = list.children[0] as HTMLLIElement
    assert.equal(item1.id, 'todo-t-1')
    assert.equal(container.querySelector('#remaining-count')?.textContent, '1 remaining')

    // Step 3: One -> Multiple (Add Task 2 and Task 3)
    app.node.actions.addTodo('Task 2')
    await home.flush()
    app.node.actions.addTodo('Task 3')
    await home.flush()

    assert.equal(list.children.length, 3)
    assert.strictEqual(list.children[0], item1, 'Task 1 retains exact identity')
    const item2 = list.children[1] as HTMLLIElement
    const item3 = list.children[2] as HTMLLIElement
    assert.equal(item2.id, 'todo-t-2')
    assert.equal(item3.id, 'todo-t-3')
    assert.equal(container.querySelector('#remaining-count')?.textContent, '3 remaining')

    // Step 4: Remove First Todo (Remove Task 1)
    const toggleBtn1 = item1.querySelector('#toggle-t-1')!
    app.node.actions.removeTodo('t-1')
    await home.flush()

    assert.equal(list.children.length, 2)
    assert.strictEqual(list.children[0], item2, 'Task 2 is now first and retained identity')
    assert.strictEqual(list.children[1], item3, 'Task 3 is now second and retained identity')
    assert.equal(item1.parentNode, null, 'Task 1 detached from DOM')
    assert.equal(container.querySelector('#remaining-count')?.textContent, '2 remaining')

    // Verify detached Task 1 listeners are removed
    click(toggleBtn1)
    await home.flush()
    assert.equal(app.node.state.todos.length, 2, 'Click on detached toggle did not mutate state')

    // Step 5: Add Task 4, then Remove Middle Todo (Remove Task 3)
    app.node.actions.addTodo('Task 4')
    await home.flush()
    assert.equal(list.children.length, 3)
    const item4 = list.children[2] as HTMLLIElement

    // Remove middle (Task 3)
    const toggleBtn3 = item3.querySelector('#toggle-t-3')!
    app.node.actions.removeTodo('t-3')
    await home.flush()

    assert.equal(list.children.length, 2)
    assert.strictEqual(list.children[0], item2, 'Task 2 retained identity at index 0')
    assert.strictEqual(list.children[1], item4, 'Task 4 retained identity at index 1')
    assert.equal(item3.parentNode, null, 'Task 3 detached from DOM')
    assert.equal(container.querySelector('#remaining-count')?.textContent, '2 remaining')

    click(toggleBtn3)
    await home.flush()
    assert.equal(app.node.state.todos.length, 2, 'Click on detached middle item did not mutate state')

    // Step 6: Remove Last Todo (Remove Task 4)
    const toggleBtn4 = item4.querySelector('#toggle-t-4')!
    app.node.actions.removeTodo('t-4')
    await home.flush()

    assert.equal(list.children.length, 1)
    assert.strictEqual(list.children[0], item2, 'Task 2 retained identity as sole item')
    assert.equal(item4.parentNode, null, 'Task 4 detached from DOM')
    assert.equal(container.querySelector('#remaining-count')?.textContent, '1 remaining')

    click(toggleBtn4)
    await home.flush()
    assert.equal(app.node.state.todos.length, 1)

    // Step 7: Remove final remaining todo -> Empty
    app.node.actions.removeTodo('t-2')
    await home.flush()

    assert.equal(list.children.length, 0)
    assert.ok(container.querySelector('#todo-empty'), 'Empty state reappears when list is empty')
    assert.equal(container.querySelector('#remaining-count')?.textContent, '0 remaining')

    app.unmount()
    container.remove()
    home.destroy()
  })

  it('Transition: Incomplete -> Complete -> Incomplete', async () => {
    resetTodoIdCounter()
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = mountTodoApp(home, container, [
      { id: 't-1', title: 'Toggle Task', completed: false },
    ])
    await home.flush()

    const item = container.querySelector('#todo-t-1') as HTMLLIElement
    const toggleBtn = container.querySelector('#toggle-t-1') as HTMLButtonElement
    const badge = container.querySelector('#remaining-count')!

    // Initial: Incomplete
    assert.equal(item.classList.contains('completed'), false)
    assert.equal(toggleBtn.textContent, '○')
    assert.equal(badge.textContent, '1 remaining')

    // Transition 1: Incomplete -> Complete
    click(toggleBtn)
    await home.flush()

    assert.strictEqual(container.querySelector('#todo-t-1'), item, 'Identity retained')
    assert.equal(item.classList.contains('completed'), true)
    assert.equal(toggleBtn.textContent, '✓')
    assert.equal(badge.textContent, '0 remaining')

    // Transition 2: Complete -> Incomplete
    click(toggleBtn)
    await home.flush()

    assert.strictEqual(container.querySelector('#todo-t-1'), item, 'Identity retained')
    assert.equal(item.classList.contains('completed'), false)
    assert.equal(toggleBtn.textContent, '○')
    assert.equal(badge.textContent, '1 remaining')

    app.unmount()
    container.remove()
    home.destroy()
  })

  it('when() conditional branches correctly create and destroy subscriptions and listeners', async () => {
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const stateNode = home.node({
      state: { showBranch: false, count: 0 },
      actions: {
        toggle(ctx) {
          ctx.state.showBranch = !ctx.state.showBranch
        },
        increment(ctx) {
          ctx.state.count++
        },
      },
    })

    let branchButtonClickCount = 0

    const view = element(
      'div',
      { id: 'wrapper' },
      when(
        () => stateNode.state.showBranch,
        element(
          'div',
          { id: 'branch-content' },
          element(
            'span',
            { id: 'branch-text' },
            text(() => `Value: ${stateNode.state.count}`),
          ),
          element(
            'button',
            {
              id: 'branch-button',
              onClick: handler(() => {
                branchButtonClickCount++
              }),
            },
            text('Click me'),
          ),
        ),
      ),
    )

    const handle = mount(home, view, container)
    await home.flush()

    // Branch starts false -> no branch content
    assert.equal(container.querySelector('#branch-content'), null)

    // Flip to true: branch materializes
    stateNode.actions.toggle()
    await home.flush()

    const branchContent1 = container.querySelector('#branch-content')!
    const branchText1 = container.querySelector('#branch-text')!
    const branchBtn1 = container.querySelector('#branch-button')!
    const textNode1 = branchText1.firstChild as Text
    assert.ok(branchContent1)
    assert.equal(textNode1.data, 'Value: 0')

    // Reactive update within branch
    stateNode.actions.increment()
    await home.flush()
    assert.equal(textNode1.data, 'Value: 1')

    // Click button in active branch
    click(branchBtn1)
    assert.equal(branchButtonClickCount, 1)

    // Flip to false: branch destroyed
    stateNode.actions.toggle()
    await home.flush()

    assert.equal(container.querySelector('#branch-content'), null)
    assert.equal(branchContent1.parentNode, null, 'Branch content detached from DOM')

    // Increment count while branch is destroyed
    stateNode.actions.increment()
    await home.flush()

    // Verify destroyed branch DOM did NOT update (no stale reaction)
    assert.equal(textNode1.data, 'Value: 1', 'Destroyed branch text did NOT react to state change')

    // Verify destroyed branch event listener does not fire
    click(branchBtn1)
    assert.equal(branchButtonClickCount, 1, 'Destroyed branch listener did NOT fire')

    // Flip back to true: fresh branch materializes with current state
    stateNode.actions.toggle()
    await home.flush()

    const branchContent2 = container.querySelector('#branch-content')!
    const branchText2 = container.querySelector('#branch-text')!
    const branchBtn2 = container.querySelector('#branch-button')!

    assert.ok(branchContent2)
    assert.notStrictEqual(branchContent2, branchContent1, 'New branch element instantiated')
    assert.equal(branchText2.textContent, 'Value: 2', 'New branch shows current state')

    click(branchBtn2)
    assert.equal(branchButtonClickCount, 2, 'New branch button fires event')

    handle.unmount()
    container.remove()
    home.destroy()
  })

  it('No updates after unmount: state mutations after handle.unmount() are ignored', async () => {
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const node = home.node({
      state: { text: 'Initial' },
      actions: {
        set(ctx, val: string) {
          ctx.state.text = val
        },
      },
    })

    const view = element('div', { id: 'test-node' }, text(() => node.state.text))
    const handle = mount(home, view, container)
    await home.flush()

    const el = container.querySelector('#test-node')!
    const textNode = el.firstChild as Text
    assert.equal(textNode.data, 'Initial')

    handle.unmount()

    // State changes after unmount
    node.actions.set('Updated after unmount')
    await home.flush()

    assert.equal(textNode.data, 'Initial', 'Detached DOM text node was NOT updated')
    assert.equal(container.children.length, 0, 'Container remains empty')

    home.destroy()
  })

  it('Node destruction: node.destroy() disposes subscriptions without errors', async () => {
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const node = home.node({
      state: { count: 10 },
      actions: {
        inc(ctx) {
          ctx.state.count++
        },
      },
    })

    const view = element('div', { id: 'count-node' }, text(() => String(node.state.count)))
    const handle = mount(home, view, container)
    await home.flush()

    const el = container.querySelector('#count-node')!
    assert.equal(el.textContent, '10')

    // Destroy node
    node.destroy()

    // Attempting to invoke action on destroyed node throws error
    assert.throws(
      () => node.actions.inc(),
      /Cannot invoke action "inc" on a destroyed node/,
    )

    // DOM should remain stable and clean
    assert.equal(el.textContent, '10')

    handle.unmount()
    container.remove()
    home.destroy()
  })
})
