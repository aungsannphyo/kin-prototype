/**
 * Element Overload Test Suite
 *
 * Verifies optional props on element() and seamless developer experience:
 * 1. no props: element(tag)
 * 2. props: element(tag, props), element(tag, {})
 * 3. one child: element(tag, child) without props vs with props
 * 4. multiple children: element(tag, child1, child2, child3) without props
 * 5. reactive children: element(tag, text(() => ...)) updates in DOM
 * 6. event handlers: element(tag, { onClick: handler(...) }, ...) attaches listeners
 * 7. fragments: element(tag, fragment(...)) without props
 * 8. conditional nodes: element(tag, when(...)) without props
 * 9. nested elements: deeply nested element(...) calls with and without props
 * 10. disambiguation: props like { type: 'text' } or { type: 'text', value: 'x' } are NEVER children
 * 11. reactive props: element(tag, { prop: () => ... }, ...) updates attribute reactively
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

import {
  createReactiveHome,
  element,
  text,
  fragment,
  when,
  handler,
  mount,
  isChildNode,
  CHILD_NODE_BRAND,
  type ElementNode,
  type TextNode,
  type FragmentNode,
} from '../src/index.js'

describe('element() API optional props & overloads', () => {
  let windowRef: Window

  before(() => {
    windowRef = new Window({ url: 'http://localhost:5173/' })
    const globals = {
      document: windowRef.document,
      Event: windowRef.Event,
      MouseEvent: windowRef.MouseEvent,
      Node: windowRef.Node,
      HTMLElement: windowRef.HTMLElement,
      HTMLInputElement: windowRef.HTMLInputElement,
      HTMLButtonElement: windowRef.HTMLButtonElement,
      Text: windowRef.Text,
      Comment: windowRef.Comment,
    }
    Object.assign(globalThis, globals)
  })

  after(() => {
    windowRef.close()
  })

  // 1. no props
  it('1. no props: element(tag) creates element with empty props and empty children', () => {
    const hr = element('hr')
    assert.equal(hr.type, 'element')
    assert.equal(hr.tag, 'hr')
    assert.deepEqual(hr.props, {})
    assert.deepEqual(hr.children, [])
    assert.equal((hr as any)[CHILD_NODE_BRAND], true)

    const div = element('div')
    assert.equal(div.type, 'element')
    assert.equal(div.tag, 'div')
    assert.deepEqual(div.props, {})
    assert.deepEqual(div.children, [])
  })

  // 2. props
  it('2. props: element(tag, props) and element(tag, {}) preserve props', () => {
    const empty = element('div', {})
    assert.equal(empty.type, 'element')
    assert.deepEqual(empty.props, {})
    assert.deepEqual(empty.children, [])

    const withProps = element('div', { id: 'header', class: 'main-header', 'data-role': 'banner' })
    assert.equal(withProps.type, 'element')
    assert.equal(withProps.props['id'], 'header')
    assert.equal(withProps.props['class'], 'main-header')
    assert.equal(withProps.props['data-role'], 'banner')
    assert.deepEqual(withProps.children, [])
  })

  // 3. one child
  it('3. one child: element(tag, child) without props vs element(tag, props, child)', () => {
    const t = text('Hello World')

    // Without props:
    const nodeNoProps = element('div', t)
    assert.equal(nodeNoProps.type, 'element')
    assert.equal(nodeNoProps.tag, 'div')
    assert.deepEqual(nodeNoProps.props, {})
    assert.equal(nodeNoProps.children.length, 1)
    assert.equal(nodeNoProps.children[0], t)

    // With props:
    const nodeWithProps = element('div', { class: 'card' }, t)
    assert.equal(nodeWithProps.type, 'element')
    assert.equal(nodeWithProps.tag, 'div')
    assert.equal(nodeWithProps.props['class'], 'card')
    assert.equal(nodeWithProps.children.length, 1)
    assert.equal(nodeWithProps.children[0], t)
  })

  // 4. multiple children
  it('4. multiple children: element(tag, ...children) without props', () => {
    const a = text('Item 1')
    const b = text('Item 2')
    const c = text('Item 3')

    // Without props:
    const list = element('ul', a, b, c)
    assert.equal(list.type, 'element')
    assert.equal(list.tag, 'ul')
    assert.deepEqual(list.props, {})
    assert.equal(list.children.length, 3)
    assert.equal(list.children[0], a)
    assert.equal(list.children[1], b)
    assert.equal(list.children[2], c)

    // With props:
    const listWithProps = element('ul', { class: 'nav-list' }, a, b, c)
    assert.equal(listWithProps.props['class'], 'nav-list')
    assert.equal(listWithProps.children.length, 3)
  })

  // 5. reactive children
  it('5. reactive children: element(tag, text(() => ...)) mounts and updates reactively', async () => {
    const home = createReactiveHome()
    const counter = home.node({
      state: { count: 0 },
      actions: {
        increment(ctx) {
          ctx.state.count++
        },
      },
    })

    const container = windowRef.document.createElement('div')
    windowRef.document.body.appendChild(container)

    // Using element('div', text(...)) with NO props
    const handle = mount(
      home,
      () =>
        element('div',
          element('span', text(() => `Count: ${counter.state.count}`))
        ),
      container as unknown as ParentNode
    )

    assert.equal(container.textContent, 'Count: 0')

    counter.actions.increment()
    await home.flush()
    assert.equal(container.textContent, 'Count: 1')

    counter.actions.increment()
    await home.flush()
    assert.equal(container.textContent, 'Count: 2')

    handle.unmount()
    home.destroy()
    windowRef.document.body.removeChild(container)
  })

  // 6. event handlers
  it('6. event handlers: element with props and event handlers fires actions on click', async () => {
    const home = createReactiveHome()
    const counter = home.node({
      state: { count: 10 },
      actions: {
        increment(ctx) {
          ctx.state.count++
        },
      },
    })

    const container = windowRef.document.createElement('div')
    windowRef.document.body.appendChild(container)

    const handle = mount(
      home,
      () =>
        element('div',
          element(
            'button',
            {
              id: 'btn-inc',
              onClick: handler(() => counter.actions.increment()),
            },
            text('+')
          ),
          element('span', { id: 'display' }, text(() => String(counter.state.count)))
        ),
      container as unknown as ParentNode
    )

    const button = container.querySelector('#btn-inc') as unknown as HTMLElement
    const display = container.querySelector('#display') as unknown as HTMLElement

    assert.equal(display.textContent, '10')

    button.click()
    await home.flush()
    assert.equal(display.textContent, '11')

    handle.unmount()
    home.destroy()
    windowRef.document.body.removeChild(container)
  })

  // 7. fragments
  it('7. fragments: element(tag, fragment(...)) without props groups siblings', () => {
    const f = fragment(text('Alpha'), text('Beta'))
    const el = element('div', f)

    assert.equal(el.children.length, 1)
    const fragChild = el.children[0] as FragmentNode
    assert.equal(fragChild.type, 'fragment')
    assert.equal(fragChild.children.length, 2)
  })

  // 8. conditional nodes
  it('8. conditional nodes: element(tag, when(...)) without props toggles in DOM', async () => {
    const home = createReactiveHome()
    const toggle = home.node({
      state: { visible: true },
      actions: {
        set(ctx, v: boolean) {
          ctx.state.visible = v
        },
      },
    })

    const container = windowRef.document.createElement('div')
    windowRef.document.body.appendChild(container)

    const handle = mount(
      home,
      () =>
        element('div',
          when(
            () => toggle.state.visible,
            element('p', text('Now Visible')),
            element('p', text('Now Hidden'))
          )
        ),
      container as unknown as ParentNode
    )

    assert.equal(container.textContent, 'Now Visible')

    toggle.actions.set(false)
    await home.flush()
    assert.equal(container.textContent, 'Now Hidden')

    handle.unmount()
    home.destroy()
    windowRef.document.body.removeChild(container)
  })

  // 9. nested elements
  it('9. nested elements: deeply nested element(...) calls without props', () => {
    const tree = element(
      'main',
      element(
        'section',
        element('header', element('h1', text('Page Title'))),
        element('article', element('p', text('First Paragraph')), element('p', text('Second Paragraph')))
      )
    )

    assert.equal(tree.type, 'element')
    assert.equal(tree.tag, 'main')
    assert.deepEqual(tree.props, {})
    assert.equal(tree.children.length, 1)

    const section = tree.children[0] as ElementNode
    assert.equal(section.tag, 'section')
    assert.deepEqual(section.props, {})
    assert.equal(section.children.length, 2)

    const header = section.children[0] as ElementNode
    assert.equal(header.tag, 'header')
    const h1 = header.children[0] as ElementNode
    assert.equal(h1.tag, 'h1')
    assert.equal((h1.children[0] as TextNode).value, 'Page Title')

    const article = section.children[1] as ElementNode
    assert.equal(article.tag, 'article')
    assert.equal(article.children.length, 2)
  })

  // 10. disambiguation: props must not accidentally be interpreted as children
  it('10. disambiguation: props like { type: "text" } or { type: "text", value: "x" } are NEVER treated as children', () => {
    // 10a. input with type: 'text' (zero children)
    const input1 = element('input', { type: 'text' })
    assert.equal(input1.type, 'element')
    assert.equal(input1.tag, 'input')
    assert.equal(input1.props['type'], 'text')
    assert.deepEqual(input1.children, [])

    // 10b. input with type: 'text' and value: 'search'
    const input2 = element('input', { type: 'text', value: 'search' })
    assert.equal(input2.props['type'], 'text')
    assert.equal(input2.props['value'], 'search')
    assert.deepEqual(input2.children, [])

    // 10c. input with type: 'text' and placeholder
    const input3 = element('input', {
      type: 'text',
      placeholder: 'Enter name',
      class: 'form-input',
    })
    assert.equal(input3.props['type'], 'text')
    assert.equal(input3.props['placeholder'], 'Enter name')
    assert.equal(input3.props['class'], 'form-input')
    assert.deepEqual(input3.children, [])

    // 10d. div with type property in props
    const divCustom = element('div', { type: 'custom-card', role: 'region' })
    assert.equal(divCustom.props['type'], 'custom-card')
    assert.equal(divCustom.props['role'], 'region')
    assert.deepEqual(divCustom.children, [])

    // 10e. input with type: 'text' followed by actual child text
    const inputWithChild = element('label', { type: 'label-prop' }, text('Label Text'))
    assert.equal(inputWithChild.props['type'], 'label-prop')
    assert.equal(inputWithChild.children.length, 1)
    assert.equal((inputWithChild.children[0] as TextNode).value, 'Label Text')
  })

  // 11. reactive props
  it('11. reactive props: element(tag, { prop: () => ... }, ...) updates attribute reactively', async () => {
    const home = createReactiveHome()
    const theme = home.node({
      state: { dark: false },
      actions: {
        toggle(ctx) {
          ctx.state.dark = !ctx.state.dark
        },
      },
    })

    const container = windowRef.document.createElement('div')
    windowRef.document.body.appendChild(container)

    const handle = mount(
      home,
      () =>
        element(
          'div',
          {
            id: 'themed-box',
            class: () => (theme.state.dark ? 'dark-mode' : 'light-mode'),
          },
          text('Theme Content')
        ),
      container as unknown as ParentNode
    )

    const box = container.querySelector('#themed-box') as unknown as HTMLElement
    assert.equal(box.className, 'light-mode')

    theme.actions.toggle()
    await home.flush()
    assert.equal(box.className, 'dark-mode')

    theme.actions.toggle()
    await home.flush()
    assert.equal(box.className, 'light-mode')

    handle.unmount()
    home.destroy()
    windowRef.document.body.removeChild(container)
  })

  // 12. isChildNode guard
  it('12. isChildNode: correctly discriminates between ChildNodes and non-ChildNodes', () => {
    assert.equal(isChildNode(element('div')), true)
    assert.equal(isChildNode(text('hello')), true)
    assert.equal(isChildNode(fragment()), true)
    assert.equal(isChildNode(when(() => true, text('y'))), true)

    assert.equal(isChildNode(null), false)
    assert.equal(isChildNode(undefined), false)
    assert.equal(isChildNode('string'), false)
    assert.equal(isChildNode(42), false)
    assert.equal(isChildNode({}), false)
    assert.equal(isChildNode({ class: 'card' }), false)
    assert.equal(isChildNode({ type: 'text' }), false)
    assert.equal(isChildNode({ type: 'text', value: 'x' }), false) // plain object without brand
    assert.equal(isChildNode(handler(() => {})), false)
  })
})
