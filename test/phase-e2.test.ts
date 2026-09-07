/**
 * Phase E.2 — DOM renderer + fine-grained reactive bindings
 *
 * Uses happy-dom as a minimal Document implementation so tests can run in Node.
 * The renderer itself depends only on standard DOM APIs (document, Element, Text).
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

import { createReactiveHome, capability, KinAuthError } from '../src/index.js'
import {
  element,
  text,
  fragment,
  when,
  handler,
  isEventHandler,
} from '../src/view/index.js'
import { mount } from '../src/dom/index.js'

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

/** Walk the prototype chain for an accessor so spies work under happy-dom. */
function findAccessor(obj: object, prop: string): PropertyDescriptor | undefined {
  let current: object | null = obj
  while (current !== null) {
    const desc = Object.getOwnPropertyDescriptor(current, prop)
    if (desc !== undefined && (desc.get !== undefined || desc.set !== undefined)) {
      return desc
    }
    current = Object.getPrototypeOf(current) as object | null
  }
  return undefined
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
// Static rendering
// ---------------------------------------------------------------------------

describe('E2 — static element creation', () => {
  it('creates an element with the given tag', () => {
    const home = createReactiveHome()
    const host = container()
    const handle = mount(home, element('div', { id: 'root' }), host)

    assert.equal(host.childNodes.length, 1)
    const el = host.firstChild as HTMLElement
    assert.equal(el.tagName, 'DIV')
    assert.equal(el.getAttribute('id'), 'root')

    handle.unmount()
    home.destroy()
  })

  it('renders button and span tags', () => {
    const home = createReactiveHome()
    const host = container()
    const handle = mount(
      home,
      fragment(
        element('button', {}, text('Go')),
        element('span', { title: 'hint' }, text('Hi')),
      ),
      host,
    )

    assert.equal((host.childNodes[0] as HTMLElement).tagName, 'BUTTON')
    assert.equal((host.childNodes[1] as HTMLElement).tagName, 'SPAN')
    assert.equal((host.childNodes[1] as HTMLElement).getAttribute('title'), 'hint')

    handle.unmount()
    home.destroy()
  })
})

describe('E2 — static text', () => {
  it('renders a text node', () => {
    const home = createReactiveHome()
    const host = container()
    const handle = mount(home, text('hello'), host)

    assert.equal(host.childNodes.length, 1)
    assert.equal(host.firstChild?.nodeType, 3)
    assert.equal(host.firstChild?.textContent, 'hello')

    handle.unmount()
    home.destroy()
  })
})

describe('E2 — nested elements', () => {
  it('nests children inside the parent element', () => {
    const home = createReactiveHome()
    const host = container()
    const handle = mount(
      home,
      element('div', {}, element('span', {}, text('inner'))),
      host,
    )

    const div = host.firstChild as HTMLElement
    assert.equal(div.tagName, 'DIV')
    assert.equal((div.firstChild as HTMLElement).tagName, 'SPAN')
    assert.equal(div.firstChild?.textContent, 'inner')

    handle.unmount()
    home.destroy()
  })
})

describe('E2 — fragments', () => {
  it('does not create a wrapper element', () => {
    const home = createReactiveHome()
    const host = container()
    const handle = mount(
      home,
      fragment(text('A'), text('B'), element('span', {}, text('C'))),
      host,
    )

    assert.equal(host.childNodes.length, 3)
    assert.equal(host.childNodes[0]?.textContent, 'A')
    assert.equal(host.childNodes[1]?.textContent, 'B')
    assert.equal((host.childNodes[2] as HTMLElement).tagName, 'SPAN')
    assert.equal(host.childNodes[2]?.textContent, 'C')

    handle.unmount()
    home.destroy()
  })

  it('empty fragment inserts no nodes', () => {
    const home = createReactiveHome()
    const host = container()
    const handle = mount(home, fragment(), host)
    assert.equal(host.childNodes.length, 0)
    handle.unmount()
    home.destroy()
  })

  it('unmount removes fragment children', () => {
    const home = createReactiveHome()
    const host = container()
    const handle = mount(home, fragment(text('A'), text('B')), host)
    handle.unmount()
    assert.equal(host.childNodes.length, 0)
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Reactive text
// ---------------------------------------------------------------------------

describe('E2 — reactive text', () => {
  it('renders the initial getter value', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })
    const host = container()
    const handle = mount(home, text(() => String(node.state.count)), host)

    assert.equal(host.textContent, '0')
    handle.unmount()
    home.destroy()
  })

  it('updates after an Action and flush', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })
    const host = container()
    const handle = mount(
      home,
      element('div', {}, text(() => String(node.state.count))),
      host,
    )

    node.actions.increment()
    await home.flush()
    assert.equal(host.textContent, '1')

    handle.unmount()
    home.destroy()
  })

  it('does not recreate the text node on update', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })
    const host = container()
    const handle = mount(home, text(() => String(node.state.count)), host)
    const original = host.firstChild

    node.actions.increment()
    await home.flush()

    assert.equal(host.firstChild, original)
    assert.equal(host.textContent, '1')
    handle.unmount()
    home.destroy()
  })
})

describe('E2 — fine-grained text bindings (critical)', () => {
  it('count update does not execute the name getter, and vice versa', async () => {
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

    const host = container()
    const handle = mount(
      home,
      fragment(
        text(() => {
          countRuns++
          return String(node.state.count)
        }),
        text(() => {
          nameRuns++
          return node.state.name
        }),
      ),
      host,
    )

    assert.equal(countRuns, 1)
    assert.equal(nameRuns, 1)
    assert.equal(host.childNodes[0]?.textContent, '0')
    assert.equal(host.childNodes[1]?.textContent, 'Alice')

    node.actions.updateCount()
    await home.flush()

    assert.equal(countRuns, 2)
    assert.equal(nameRuns, 1)
    assert.equal(host.childNodes[0]?.textContent, '1')
    assert.equal(host.childNodes[1]?.textContent, 'Alice')

    node.actions.updateName()
    await home.flush()

    assert.equal(countRuns, 2)
    assert.equal(nameRuns, 2)
    assert.equal(host.childNodes[1]?.textContent, 'Bob')

    handle.unmount()
    home.destroy()
  })

  it('skips a text DOM write when the computed string is unchanged', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 2 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    const host = container()
    const handle = mount(
      home,
      text(() => (node.state.count > 0 ? 'yes' : 'no')),
      host,
    )

    const tn = host.firstChild as Text
    let dataWrites = 0
    const original = findAccessor(tn, 'data') ?? findAccessor(tn, 'nodeValue')
    assert.ok(original?.set, 'expected a data/nodeValue setter to spy on')
    const prop = findAccessor(tn, 'data') !== undefined ? 'data' : 'nodeValue'
    Object.defineProperty(tn, prop, {
      configurable: true,
      get() {
        return original.get?.call(this) as string
      },
      set(v: string) {
        dataWrites++
        original.set?.call(this, v)
      },
    })

    node.actions.increment()
    await home.flush()

    assert.equal(host.textContent, 'yes')
    assert.equal(dataWrites, 0)

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Reactive props
// ---------------------------------------------------------------------------

describe('E2 — reactive props', () => {
  it('applies the initial getter value', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { loading: true },
      actions: { stop(ctx) { ctx.state.loading = false } },
    })
    const host = container()
    const handle = mount(
      home,
      element('button', { disabled: () => node.state.loading }, text('Go')),
      host,
    )

    const btn = host.firstChild as HTMLButtonElement
    assert.equal(btn.disabled, true)

    handle.unmount()
    home.destroy()
  })

  it('updates the property after an Action', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { loading: true },
      actions: { stop(ctx) { ctx.state.loading = false } },
    })
    const host = container()
    const handle = mount(
      home,
      element('button', { disabled: () => node.state.loading }, text('Go')),
      host,
    )

    node.actions.stop()
    await home.flush()

    const btn = host.firstChild as HTMLButtonElement
    assert.equal(btn.disabled, false)

    handle.unmount()
    home.destroy()
  })

  it('unrelated fields do not re-run the prop getter', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { loading: true, label: 'Go' },
      actions: {
        stop(ctx) { ctx.state.loading = false },
        relabel(ctx) { ctx.state.label = 'Wait' },
      },
    })

    let disabledRuns = 0
    const host = container()
    const handle = mount(
      home,
      element(
        'button',
        {
          disabled: () => {
            disabledRuns++
            return node.state.loading
          },
        },
        text(() => node.state.label),
      ),
      host,
    )

    assert.equal(disabledRuns, 1)
    node.actions.relabel()
    await home.flush()
    assert.equal(disabledRuns, 1)

    node.actions.stop()
    await home.flush()
    assert.equal(disabledRuns, 2)

    handle.unmount()
    home.destroy()
  })

  it('does not rewrite a boolean property when the getter result is unchanged', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { n: 2 },
      actions: { inc(ctx) { ctx.state.n++ } },
    })

    const host = container()
    const handle = mount(
      home,
      element('button', { disabled: () => node.state.n > 0 }, text('x')),
      host,
    )

    const btn = host.firstChild as HTMLButtonElement
    let writes = 0
    const desc = findAccessor(btn, 'disabled')
    assert.ok(desc?.set, 'expected a disabled setter to spy on')
    Object.defineProperty(btn, 'disabled', {
      configurable: true,
      get() {
        return desc.get?.call(this) as boolean
      },
      set(v: boolean) {
        writes++
        desc.set?.call(this, v)
      },
    })

    node.actions.inc()
    await home.flush()
    assert.equal(writes, 0)

    handle.unmount()
    home.destroy()
  })
})

describe('E2 — static props mapping', () => {
  it('maps class to className', () => {
    const home = createReactiveHome()
    const host = container()
    const handle = mount(home, element('div', { class: 'box' }), host)
    assert.equal((host.firstChild as HTMLElement).className, 'box')
    handle.unmount()
    home.destroy()
  })

  it('sets id as an attribute', () => {
    const home = createReactiveHome()
    const host = container()
    const handle = mount(home, element('div', { id: 'a' }), host)
    assert.equal((host.firstChild as HTMLElement).id, 'a')
    handle.unmount()
    home.destroy()
  })

  it('removes an attribute when the value is null', () => {
    const home = createReactiveHome()
    const host = container()
    const handle = mount(home, element('div', { title: null }), host)
    assert.equal((host.firstChild as HTMLElement).hasAttribute('title'), false)
    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe('E2 — event handlers', () => {
  it('attaches a branded handler and invokes an Action on click', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })
    const host = container()
    const h = handler(() => { node.actions.increment() })
    assert.equal(isEventHandler(h), true)

    const handle = mount(
      home,
      element(
        'button',
        { onClick: h },
        text(() => String(node.state.count)),
      ),
      host,
    )

    const btn = host.firstChild as HTMLButtonElement
    click(btn)
    await home.flush()
    assert.equal(btn.textContent, '1')

    handle.unmount()
    home.destroy()
  })

  it('does not treat a plain getter named onClick as a listener', () => {
    const home = createReactiveHome()
    const host = container()
    const handle = mount(
      home,
      element('button', { onClick: () => 'not-a-handler' as unknown as boolean }),
      host,
    )

    const btn = host.firstChild as HTMLButtonElement
    click(btn)
    handle.unmount()
    home.destroy()
  })

  it('removes the listener on unmount', () => {
    const home = createReactiveHome()
    let calls = 0
    const host = container()
    const handle = mount(
      home,
      element('button', { onClick: handler(() => { calls++ }) }, text('x')),
      host,
    )

    const btn = host.firstChild as HTMLButtonElement
    handle.unmount()
    click(btn)
    assert.equal(calls, 0)
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Conditional
// ---------------------------------------------------------------------------

describe('E2 — conditional rendering', () => {
  it('mounts the then branch when the condition is initially true', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { loggedIn: true },
      actions: { logout(ctx) { ctx.state.loggedIn = false } },
    })
    const host = container()
    const handle = mount(
      home,
      when(
        () => node.state.loggedIn,
        element('div', { id: 'in' }, text('Logged in')),
        element('div', { id: 'out' }, text('Logged out')),
      ),
      host,
    )

    assert.equal(host.querySelector('#in')?.textContent, 'Logged in')
    assert.equal(host.querySelector('#out'), null)

    handle.unmount()
    home.destroy()
  })

  it('mounts the otherwise branch when initially false', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { loggedIn: false },
      actions: { login(ctx) { ctx.state.loggedIn = true } },
    })
    const host = container()
    const handle = mount(
      home,
      when(
        () => node.state.loggedIn,
        element('div', { id: 'in' }, text('Logged in')),
        element('div', { id: 'out' }, text('Logged out')),
      ),
      host,
    )

    assert.equal(host.querySelector('#out')?.textContent, 'Logged out')
    assert.equal(host.querySelector('#in'), null)

    handle.unmount()
    home.destroy()
  })

  it('switches true → false and false → true without rerendering siblings', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { loggedIn: true, label: 'keep' },
      actions: {
        logout(ctx) { ctx.state.loggedIn = false },
        login(ctx) { ctx.state.loggedIn = true },
      },
    })

    let labelRuns = 0
    const host = container()
    const handle = mount(
      home,
      element(
        'div',
        {},
        when(
          () => node.state.loggedIn,
          element('div', { id: 'in' }, text('Logged in')),
          element('div', { id: 'out' }, text('Logged out')),
        ),
        element('button', {}, text(() => {
          labelRuns++
          return node.state.label
        })),
      ),
      host,
    )

    const sibling = host.querySelector('button')
    assert.equal(labelRuns, 1)

    node.actions.logout()
    await home.flush()
    assert.equal(host.querySelector('#in'), null)
    assert.equal(host.querySelector('#out')?.textContent, 'Logged out')
    assert.equal(host.querySelector('button'), sibling)
    assert.equal(labelRuns, 1)

    node.actions.login()
    await home.flush()
    assert.equal(host.querySelector('#in')?.textContent, 'Logged in')
    assert.equal(host.querySelector('#out'), null)
    assert.equal(labelRuns, 1)

    handle.unmount()
    home.destroy()
  })

  it('disposes old-branch subscriptions when switching', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { loggedIn: true, secret: 1, public: 2 },
      actions: {
        logout(ctx) { ctx.state.loggedIn = false },
        bumpSecret(ctx) { ctx.state.secret++ },
      },
    })

    let secretRuns = 0
    const host = container()
    const handle = mount(
      home,
      when(
        () => node.state.loggedIn,
        text(() => {
          secretRuns++
          return String(node.state.secret)
        }),
        text('out'),
      ),
      host,
    )

    assert.equal(secretRuns, 1)
    node.actions.logout()
    await home.flush()
    const afterSwitch = secretRuns

    node.actions.bumpSecret()
    await home.flush()
    assert.equal(secretRuns, afterSwitch)

    handle.unmount()
    home.destroy()
  })

  it('renders nothing when otherwise is omitted and condition is false', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { on: false },
      actions: {},
    })
    const host = container()
    const handle = mount(
      home,
      when(() => node.state.on, text('yes')),
      host,
    )

    assert.equal(host.childNodes.length, 1)
    assert.equal(host.firstChild?.nodeType, 8) // comment anchor

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Unmount
// ---------------------------------------------------------------------------

describe('E2 — unmount', () => {
  it('removes owned DOM and is safe to call twice', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    let runs = 0
    const host = container()
    const handle = mount(
      home,
      element(
        'button',
        { onClick: handler(() => { node.actions.increment() }) },
        text(() => {
          runs++
          return String(node.state.count)
        }),
      ),
      host,
    )

    assert.equal(host.childNodes.length, 1)
    const afterMount = runs

    handle.unmount()
    handle.unmount()
    assert.equal(host.childNodes.length, 0)

    node.actions.increment()
    await home.flush()
    assert.equal(runs, afterMount)

    home.destroy()
  })

  it('does not update DOM after unmount', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })
    const host = container()
    const handle = mount(home, text(() => String(node.state.count)), host)
    handle.unmount()

    node.actions.increment()
    await home.flush()
    assert.equal(host.textContent, '')

    home.destroy()
  })
})

describe('E2 — View definition is invoked once', () => {
  it('does not re-run the View function on state change', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 0 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })

    let defs = 0
    const host = container()
    const handle = mount(
      home,
      () => {
        defs++
        return text(() => String(node.state.count))
      },
      host,
    )

    assert.equal(defs, 1)
    node.actions.increment()
    await home.flush()
    assert.equal(defs, 1)
    assert.equal(host.textContent, '1')

    handle.unmount()
    home.destroy()
  })
})

// ---------------------------------------------------------------------------
// Lifecycle — Node / Grant / Relationship
// ---------------------------------------------------------------------------

describe('E2 — Node destroy does not unmount DOM', () => {
  it('leaves last DOM state in place after node.destroy()', async () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { count: 3 },
      actions: { increment(ctx) { ctx.state.count++ } },
    })
    const host = container()
    const handle = mount(home, text(() => String(node.state.count)), host)

    node.destroy()
    await home.flush()
    assert.equal(host.textContent, '3')

    handle.unmount()
    assert.equal(host.textContent, '')
    home.destroy()
  })
})

describe('E2 — authorization boundary', () => {
  it('renders AuthorizedView fields without exposing actions or internals', async () => {
    const home = createReactiveHome()
    const source = home.node({ state: {}, actions: {} })
    const target = home.node({
      state: { balance: 100, secret: 'nope' },
      actions: { deposit(ctx, n: number) { ctx.state.balance += n } },
    })
    const rel = home.relationship(source, target)
    const grant = rel.grant(capability(['balance']))

    let view!: AuthorizedView<{ balance: number; secret: string }>
    home.subscribeAs(source, target, grant, (v) => {
      view = v as AuthorizedView<{ balance: number; secret: string }>
    })

    assert.equal('actions' in view, false)

    const host = container()
    const handle = mount(
      home,
      text(() => String(view.state.balance)),
      host,
    )
    assert.equal(host.textContent, '100')

    target.actions.deposit(5)
    await home.flush()
    assert.equal(host.textContent, '105')

    handle.unmount()
    home.destroy()
  })

  it('throws FIELD_NOT_GRANTED when a binding reads a denied field', () => {
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

    const host = container()
    assert.throws(
      () => mount(home, text(() => view.state.secret), host),
      (err: unknown) => err instanceof KinAuthError && err.code === 'FIELD_NOT_GRANTED',
    )

    home.destroy()
  })

  it('does not unmount DOM when a Grant is revoked', async () => {
    const home = createReactiveHome()
    const source = home.node({ state: {}, actions: {} })
    const target = home.node({
      state: { balance: 10 },
      actions: { deposit(ctx, n: number) { ctx.state.balance += n } },
    })
    const rel = home.relationship(source, target)
    const grant = rel.grant(capability(['balance']))

    let view!: AuthorizedView<{ balance: number }>
    home.subscribeAs(source, target, grant, (v) => {
      view = v as AuthorizedView<{ balance: number }>
    })

    const host = container()
    const handle = mount(
      home,
      text(() => String(view.state.balance)),
      host,
    )

    grant.revoke()
    await home.flush()
    assert.equal(host.textContent, '10')

    handle.unmount()
    home.destroy()
  })

  it('does not unmount DOM when a Relationship is destroyed', () => {
    const home = createReactiveHome()
    const source = home.node({ state: {}, actions: {} })
    const target = home.node({
      state: { balance: 10 },
      actions: {},
    })
    const rel = home.relationship(source, target)
    const grant = rel.grant(capability(['balance']))

    let view!: AuthorizedView<{ balance: number }>
    home.subscribeAs(source, target, grant, (v) => {
      view = v as AuthorizedView<{ balance: number }>
    })

    const host = container()
    const handle = mount(
      home,
      text(() => String(view.state.balance)),
      host,
    )

    rel.destroy()
    assert.equal(host.textContent, '10')

    handle.unmount()
    home.destroy()
  })
})

describe('E2 — public surface', () => {
  it('does not export RenderRecord from the DOM module', async () => {
    const mod = await import('../src/dom/index.js')
    assert.equal('RenderRecord' in mod, false)
    assert.equal(typeof mod.mount, 'function')
  })
})
