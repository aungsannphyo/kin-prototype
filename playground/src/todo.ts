/**
 * Kin Browser Playground — Todo Application
 *
 * Stresses the existing Kin frontend architecture:
 * - Dynamic list rendering using ONLY Kin's public API
 * - Kin Node with state and actions: addTodo, toggleTodo, removeTodo
 * - Fine-grained reactive bindings for title, count, empty state, and item states
 * - Plain view functions (NO component runtime, NO VDOM, NO framework template language)
 * - Complete lifecycle management: sub-mount handles disposed on item removal
 */

import {
  createReactiveHome,
  element,
  text,
  when,
  handler,
  mount,
  type ReactiveHome,
  type ReactiveNode,
  type ChildNode,
  type MountHandle,
} from 'kin-prototype'

// ---------------------------------------------------------------------------
// 1. Types & State Model
// ---------------------------------------------------------------------------

export type Todo = {
  id: string
  title: string
  completed: boolean
}

export type TodoState = {
  todos: Todo[]
}

export type TodoActions = {
  addTodo(ctx: { state: TodoState }, title: string): void
  toggleTodo(ctx: { state: TodoState }, id: string): void
  removeTodo(ctx: { state: TodoState }, id: string): void
}

let _nextId = 1
export function createTodoId(): string {
  return `t-${_nextId++}`
}

export function resetTodoIdCounter(): void {
  _nextId = 1
}

// ---------------------------------------------------------------------------
// 2. Node Factory
// ---------------------------------------------------------------------------

export function createTodoNode(
  home: ReactiveHome,
  initialTodos: Todo[] = [],
): ReactiveNode<TodoState, TodoActions> {
  return home.node<TodoState, TodoActions>({
    state: { todos: initialTodos },
    actions: {
      addTodo(ctx, title: string) {
        const trimmed = title.trim()
        if (trimmed.length === 0) return
        ctx.state.todos = [
          ...ctx.state.todos,
          { id: createTodoId(), title: trimmed, completed: false },
        ]
      },
      toggleTodo(ctx, id: string) {
        ctx.state.todos = ctx.state.todos.map((t) =>
          t.id === id ? { ...t, completed: !t.completed } : t,
        )
      },
      removeTodo(ctx, id: string) {
        ctx.state.todos = ctx.state.todos.filter((t) => t.id !== id)
      },
    },
  })
}

// ---------------------------------------------------------------------------
// 3. Plain View Functions (Zero Component Abstraction)
// ---------------------------------------------------------------------------

/**
 * TodoItemView — plain function returning an ElementNode descriptor for one item.
 */
export function TodoItemView(
  node: ReactiveNode<TodoState, TodoActions>,
  id: string,
): ChildNode {
  return element(
    'li',
    {
      class: () => {
        const item = node.state.todos.find((t) => t.id === id)
        return item && item.completed ? 'todo-item completed' : 'todo-item'
      },
      id: `todo-${id}`,
    },
    // Toggle button
    element(
      'button',
      {
        class: () => {
          const item = node.state.todos.find((t) => t.id === id)
          return item && item.completed ? 'btn-toggle checked' : 'btn-toggle'
        },
        id: `toggle-${id}`,
        title: 'Toggle completion',
        onClick: handler(() => {
          node.actions.toggleTodo(id)
        }),
      },
      text(() => {
        const item = node.state.todos.find((t) => t.id === id)
        return item && item.completed ? '✓' : '○'
      }),
    ),
    // Title
    element(
      'span',
      { class: 'todo-title' },
      text(() => {
        const item = node.state.todos.find((t) => t.id === id)
        return item ? item.title : ''
      }),
    ),
    // Remove button
    element(
      'button',
      {
        class: 'btn-remove',
        id: `remove-${id}`,
        title: 'Delete todo',
        onClick: handler(() => {
          node.actions.removeTodo(id)
        }),
      },
      text('×'),
    ),
  )
}

/**
 * TodoAppShellView — plain function returning the main UI shell.
 */
export function TodoAppShellView(
  node: ReactiveNode<TodoState, TodoActions>,
  onAdd: () => void,
): ChildNode {
  return element(
    'div',
    { class: 'todo-card' },

    // Title
    element(
      'div',
      { class: 'todo-header' },
      element('h2', { class: 'todo-title-heading' }, text('Tasks')),
      element(
        'span',
        { class: 'remaining-badge', id: 'remaining-count' },
        text(() => {
          const remaining = node.state.todos.filter((t) => !t.completed).length
          return `${remaining} remaining`
        }),
      ),
    ),

    // Input row
    element(
      'div',
      { class: 'todo-input-row' },
      element('input', {
        type: 'text',
        class: 'todo-input',
        id: 'todo-input',
        placeholder: 'What needs to be done?',
        onKeyDown: handler((e: unknown) => {
          const ke = e as KeyboardEvent
          if (ke.key === 'Enter') {
            onAdd()
          }
        }),
      }),
      element(
        'button',
        {
          class: 'btn-add',
          id: 'btn-add-todo',
          onClick: handler(() => {
            onAdd()
          }),
        },
        text('Add'),
      ),
    ),

    // Empty state (using when() conditional primitive)
    when(
      () => node.state.todos.length === 0,
      element(
        'div',
        { class: 'todo-empty', id: 'todo-empty' },
        element('span', { class: 'empty-icon' }, text('📋')),
        element('p', {}, text('No tasks yet. Add one above!')),
      ),
    ),

    // Todo list container (items dynamically mounted into here)
    element('ul', { class: 'todo-list', id: 'todo-list' }),
  )
}

// ---------------------------------------------------------------------------
// 4. Mount & List Synchronization Driver
//
// Bridges Kin's reactive runtime to dynamic list management without
// introducing a VDOM or framework component runtime.
// ---------------------------------------------------------------------------

export type TodoAppHandle = {
  unmount(): void
  readonly home: ReactiveHome
  readonly node: ReactiveNode<TodoState, TodoActions>
  readonly listContainer: HTMLUListElement | null
}

export function mountTodoApp(
  home: ReactiveHome,
  container: HTMLElement,
  initialTodos: Todo[] = [],
): TodoAppHandle {
  const node = createTodoNode(home, initialTodos)

  function handleAdd(): void {
    const input = container.querySelector('#todo-input') as HTMLInputElement | null
    if (!input) return
    const value = input.value.trim()
    if (value.length > 0) {
      node.actions.addTodo(value)
      input.value = ''
      input.focus()
    }
  }

  // 1. Mount the app shell into container
  const shellView = TodoAppShellView(node, handleAdd)
  const shellHandle = mount(home, shellView, container)

  const listContainer = container.querySelector('#todo-list') as HTMLUListElement | null
  if (!listContainer) {
    throw new Error('Missing #todo-list container after shell mount')
  }

  // 2. Track mounted item handles to preserve DOM identity and manage lifecycle
  type MountedItem = {
    id: string
    handle: MountHandle
    element: HTMLLIElement
  }
  const mountedItems = new Map<string, MountedItem>()

  // 3. Fine-grained list sync subscriber
  // Only runs when node.state.todos array reference changes (add or remove)
  const listSubscriber = home.subscribe(() => {
    const todos = node.state.todos
    const activeIds = new Set(todos.map((t) => t.id))

    // Step A: Dispose removed items (calls handle.unmount() -> cleans up subscriptions, listeners, DOM)
    for (const [id, item] of mountedItems.entries()) {
      if (!activeIds.has(id)) {
        item.handle.unmount()
        mountedItems.delete(id)
      }
    }

    // Step B: Mount new items, preserve existing items & DOM identity
    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i]
      let item = mountedItems.get(todo.id)

      if (!item) {
        // Mount single new item view directly into listContainer
        const itemDescriptor = TodoItemView(node, todo.id)
        const itemHandle = mount(home, itemDescriptor, listContainer)
        const liElement = listContainer.lastElementChild as HTMLLIElement
        item = {
          id: todo.id,
          handle: itemHandle,
          element: liElement,
        }
        mountedItems.set(todo.id, item)
      }

      // Ensure correct DOM order without replacing nodes
      if (listContainer.children[i] !== item.element) {
        listContainer.insertBefore(item.element, listContainer.children[i] || null)
      }
    }
  })

  let unmounted = false

  return {
    home,
    node,
    listContainer,
    unmount() {
      if (unmounted) return
      unmounted = true

      // Unsubscribe the list synchronization subscriber
      home.unsubscribe(listSubscriber)

      // Unmount all individual item handles (disposes their subscriptions & listeners)
      for (const item of mountedItems.values()) {
        item.handle.unmount()
      }
      mountedItems.clear()

      // Unmount the shell (cleans up shell subscriptions & DOM nodes)
      shellHandle.unmount()
    },
  }
}

// ---------------------------------------------------------------------------
// 5. Browser Entry Point Auto-Mount (when running in playground page)
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') {
  const mountPoint = document.getElementById('todo-app')
  if (mountPoint) {
    const home = createReactiveHome()
    const appHandle = mountTodoApp(home, mountPoint, [
      { id: 't-1', title: 'Verify Kin architecture', completed: true },
      { id: 't-2', title: 'Stress test dynamic list reactivity', completed: false },
      { id: 't-3', title: 'Confirm DOM identity retention', completed: false },
    ])

      // Expose on window for browser-based automated testing & inspection
      ; (window as any).__KIN_TODO__ = appHandle
  }
}
