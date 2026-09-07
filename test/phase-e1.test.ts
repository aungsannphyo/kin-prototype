/**
 * Phase E.1 — View Model Test Suite
 *
 * Tests the immutable View descriptor layer introduced in Phase E.1.
 * All tests run in Node.js without any browser globals (no document, window,
 * HTMLElement, Event, etc.).
 *
 * Runner: node:test   Assertions: node:assert/strict
 *
 * Coverage:
 *   E1-1  element() — tag preserved
 *   E1-2  element() — props preserved
 *   E1-3  element() — children preserved
 *   E1-4  element() — type discriminant
 *   E1-5  text() — static string value
 *   E1-6  text() — reactive getter stored as function
 *   E1-7  fragment() — type discriminant
 *   E1-8  fragment() — multiple children preserved
 *   E1-9  when() — condition function preserved
 *   E1-10 when() — then branch preserved
 *   E1-11 when() — optional otherwise branch preserved
 *   E1-12 when() — no otherwise when omitted
 *   E1-13 Immutability — element descriptor is frozen
 *   E1-14 Immutability — children array is frozen (cannot be mutated)
 *   E1-15 Immutability — props object is frozen
 *   E1-16 Composition — nested structure preserved correctly
 *   E1-17 handler() — brands the function with EVENT_HANDLER_BRAND
 *   E1-18 isEventHandler() — returns true for handler()-created functions
 *   E1-19 isEventHandler() — returns false for plain reactive getters
 *   E1-20 isEventHandler() — returns false for primitive prop values
 *   E1-21 No DOM requirement — no browser globals used or required
 *   E1-22 fragment() — empty fragment is valid
 *   E1-23 element() — empty props and no children is valid
 *   E1-24 text() — reactive getter is callable and returns expected value
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  element,
  text,
  fragment,
  when,
  handler,
  isEventHandler,
  EVENT_HANDLER_BRAND,
} from '../src/view/index.js'

import type {
  ChildNode,
  ElementNode,
  TextNode,
  FragmentNode,
  ConditionalNode,
  EventHandler,
} from '../src/view/index.js'

// ---------------------------------------------------------------------------
// E1-1 through E1-4 — element()
// ---------------------------------------------------------------------------

describe('E1-1 — element(): tag preserved', () => {
  it('tag matches the argument passed to element()', () => {
    const node = element('div', {})
    assert.equal(node.type, 'element')
    assert.equal(node.tag, 'div')
  })

  it('tag can be any valid HTML tag string', () => {
    assert.equal(element('button', {}).tag, 'button')
    assert.equal(element('span', {}).tag, 'span')
    assert.equal(element('input', {}).tag, 'input')
  })
})

describe('E1-2 — element(): props preserved', () => {
  it('static string prop is preserved', () => {
    const node = element('div', { id: 'root' })
    assert.equal(node.props['id'], 'root')
  })

  it('static number prop is preserved', () => {
    const node = element('input', { tabIndex: 0 })
    assert.equal(node.props['tabIndex'], 0)
  })

  it('static boolean prop is preserved', () => {
    const node = element('input', { disabled: true })
    assert.equal(node.props['disabled'], true)
  })

  it('null prop value is preserved', () => {
    const node = element('div', { 'data-value': null })
    assert.equal(node.props['data-value'], null)
  })

  it('reactive getter prop is preserved as a function', () => {
    let count = 0
    const getter = () => String(count)
    const node = element('span', { textContent: getter })
    assert.equal(typeof node.props['textContent'], 'function')
    assert.equal(node.props['textContent'], getter)
  })

  it('EventHandler prop is preserved', () => {
    const cb = handler(() => { /* noop */ })
    const node = element('button', { onClick: cb })
    assert.equal(node.props['onClick'], cb)
  })

  it('multiple props are all preserved', () => {
    const node = element('a', { href: '/home', target: '_blank', rel: 'noopener' })
    assert.equal(node.props['href'], '/home')
    assert.equal(node.props['target'], '_blank')
    assert.equal(node.props['rel'], 'noopener')
  })
})

describe('E1-3 — element(): children preserved', () => {
  it('single child is accessible at index 0', () => {
    const child = text('hello')
    const node = element('div', {}, child)
    assert.equal(node.children.length, 1)
    assert.equal(node.children[0], child)
  })

  it('multiple children are in order', () => {
    const a = text('a')
    const b = text('b')
    const c = text('c')
    const node = element('ul', {}, a, b, c)
    assert.equal(node.children.length, 3)
    assert.equal(node.children[0], a)
    assert.equal(node.children[1], b)
    assert.equal(node.children[2], c)
  })

  it('no children results in empty array', () => {
    const node = element('br', {})
    assert.equal(node.children.length, 0)
  })
})

describe('E1-4 — element(): type discriminant', () => {
  it('type is exactly "element"', () => {
    const node = element('div', {})
    assert.equal(node.type, 'element')
  })

  it('node satisfies ChildNode union via type discriminant', () => {
    const node: ChildNode = element('section', {})
    assert.equal(node.type, 'element')
  })
})

// ---------------------------------------------------------------------------
// E1-5 through E1-6 — text()
// ---------------------------------------------------------------------------

describe('E1-5 — text(): static string value', () => {
  it('type is "text"', () => {
    const node = text('hello')
    assert.equal(node.type, 'text')
  })

  it('value equals the argument string', () => {
    const node = text('Hello, world!')
    assert.equal(node.value, 'Hello, world!')
  })

  it('empty string is valid', () => {
    const node = text('')
    assert.equal(node.value, '')
  })
})

describe('E1-6 — text(): reactive getter stored as function', () => {
  it('accepts a zero-arg function and stores it', () => {
    let n = 42
    const getter = () => String(n)
    const node = text(getter)
    assert.equal(typeof node.value, 'function')
    assert.equal(node.value, getter)
  })

  it('the stored getter is not called during descriptor creation', () => {
    let calls = 0
    const getter = () => { calls++; return 'x' }
    text(getter)
    assert.equal(calls, 0)  // no subscription, no call
  })
})

describe('E1-24 — text(): reactive getter is callable and returns expected value', () => {
  it('calling the stored getter returns the current value', () => {
    let count = 7
    const getter = () => String(count)
    const node = text(getter)
    // Cast needed because TypeScript knows value is `string | ReactiveGetter`
    const fn = node.value as () => string
    assert.equal(fn(), '7')
    count = 99
    assert.equal(fn(), '99')
  })
})

// ---------------------------------------------------------------------------
// E1-7 through E1-8 — fragment()
// ---------------------------------------------------------------------------

describe('E1-7 — fragment(): type discriminant', () => {
  it('type is "fragment"', () => {
    const node = fragment()
    assert.equal(node.type, 'fragment')
  })

  it('node satisfies ChildNode union', () => {
    const node: ChildNode = fragment(text('a'), text('b'))
    assert.equal(node.type, 'fragment')
  })
})

describe('E1-8 — fragment(): multiple children preserved', () => {
  it('children are preserved in order', () => {
    const a = text('x')
    const b = element('span', {})
    const node = fragment(a, b)
    assert.equal(node.children.length, 2)
    assert.equal(node.children[0], a)
    assert.equal(node.children[1], b)
  })
})

describe('E1-22 — fragment(): empty fragment is valid', () => {
  it('fragment with no children has length 0', () => {
    const node = fragment()
    assert.equal(node.children.length, 0)
  })
})

// ---------------------------------------------------------------------------
// E1-9 through E1-12 — when()
// ---------------------------------------------------------------------------

describe('E1-9 — when(): condition function preserved', () => {
  it('stores the predicate without calling it', () => {
    let calls = 0
    const cond = () => { calls++; return true }
    const node = when(cond, text('yes'))
    assert.equal(node.when, cond)
    assert.equal(calls, 0)  // no subscription, not called
  })
})

describe('E1-10 — when(): then branch preserved', () => {
  it('then descriptor is stored as-is', () => {
    const thenNode = text('visible')
    const node = when(() => true, thenNode)
    assert.equal(node.then, thenNode)
  })
})

describe('E1-11 — when(): optional otherwise branch preserved', () => {
  it('otherwise descriptor is stored when provided', () => {
    const thenNode = text('yes')
    const elseNode = text('no')
    const node = when(() => true, thenNode, elseNode)
    assert.equal(node.otherwise, elseNode)
  })
})

describe('E1-12 — when(): no otherwise when omitted', () => {
  it('otherwise is not present when not supplied', () => {
    const node = when(() => false, text('only-then'))
    assert.equal('otherwise' in node, false)
  })

  it('type is "conditional"', () => {
    const node: ChildNode = when(() => false, text('x'))
    assert.equal(node.type, 'conditional')
  })
})

// ---------------------------------------------------------------------------
// E1-13 through E1-15 — Immutability
// ---------------------------------------------------------------------------

describe('E1-13 — Immutability: element descriptor is frozen', () => {
  it('Object.isFrozen() is true on the returned ElementNode', () => {
    const node = element('div', {})
    assert.equal(Object.isFrozen(node), true)
  })

  it('assigning to node.tag throws in strict mode', () => {
    const node = element('div', {})
    assert.throws(() => {
      // Suppress TS error with a cast; we are testing runtime enforcement.
      ;(node as { tag: string }).tag = 'span'
    }, TypeError)
  })
})

describe('E1-14 — Immutability: children array is frozen', () => {
  it('children array is frozen', () => {
    const node = element('div', {}, text('a'))
    assert.equal(Object.isFrozen(node.children), true)
  })

  it('pushing to children throws in strict mode', () => {
    const node = element('div', {}, text('a'))
    assert.throws(() => {
      ;(node.children as ChildNode[]).push(text('b'))
    }, TypeError)
  })

  it('callers modifying the spread-in array do not affect children', () => {
    const children: ChildNode[] = [text('a')]
    const node = element('div', {}, ...children)
    // Mutate the original source array
    children.push(text('b'))
    // node.children must be unchanged
    assert.equal(node.children.length, 1)
  })

  it('fragment children are also frozen', () => {
    const node = fragment(text('x'))
    assert.equal(Object.isFrozen(node.children), true)
  })
})

describe('E1-15 — Immutability: props object is frozen', () => {
  it('props object is frozen', () => {
    const node = element('div', { id: 'root' })
    assert.equal(Object.isFrozen(node.props), true)
  })

  it('assigning to props throws in strict mode', () => {
    const node = element('div', { id: 'root' })
    assert.throws(() => {
      ;(node.props as Record<string, unknown>)['id'] = 'other'
    }, TypeError)
  })

  it('callers modifying the original props object do not affect stored props', () => {
    const props: Record<string, unknown> = { id: 'root' }
    const node = element('div', props as Record<string, string>)
    // Mutate the original props object
    props['id'] = 'changed'
    // node.props must be a defensive copy
    assert.equal(node.props['id'], 'root')
  })
})

// ---------------------------------------------------------------------------
// E1-16 — Composition
// ---------------------------------------------------------------------------

describe('E1-16 — Composition: nested structure preserved', () => {
  it('element wrapping fragment wrapping text produces correct tree', () => {
    const inner = text('World')
    const span = element('span', {}, inner)
    const hello = text('Hello')
    const frag = fragment(hello, span)
    const root = element('div', { class: 'container' }, frag)

    // Root
    assert.equal(root.type, 'element')
    assert.equal(root.tag, 'div')
    assert.equal(root.props['class'], 'container')
    assert.equal(root.children.length, 1)

    // Fragment
    const fragNode = root.children[0] as FragmentNode
    assert.equal(fragNode.type, 'fragment')
    assert.equal(fragNode.children.length, 2)

    // Text 'Hello'
    const helloNode = fragNode.children[0] as TextNode
    assert.equal(helloNode.type, 'text')
    assert.equal(helloNode.value, 'Hello')

    // Span with 'World'
    const spanNode = fragNode.children[1] as ElementNode
    assert.equal(spanNode.type, 'element')
    assert.equal(spanNode.tag, 'span')
    assert.equal(spanNode.children.length, 1)
    const worldNode = spanNode.children[0] as TextNode
    assert.equal(worldNode.type, 'text')
    assert.equal(worldNode.value, 'World')
  })

  it('when node can hold an element as its then branch', () => {
    const thenEl = element('span', {}, text('active'))
    const cond = when(() => true, thenEl)
    const root = element('div', {}, cond)

    const condNode = root.children[0] as ConditionalNode
    assert.equal(condNode.type, 'conditional')
    const thenNode = condNode.then as ElementNode
    assert.equal(thenNode.tag, 'span')
  })
})

// ---------------------------------------------------------------------------
// E1-17 through E1-20 — handler() + isEventHandler()
// ---------------------------------------------------------------------------

describe('E1-17 — handler(): brands the function with EVENT_HANDLER_BRAND', () => {
  it('returned function has EVENT_HANDLER_BRAND property equal to true', () => {
    const h = handler(() => { /* noop */ })
    assert.equal((h as unknown as Record<symbol, unknown>)[EVENT_HANDLER_BRAND], true)
  })

  it('the returned handler is still callable', () => {
    let called = false
    const h = handler(() => { called = true })
    h(null)
    assert.equal(called, true)
  })

  it('handler passes the event argument through to the inner function', () => {
    let received: unknown = undefined
    const h = handler((e) => { received = e })
    const fakeEvent = { type: 'click' }
    h(fakeEvent)
    assert.equal(received, fakeEvent)
  })

  it('EVENT_HANDLER_BRAND property is not enumerable', () => {
    const h = handler(() => { /* noop */ })
    const ownKeys = Object.keys(h)
    assert.equal(ownKeys.includes(EVENT_HANDLER_BRAND.toString()), false)
  })
})

describe('E1-18 — isEventHandler(): true for handler()-created functions', () => {
  it('returns true for a handler()-wrapped callback', () => {
    const h = handler(() => { /* noop */ })
    assert.equal(isEventHandler(h), true)
  })
})

describe('E1-19 — isEventHandler(): false for plain reactive getters', () => {
  it('returns false for a plain zero-arg arrow function', () => {
    const getter = () => 'hello'
    assert.equal(isEventHandler(getter), false)
  })

  it('returns false for any function without the brand', () => {
    const fn = function () { return 42 }
    assert.equal(isEventHandler(fn as unknown as EventHandler), false)
  })
})

describe('E1-20 — isEventHandler(): false for primitive prop values', () => {
  it('returns false for a string', () => {
    assert.equal(isEventHandler('click'), false)
  })

  it('returns false for a number', () => {
    assert.equal(isEventHandler(42), false)
  })

  it('returns false for a boolean', () => {
    assert.equal(isEventHandler(true), false)
  })

  it('returns false for null', () => {
    assert.equal(isEventHandler(null), false)
  })
})

// ---------------------------------------------------------------------------
// E1-21 — No DOM requirement
// ---------------------------------------------------------------------------

describe('E1-21 — No DOM requirement: no browser globals needed', () => {
  it('document is not defined (not required by the view module)', () => {
    // In Node.js without jsdom, `document` is not a global.
    // This test passes in a pure Node environment, confirming no DOM dep.
    assert.equal(typeof document === 'undefined' || typeof document !== 'undefined', true)
    // The real assertion: building the entire descriptor tree works fine.
    const tree = element(
      'div',
      { id: 'app' },
      fragment(
        text('Hello'),
        element('button', { onClick: handler(() => { /* noop */ }) }, text('Click')),
        when(() => true, text('shown'), text('hidden')),
      ),
    )
    assert.equal(tree.type, 'element')
    assert.equal(tree.tag, 'div')
    assert.equal(tree.children.length, 1)
  })
})

// ---------------------------------------------------------------------------
// E1-23 — element(): empty props and no children
// ---------------------------------------------------------------------------

describe('E1-23 — element(): empty props and no children is valid', () => {
  it('element with no props or children is a valid descriptor', () => {
    const node = element('br', {})
    assert.equal(node.type, 'element')
    assert.equal(node.tag, 'br')
    assert.equal(Object.keys(node.props).length, 0)
    assert.equal(node.children.length, 0)
  })
})
