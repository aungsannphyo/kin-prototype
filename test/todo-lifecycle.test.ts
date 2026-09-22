/**
 * Comprehensive Todo Application Lifecycle & Reactive Stress Test
 *
 * Stresses the Kin frontend architecture:
 * 1. Add a todo
 * 2. Add multiple todos
 * 3. Toggle a todo
 * 4. Remove a todo
 * 5. Update remaining count
 * 6. Render an empty state
 * 7. Return from empty state to populated state
 * 8. DOM identity retention across list changes
 * 9. Reactive precision (unrelated items not touched)
 * 10. Complete lifecycle cleanup on unmount
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

import { createReactiveHome } from '../src/index.js'
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

describe('Kin Todo Application — Architecture Stress Testing', () => {
  it('1. Render an empty state when initialized with no todos', async () => {
    resetTodoIdCounter()
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = mountTodoApp(home, container, [])
    await home.flush()

    const emptyEl = container.querySelector('#todo-empty')
    const listEl = container.querySelector('#todo-list')!
    const badge = container.querySelector('#remaining-count')!

    assert.ok(emptyEl, 'empty state element should be rendered')
    assert.equal(listEl.children.length, 0, 'list should have 0 items')
    assert.equal(badge.textContent, '0 remaining')

    app.unmount()
    container.remove()
    home.destroy()
  })

  it('2. Add a todo and return from empty state to populated state', async () => {
    resetTodoIdCounter()
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = mountTodoApp(home, container, [])
    await home.flush()

    assert.ok(container.querySelector('#todo-empty'), 'starts with empty state')

    // Add todo via action
    app.node.actions.addTodo('Buy groceries')
    await home.flush()

    assert.equal(container.querySelector('#todo-empty'), null, 'empty state is removed')
    const listEl = container.querySelector('#todo-list')!
    assert.equal(listEl.children.length, 1, 'list now has 1 child')

    const itemEl = listEl.children[0] as HTMLElement
    assert.equal(itemEl.id, 'todo-t-1')
    assert.ok(itemEl.querySelector('.todo-title')?.textContent?.includes('Buy groceries'))
    assert.equal(itemEl.querySelector('#toggle-t-1')?.textContent, '○')
    assert.equal(container.querySelector('#remaining-count')?.textContent, '1 remaining')

    app.unmount()
    container.remove()
    home.destroy()
  })

  it('3. Add multiple todos in correct order with accurate remaining count', async () => {
    resetTodoIdCounter()
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = mountTodoApp(home, container, [])
    await home.flush()

    app.node.actions.addTodo('First Task')
    await home.flush()
    app.node.actions.addTodo('Second Task')
    await home.flush()
    app.node.actions.addTodo('Third Task')
    await home.flush()

    const listEl = container.querySelector('#todo-list')!
    assert.equal(listEl.children.length, 3)

    const titles = Array.from(listEl.querySelectorAll('.todo-title')).map(
      (el) => el.textContent,
    )
    assert.deepEqual(titles, ['First Task', 'Second Task', 'Third Task'])
    assert.equal(container.querySelector('#remaining-count')?.textContent, '3 remaining')

    app.unmount()
    container.remove()
    home.destroy()
  })

  it('4. Toggle a todo: updates completed state and remaining count', async () => {
    resetTodoIdCounter()
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = mountTodoApp(home, container, [
      { id: 't-1', title: 'Test Task', completed: false },
    ])
    await home.flush()

    const toggleBtn = container.querySelector('#toggle-t-1')!
    const itemEl = container.querySelector('#todo-t-1')!
    const badge = container.querySelector('#remaining-count')!

    assert.equal(toggleBtn.textContent, '○')
    assert.equal(itemEl.classList.contains('completed'), false)
    assert.equal(badge.textContent, '1 remaining')

    // Click toggle button (browser event -> handler -> action -> mutation -> DOM update)
    click(toggleBtn)
    await home.flush()

    assert.equal(app.node.state.todos[0].completed, true)
    assert.equal(toggleBtn.textContent, '✓')
    assert.equal(itemEl.classList.contains('completed'), true)
    assert.equal(badge.textContent, '0 remaining')

    // Toggle back
    click(toggleBtn)
    await home.flush()

    assert.equal(app.node.state.todos[0].completed, false)
    assert.equal(toggleBtn.textContent, '○')
    assert.equal(itemEl.classList.contains('completed'), false)
    assert.equal(badge.textContent, '1 remaining')

    app.unmount()
    container.remove()
    home.destroy()
  })

  it('5. Remove a todo: updates list, disposes item nodes, and returns to empty state', async () => {
    resetTodoIdCounter()
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = mountTodoApp(home, container, [
      { id: 't-1', title: 'Task to keep', completed: false },
      { id: 't-2', title: 'Task to delete', completed: false },
    ])
    await home.flush()

    const listEl = container.querySelector('#todo-list')!
    assert.equal(listEl.children.length, 2)
    assert.equal(container.querySelector('#remaining-count')?.textContent, '2 remaining')

    const removeBtn2 = container.querySelector('#remove-t-2')!
    click(removeBtn2)
    await home.flush()

    // Task 2 should be gone from state and DOM
    assert.equal(app.node.state.todos.length, 1)
    assert.equal(listEl.children.length, 1)
    assert.equal(container.querySelector('#todo-t-2'), null)
    assert.equal(container.querySelector('#remaining-count')?.textContent, '1 remaining')

    // Remove remaining task
    const removeBtn1 = container.querySelector('#remove-t-1')!
    click(removeBtn1)
    await home.flush()

    // State is empty -> empty state renders
    assert.equal(app.node.state.todos.length, 0)
    assert.equal(listEl.children.length, 0)
    assert.ok(container.querySelector('#todo-empty'), 'empty state restored')
    assert.equal(container.querySelector('#remaining-count')?.textContent, '0 remaining')

    app.unmount()
    container.remove()
    home.destroy()
  })

  it('6. DOM Identity: existing todo DOM nodes retain identity across updates', async () => {
    resetTodoIdCounter()
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = mountTodoApp(home, container, [
      { id: 't-1', title: 'First', completed: false },
      { id: 't-2', title: 'Second', completed: false },
    ])
    await home.flush()

    // Capture initial DOM references
    const initialItem1 = container.querySelector('#todo-t-1')!
    const initialItem2 = container.querySelector('#todo-t-2')!
    const initialToggle1 = container.querySelector('#toggle-t-1')!
    const initialCard = container.querySelector('.todo-card')!
    const initialList = container.querySelector('#todo-list')!

    // Attach custom marker to test node retention
    ;(initialItem1 as any).__marker = 'retained-1'
    ;(initialItem2 as any).__marker = 'retained-2'

    // Add a third item
    app.node.actions.addTodo('Third')
    await home.flush()

    // Verify items 1 and 2 retained strict object identity
    assert.strictEqual(container.querySelector('#todo-t-1'), initialItem1)
    assert.strictEqual(container.querySelector('#todo-t-2'), initialItem2)
    assert.strictEqual(container.querySelector('.todo-card'), initialCard)
    assert.strictEqual(container.querySelector('#todo-list'), initialList)
    assert.equal((container.querySelector('#todo-t-1') as any).__marker, 'retained-1')
    assert.equal((container.querySelector('#todo-t-2') as any).__marker, 'retained-2')

    // Toggle item 1
    click(initialToggle1)
    await home.flush()

    // Verify identity still retained after toggle
    assert.strictEqual(container.querySelector('#todo-t-1'), initialItem1)
    assert.strictEqual(container.querySelector('#todo-t-2'), initialItem2)
    assert.equal((container.querySelector('#todo-t-1') as any).__marker, 'retained-1')

    // Remove item 2
    app.node.actions.removeTodo('t-2')
    await home.flush()

    // Item 1 must STILL retain identity
    assert.strictEqual(container.querySelector('#todo-t-1'), initialItem1)
    assert.equal((container.querySelector('#todo-t-1') as any).__marker, 'retained-1')

    app.unmount()
    container.remove()
    home.destroy()
  })

  it('7. Lifecycle: removed todo nodes do not retain active listeners or update', async () => {
    resetTodoIdCounter()
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = mountTodoApp(home, container, [
      { id: 't-1', title: 'Removable item', completed: false },
    ])
    await home.flush()

    const itemEl = container.querySelector('#todo-t-1')!
    const toggleBtn = container.querySelector('#toggle-t-1')!

    // Remove the todo
    app.node.actions.removeTodo('t-1')
    await home.flush()

    // Node is removed from parent
    assert.equal(itemEl.parentNode, null, 'item element removed from DOM')

    // Clicks on detached button must NOT trigger toggle action or errors
    click(toggleBtn)
    await home.flush()
    assert.equal(app.node.state.todos.length, 0, 'No action fired from detached listener')

    // Unmount the whole app
    app.unmount()

    // Container is emptied
    assert.equal(container.children.length, 0, 'Container completely emptied on app unmount')

    container.remove()
    home.destroy()
  })

  it('8. UI Input Row: typing in input and clicking Add creates todo', async () => {
    resetTodoIdCounter()
    const home = createReactiveHome()
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = mountTodoApp(home, container, [])
    await home.flush()

    const input = container.querySelector('#todo-input') as HTMLInputElement
    const btnAdd = container.querySelector('#btn-add-todo') as HTMLButtonElement

    // Type into input
    input.value = 'User input task'

    // Click Add
    click(btnAdd)
    await home.flush()

    assert.equal(input.value, '', 'input cleared after adding')
    assert.equal(app.node.state.todos.length, 1)
    assert.equal(app.node.state.todos[0].title, 'User input task')
    assert.equal(container.querySelector('.todo-title')?.textContent, 'User input task')

    app.unmount()
    container.remove()
    home.destroy()
  })
})
