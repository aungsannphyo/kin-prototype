/**
 * Phase E.3 — View Composition & Reusable View Definitions
 *
 * Tests that plain function View definitions can be composed without
 * introducing a component runtime, and that all architectural guarantees
 * are preserved:
 *
 *   - Views are plain functions that return ChildNode
 *   - Composition is ordinary function composition
 *   - View functions are not rerun on reactive updates
 *   - Fine-grained reactive bindings remain independent
 *   - Authorization boundaries remain intact
 *   - No component instances, lifecycle, or VDOM
 *
 * Runner: node:test   Assertions: node:assert/strict
 * Uses happy-dom for DOM tests.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

import { createReactiveHome, capability, KinAuthError } from '../src/index.js'
import type { ReactiveNode } from '../src/index.js'
import {
  element,
  text,
  fragment,
  when,
  handler,
  isEventHandler,
} from '../src/view/index.js'
import { mount } from '../src/dom/index.js'
import type { View } from '../src/dom/index.js'
import type { ChildNode } from '../src/view/index.js'
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
// E3-1 through E3-4 — Basic View function definition
// ---------------------------------------------------------------------------

describe('E3-1 — Plain View function returns ChildNode', () => {
  it('a function returning text() produces a valid ChildNode', () => {
    const Greeting: View = () => text('Hello')
    const node = Greeting()
    assert.equal(node.type, 'text')
  })

  it('a function returning element() produces a valid ChildNode', () => {
    const Button: View = () => element('button', {}, text('Click'))
    const node = Button()
    assert.equal(node.type, 'element')
  })

  it('a function returning fragment() produces a valid ChildNode', () => {
    const List: View = () => fragment(text('a'), text('b'))
    const node = List()
    assert.equal(node.type, 'fragment')
  })

  it('a function returning when() produces a valid ChildNode', () => {
    const Conditional: View = () => when(() => true, text('yes'))
    const node = Conditional()
    assert.equal(node.type, 'conditional')
  })
})

describe('E3-2 — View with explicit primitive input', () => {
  it('View accepts a string parameter and uses it in text()', () => {
    const Greeting = (name: string): ChildNode => text(`Hello ${name}`)
    const node = Greeting('Alice')
    assert.equal(node.type, 'text')
    assert.equal(node.value, 'Hello Alice')
  })

  it('View accepts a number parameter and uses it in element prop', () => {
    const Input = (tabIndex: number): ChildNode =>
      element('input', { tabIndex })
    const node = Input(5)
    if (node.type === 'element') {
      assert.equal(node.props['tabIndex'], 5)
    }
  })

  it('View accepts multiple parameters', () => {
    const Link = (href: string, target: string): ChildNode =>
      element('a', { href, target }, text('Link'))
    const node = Link('/home', '_blank')
    if (node.type === 'element') {
      assert.equal(node.props['href'], '/home')
      assert.equal(node.props['target'], '_blank')
    }
  })
})

describe('E3-3 — View with application data input', () => {
  it('View accepts a data object and renders its fields', () => {
    type UserData = { name: string; email: string }
    const UserCard = (data: UserData): ChildNode =>
      element('div', {},
        text(data.name),
        text(data.email)
      )
    const node = UserCard({ name: 'Alice', email: 'alice@example.com' })
    assert.equal(node.type, 'element')
    assert.equal(node.children.length, 2)
  })
})

describe('E3-4 — View using a Node', () => {
  it('View accepts a ReactiveNode and accesses its state', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const Counter = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('button', {}, text(() => String(n.state.count)))

    const descriptor = Counter(node)
    assert.equal(descriptor.type, 'element')
    assert.equal(descriptor.tag, 'button')

    home.destroy()
  })

  it('View accepts a Node and uses its actions in event handler', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const Counter = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('button', { onClick: handler(() => n.actions.increment()) }, text('Click'))

    const descriptor = Counter(node)
    if (descriptor.type === 'element') {
      const onClick = descriptor.props['onClick']
      assert.equal(isEventHandler(onClick), true)
    }

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E3-5 through E3-7 — View composition
// ---------------------------------------------------------------------------

describe('E3-5 — View composition: Header, Counter, Footer', () => {
  it('three Views composed in an App View produce correct nested structure', () => {
    const Header: View = () => element('header', {}, text('Kin'))
    const Footer: View = () => element('footer', {}, text('Footer'))

    const Counter = (node: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('button', { onClick: handler(() => node.actions.increment()) }, text(() => String(node.state.count)))

    const App = (node: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('main', {}, Header(), Counter(node), Footer())

    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const descriptor = App(node)
    assert.equal(descriptor.type, 'element')
    assert.equal(descriptor.tag, 'main')
    assert.equal(descriptor.children.length, 3)

    const header = descriptor.children[0]
    assert.equal(header.type, 'element')
    assert.equal((header as { tag: string }).tag, 'header')

    const counter = descriptor.children[1]
    assert.equal(counter.type, 'element')
    assert.equal((counter as { tag: string }).tag, 'button')

    const footer = descriptor.children[2]
    assert.equal(footer.type, 'element')
    assert.equal((footer as { tag: string }).tag, 'footer')

    home.destroy()
  })
})

describe('E3-6 — Nested View composition', () => {
  it('Dashboard composed with Header and Counter produces correct structure', () => {
    const Header: View = () => element('header', {}, text('Kin'))

    const Counter = (node: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('button', { onClick: handler(() => node.actions.increment()) }, text(() => String(node.state.count)))

    const Dashboard = (node: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('div', {}, Header(), Counter(node))

    const App = (node: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('main', {}, Dashboard(node))

    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const descriptor = App(node)
    assert.equal(descriptor.type, 'element')
    assert.equal(descriptor.tag, 'main')

    const dashboard = descriptor.children[0]
    assert.equal(dashboard.type, 'element')
    assert.equal((dashboard as { tag: string }).tag, 'div')

    const divChildren = (dashboard as { children: readonly ChildNode[] }).children
    assert.equal(divChildren.length, 2)

    home.destroy()
  })
})

describe('E3-7 — Composed Views preserve descriptor structure', () => {
  it('composition does not alter the ChildNode types', () => {
    const A: View = () => text('A')
    const B: View = () => text('B')
    const Combined: View = () => fragment(A(), B())

    const descriptor = Combined()
    assert.equal(descriptor.type, 'fragment')
    assert.equal(descriptor.children.length, 2)
    assert.equal(descriptor.children[0].type, 'text')
    assert.equal(descriptor.children[1].type, 'text')
  })
})

// ---------------------------------------------------------------------------
// E3-8 through E3-14 — Reactivity guarantees
// ---------------------------------------------------------------------------

describe('E3-8 — Multiple Views sharing the same Node', () => {
  it('two Views using the same Node both mount correctly', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const Counter1 = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      text(() => String(n.state.count))

    const Counter2 = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('span', {}, text(() => String(n.state.count)))

    const host = container()
    const handle = mount(home, fragment(Counter1(node), Counter2(node)), host)

    assert.equal(host.childNodes[0]?.textContent, '0')
    assert.equal((host.childNodes[1] as HTMLElement).textContent, '0')

    node.actions.increment()
    await home.flush()

    assert.equal(host.childNodes[0]?.textContent, '1')
    assert.equal((host.childNodes[1] as HTMLElement).textContent, '1')

    handle.unmount()
    home.destroy()
  })
})

describe('E3-9 — Reactive text inside composed View still updates', () => {
  it('reactive getter in composed View updates on state change', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const Counter = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      text(() => String(n.state.count))

    const App = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('div', {}, Counter(n))

    const host = container()
    const handle = mount(home, App(node), host)

    assert.equal(host.textContent, '0')

    node.actions.increment()
    await home.flush()

    assert.equal(host.textContent, '1')

    handle.unmount()
    home.destroy()
  })
})

describe('E3-10 — Reactive prop inside composed View still updates', () => {
  it('reactive prop in composed View updates on state change', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { loading: true },
      actions: { stop(ctx) { ctx.state.loading = false } },
    })

    const Button = (n: ReactiveNode<{ loading: boolean }, { stop: () => void }>): ChildNode =>
      element('button', { disabled: () => n.state.loading }, text('Go'))

    const host = container()
    const handle = mount(home, Button(node), host)

    const btn = host.firstChild as HTMLButtonElement
    assert.equal(btn.disabled, true)

    node.actions.stop()
    await home.flush()

    assert.equal(btn.disabled, false)

    handle.unmount()
    home.destroy()
  })
})

describe('E3-11 — Independent bindings remain independent', () => {
  it('changing name does not rerun count getter, and vice versa', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0, name: 'Alice' },
      actions: {
        updateCount(ctx) { ctx.state.count++ },
        updateName(ctx) { ctx.state.name = 'Bob' },
      },
    })

    let countRuns = 0
    let nameRuns = 0

    const CountView = (n: ReactiveNode<{ count: number; name: string }, { updateCount: () => void; updateName: () => void }>): ChildNode =>
      text(() => { countRuns++; return String(n.state.count) })

    const NameView = (n: ReactiveNode<{ count: number; name: string }, { updateCount: () => void; updateName: () => void }>): ChildNode =>
      text(() => { nameRuns++; return n.state.name })

    const App = (n: ReactiveNode<{ count: number; name: string }, { updateCount: () => void; updateName: () => void }>): ChildNode =>
      fragment(CountView(n), NameView(n))

    const host = container()
    const handle = mount(home, App(node), host)

    assert.equal(countRuns, 1)
    assert.equal(nameRuns, 1)

    node.actions.updateCount()
    await home.flush()

    assert.equal(countRuns, 2)
    assert.equal(nameRuns, 1)

    node.actions.updateName()
    await home.flush()

    assert.equal(countRuns, 2)
    assert.equal(nameRuns, 2)

    handle.unmount()
    home.destroy()
  })
})

describe('E3-12 — View functions themselves are not rerun by reactive state changes', () => {
  it('View function executes once during mount, not on every state change', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    let viewRuns = 0

    const Counter = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode => {
      viewRuns++
      return text(() => String(n.state.count))
    }

    const host = container()
    const handle = mount(home, Counter(node), host)

    assert.equal(viewRuns, 1)

    node.actions.increment()
    await home.flush()

    assert.equal(viewRuns, 1)
    assert.equal(host.textContent, '1')

    node.actions.increment()
    await home.flush()

    assert.equal(viewRuns, 1)
    assert.equal(host.textContent, '2')

    handle.unmount()
    home.destroy()
  })
})

describe('E3-13 — Event handlers inside composed Views still execute Kin Actions', () => {
  it('event handler in composed View invokes the Action', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const Counter = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('button', { onClick: handler(() => n.actions.increment()) }, text(() => String(n.state.count)))

    const host = container()
    const handle = mount(home, Counter(node), host)

    const btn = host.firstChild as HTMLButtonElement
    click(btn)
    await home.flush()

    assert.equal(btn.textContent, '1')

    handle.unmount()
    home.destroy()
  })
})

describe('E3-14 — Unmounting a composed View cleans up all nested bindings/listeners', () => {
  it('unmount removes all subscriptions and event listeners', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0, label: 'Go' },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    let countRuns = 0
    let labelRuns = 0
    let clickRuns = 0

    const Counter = (n: ReactiveNode<{ count: number; label: string }, { increment: () => void }>): ChildNode =>
      element('button',
        { onClick: handler(() => { clickRuns++; n.actions.increment() }) },
        text(() => { countRuns++; return String(n.state.count) })
      )

    const Label = (n: ReactiveNode<{ count: number; label: string }, { increment: () => void }>): ChildNode =>
      text(() => { labelRuns++; return n.state.label })

    const App = (n: ReactiveNode<{ count: number; label: string }, { increment: () => void }>): ChildNode =>
      fragment(Counter(n), Label(n))

    const host = container()
    const handle = mount(home, App(node), host)

    assert.equal(countRuns, 1)
    assert.equal(labelRuns, 1)

    const btn = host.firstChild as HTMLButtonElement
    handle.unmount()

    click(btn)
    await home.flush()

    assert.equal(clickRuns, 0)
    assert.equal(countRuns, 1)
    assert.equal(labelRuns, 1)

    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E3-15 through E3-17 — No duplicate subscriptions or DOM nodes
// ---------------------------------------------------------------------------

describe('E3-15 — No duplicate subscriptions from composition', () => {
  it('composing the same View multiple times does not create duplicate subscriptions', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    let runs = 0

    const Counter = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      text(() => { runs++; return String(n.state.count) })

    const App = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      fragment(Counter(n), Counter(n))

    const host = container()
    const handle = mount(home, App(node), host)

    assert.equal(runs, 2) // Two independent counters

    node.actions.increment()
    await home.flush()

    assert.equal(runs, 4) // Each counter runs once

    handle.unmount()
    home.destroy()
  })
})

describe('E3-16 — No duplicate DOM nodes', () => {
  it('composition creates exactly the expected DOM structure', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: {},
    })

    const Header: View = () => element('header', {}, text('H'))
    const Footer: View = () => element('footer', {}, text('F'))

    const App = (n: ReactiveNode<{ count: number }, {}>): ChildNode =>
      element('main', {}, Header(), text(() => String(n.state.count)), Footer())

    const host = container()
    const handle = mount(home, App(node), host)

    assert.equal(host.childNodes.length, 1)
    const main = host.firstChild as HTMLElement
    assert.equal(main.tagName, 'MAIN')
    assert.equal(main.childNodes.length, 3)

    handle.unmount()
    home.destroy()
  })
})

describe('E3-17 — Composition does not introduce a second state system', () => {
  it('state mutations still go through Actions only', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const Counter = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      text(() => String(n.state.count))

    const host = container()
    const handle = mount(home, Counter(node), host)

    // Direct state mutation should still be blocked
    assert.throws(() => {
      ;(node.state as { count: number }).count = 5
    }, TypeError)

    // Only Actions should work
    node.actions.increment()
    await home.flush()
    assert.equal(host.textContent, '1')

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E3-18 through E3-20 — Authorization boundary
// ---------------------------------------------------------------------------

describe('E3-18 — AuthorizedView boundaries remain intact', () => {
  it('View receiving AuthorizedView can only access authorized fields', async () => {
    const home = createReactiveHome()
    const source = home.node({ state: {}, actions: {} })
    const target = home.node({
      state: { balance: 100, secret: 'nope' },
      actions: {},
    })
    const rel = home.relationship(source, target)
    const grant = rel.grant(capability(['balance']))

    let view!: AuthorizedView<{ balance: number; secret: string }>
    home.subscribeAs(source, target, grant, (v) => {
      view = v as AuthorizedView<{ balance: number; secret: string }>
    })

    const BalanceView = (v: AuthorizedView<{ balance: number; secret: string }>): ChildNode =>
      text(() => String(v.state.balance))

    const host = container()
    const handle = mount(home, BalanceView(view), host)

    assert.equal(host.textContent, '100')

    // View cannot access actions
    assert.equal('actions' in view, false)

    handle.unmount()
    home.destroy()
  })
})

describe('E3-19 — Composition cannot bypass authorization', () => {
  it('attempting to access denied field through composed View throws', () => {
    const home = createReactiveHome()
    const source = home.node({ state: {}, actions: {} })
    const target = home.node({
      state: { balance: 100, secret: 'nope' },
      actions: {},
    })
    const rel = home.relationship(source, target)
    const grant = rel.grant(capability(['balance']))

    let view!: AuthorizedView<{ balance: number; secret: string }>
    home.subscribeAs(source, target, grant, (v) => {
      view = v as AuthorizedView<{ balance: number; secret: string }>
    })

    const SecretView = (v: AuthorizedView<{ balance: number; secret: string }>): ChildNode =>
      text(() => v.state.secret)

    const host = container()
    assert.throws(
      () => mount(home, SecretView(view), host),
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED',
    )

    home.destroy()
  })
})

describe('E3-20 — View does not expose underlying Node, grant, or relationship', () => {
  it('AuthorizedView does not leak internal references', async () => {
    const home = createReactiveHome()
    const source = home.node({ state: {}, actions: {} })
    const target = home.node({
      state: { balance: 100 },
      actions: {},
    })
    const rel = home.relationship(source, target)
    const grant = rel.grant(capability(['balance']))

    let view!: AuthorizedView<{ balance: number }>
    home.subscribeAs(source, target, grant, (v) => {
      view = v as AuthorizedView<{ balance: number }>
    })

    const BalanceView = (v: AuthorizedView<{ balance: number }>): ChildNode =>
      text(() => String(v.state.balance))

    const host = container()
    const handle = mount(home, BalanceView(view), host)

    // Verify no internal symbols or references are exposed
    assert.equal('actions' in view, false)
    assert.equal('destroy' in view, false)
    assert.equal('isParent' in view, false)
    assert.equal('isChild' in view, false)

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E3-21 — Integration test: realistic composition example
// ---------------------------------------------------------------------------

describe('E3-21 — Integration test: realistic composition example', () => {
  it('Header, Counter, Footer composition mounts and updates correctly', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const Header: View = () => element('header', {}, text('Kin'))

    const Counter = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('button', { onClick: handler(() => n.actions.increment()) }, text(() => String(n.state.count)))

    const Footer: View = () => element('footer', {}, text('Footer'))

    const App = (n: ReactiveNode<{ count: number }, { increment: () => void }>): ChildNode =>
      element('main', {}, Header(), Counter(n), Footer())

    const host = container()
    const handle = mount(home, App(node), host)

    // Verify initial DOM
    const main = host.firstChild as HTMLElement
    assert.equal(main.tagName, 'MAIN')
    assert.equal(main.childNodes.length, 3)

    const header = main.childNodes[0] as HTMLElement
    assert.equal(header.tagName, 'HEADER')
    assert.equal(header.textContent, 'Kin')

    const button = main.childNodes[1] as HTMLButtonElement
    assert.equal(button.tagName, 'BUTTON')
    assert.equal(button.textContent, '0')

    const footer = main.childNodes[2] as HTMLElement
    assert.equal(footer.tagName, 'FOOTER')
    assert.equal(footer.textContent, 'Footer')

    // Click counter and verify update
    click(button)
    await home.flush()
    assert.equal(button.textContent, '1')

    // Verify Header and Footer DOM nodes remain stable
    assert.equal(main.childNodes[0], header)
    assert.equal(main.childNodes[2], footer)

    // Verify View functions were not rerun
    const headerText = header.textContent
    const footerText = footer.textContent
    assert.equal(headerText, 'Kin')
    assert.equal(footerText, 'Footer')

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// E3-22 — No component abstraction introduced
// ---------------------------------------------------------------------------

describe('E3-22 — No component abstraction introduced', () => {
  it('Views are plain functions, not component instances', () => {
    const MyView: View = () => text('Hello')

    // Verify it's a plain function
    assert.equal(typeof MyView, 'function')

    // Verify it has no component-like properties on the function itself
    assert.equal(Object.prototype.hasOwnProperty.call(MyView, 'state'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(MyView, 'props'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(MyView, 'key'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(MyView, 'ref'), false)
  })

  it('composed View tree has no component instances', () => {
    const A: View = () => text('A')
    const B: View = () => text('B')
    const Combined: View = () => fragment(A(), B())

    const descriptor = Combined()

    // Verify descriptor has no component metadata
    assert.equal('component' in descriptor, false)
    assert.equal('instance' in descriptor, false)
    assert.equal('key' in descriptor, false)
  })
})
