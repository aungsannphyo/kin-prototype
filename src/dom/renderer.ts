/**
 * Phase E.2 — DOM renderer with fine-grained Kin reactive bindings
 *
 * Walks an immutable Phase E.1 descriptor tree once, creates real DOM nodes,
 * and registers one Kin subscriber per reactive getter / condition.
 *
 * Update path (unchanged kernel):
 *   Action → mutation proxy → notifyField → _fieldIndex → schedule → flush
 *     → this binding's subscriber → one Text/property write
 *
 * No Virtual DOM, no diff, no whole-tree rerender, no second reactive engine.
 */

import type { ReactiveHome, Subscriber } from '../types.js'
import type {
  ChildNode as ViewChild,
  ElementNode,
  TextNode,
  FragmentNode,
  ConditionalNode,
  EachNode,
  ReactiveGetter,
  EventHandler,
} from '../view/types.js'
import { isEventHandler } from '../view/factory.js'
import type { MountHandle, View } from './types.js'

// ---------------------------------------------------------------------------
// Internal render record (NOT exported)
// ---------------------------------------------------------------------------

type DomPrimitive = string | number | boolean | null

type ListenerBinding = {
  readonly target: EventTarget
  readonly type: string
  readonly listener: EventListener
}

type RenderRecord = {
  disposed: boolean
  readonly nodes: globalThis.ChildNode[]
  readonly subscriptions: Subscriber[]
  readonly listeners: ListenerBinding[]
  readonly children: RenderRecord[]
}

function emptyRecord(): RenderRecord {
  return {
    disposed: false,
    nodes: [],
    subscriptions: [],
    listeners: [],
    children: [],
  }
}

const SENTINEL = Symbol('kin-unset')

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a descriptor (or a one-shot View definition) into `container`.
 *
 * `home` is required so bindings use the existing `home.subscribe()` path.
 * A View function is called exactly once; it is not itself a subscriber.
 */
export function mount(
  home: ReactiveHome,
  view: ViewChild | View,
  container: ParentNode,
): MountHandle {
  if (typeof document === 'undefined') {
    throw new TypeError('mount() requires a DOM document (browser or test DOM).')
  }

  const descriptor = typeof view === 'function' ? view() : view
  const root = emptyRecord()
  const nodes = materialize(descriptor, home, root)
  for (const node of nodes) {
    container.appendChild(node)
  }

  let unmounted = false

  return {
    unmount() {
      if (unmounted) return
      unmounted = true
      disposeRecord(home, root)
    },
  }
}

// ---------------------------------------------------------------------------
// Materialize — one descriptor → owned DOM nodes + bindings
// ---------------------------------------------------------------------------

function materialize(
  desc: ViewChild,
  home: ReactiveHome,
  rec: RenderRecord,
): globalThis.Node[] {
  switch (desc.type) {
    case 'text':
      return mountText(desc, home, rec)
    case 'element':
      return mountElement(desc, home, rec)
    case 'fragment':
      return mountFragment(desc, home, rec)
    case 'conditional':
      return mountConditional(desc, home, rec)
    case 'each':
      return mountEach(desc, home, rec)
  }
}

function mountText(
  desc: TextNode,
  home: ReactiveHome,
  rec: RenderRecord,
): globalThis.Node[] {
  const value = desc.value

  if (typeof value === 'string') {
    const node = document.createTextNode(value)
    rec.nodes.push(node)
    return [node]
  }

  const node = document.createTextNode('')
  rec.nodes.push(node)
  bindText(home, rec, node, value)
  return [node]
}

function mountElement(
  desc: ElementNode,
  home: ReactiveHome,
  rec: RenderRecord,
): globalThis.Node[] {
  const el = document.createElement(desc.tag)
  rec.nodes.push(el)

  for (const key of Object.keys(desc.props)) {
    const value = desc.props[key]
    if (value === undefined) continue

    if (isEventHandler(value)) {
      bindListener(rec, el, key, value)
      continue
    }

    if (typeof value === 'function') {
      bindProp(home, rec, el, key, value)
      continue
    }

    applyDomValue(el, key, value)
  }

  for (const child of desc.children) {
    const childRec = emptyRecord()
    rec.children.push(childRec)
    const nodes = materialize(child, home, childRec)
    for (const node of nodes) {
      el.appendChild(node)
    }
  }

  return [el]
}

function mountFragment(
  desc: FragmentNode,
  home: ReactiveHome,
  rec: RenderRecord,
): globalThis.Node[] {
  const out: globalThis.Node[] = []
  for (const child of desc.children) {
    const childRec = emptyRecord()
    rec.children.push(childRec)
    const nodes = materialize(child, home, childRec)
    for (const node of nodes) {
      out.push(node)
    }
  }
  return out
}

function mountConditional(
  desc: ConditionalNode,
  home: ReactiveHome,
  rec: RenderRecord,
): globalThis.Node[] {
  const anchor = document.createComment('kin-when')
  rec.nodes.push(anchor)

  let branchRec: RenderRecord | null = null
  let current: boolean | typeof SENTINEL = SENTINEL
  let initialNodes: globalThis.Node[] = []

  const sub = home.subscribe(() => {
    if (rec.disposed) return
    const next = !!desc.when()
    if (Object.is(next, current)) return

    const first = current === SENTINEL
    current = next

    if (branchRec !== null) {
      disposeRecord(home, branchRec)
      const idx = rec.children.indexOf(branchRec)
      if (idx >= 0) rec.children.splice(idx, 1)
      branchRec = null
    }

    const branch = next ? desc.consequent : desc.otherwise
    if (branch === undefined) {
      if (first) initialNodes = []
      return
    }

    branchRec = emptyRecord()
    rec.children.push(branchRec)
    const nodes = materialize(branch, home, branchRec)
    if (first) {
      initialNodes = nodes
    } else {
      insertAfter(anchor, nodes)
    }
  })
  rec.subscriptions.push(sub)

  return [anchor, ...initialNodes]
}

function insertAfter(anchor: globalThis.Node, nodes: globalThis.Node[]): void {
  if (nodes.length === 0) return
  if ('after' in anchor && typeof (anchor as globalThis.ChildNode).after === 'function') {
    (anchor as globalThis.ChildNode).after(...nodes)
    return
  }
  const parent = anchor.parentNode
  if (parent === null) return
  let ref: globalThis.Node = anchor
  for (const node of nodes) {
    const next = ref.nextSibling
    if (next !== null) {
      (next as globalThis.ChildNode).before(node)
    } else {
      parent.appendChild(node)
    }
    ref = node
  }
}

// ---------------------------------------------------------------------------
// mountEach — Phase G.1 Dynamic Keyed List
// ---------------------------------------------------------------------------

type EachItemRecord = {
  readonly key: string | number
  item: unknown
  index: number
  readonly getIndex: () => number
  readonly rec: RenderRecord
  readonly nodes: globalThis.Node[]
}

function buildCollectionKeys(
  desc: EachNode,
  items: unknown[],
): (string | number)[] {
  const nextKeys: (string | number)[] = []
  const seenKeys = new Set<string | number>()
  for (let i = 0; i < items.length; i++) {
    const key = desc.key(items[i], i)
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate key "${String(key)}" detected in each()`)
    }
    seenKeys.add(key)
    nextKeys.push(key)
  }
  return nextKeys
}

function removeStaleItems(
  home: ReactiveHome,
  rec: RenderRecord,
  currentMap: Map<string | number, EachItemRecord>,
  nextKeySet: Set<string | number>,
): void {
  for (const [key, itemRec] of currentMap.entries()) {
    if (!nextKeySet.has(key)) {
      disposeRecord(home, itemRec.rec)
      const idx = rec.children.indexOf(itemRec.rec)
      if (idx >= 0) rec.children.splice(idx, 1)
      currentMap.delete(key)
    }
  }
}

function createEachItem(
  desc: EachNode,
  home: ReactiveHome,
  rec: RenderRecord,
  currentMap: Map<string | number, EachItemRecord>,
  key: string | number,
  item: unknown,
  index: number,
): EachItemRecord {
  let currentIndex = index
  const getIndex = () => currentIndex
  const itemRecRecord = emptyRecord()
  rec.children.push(itemRecRecord)
  const nodes = materialize(desc.render(item, getIndex), home, itemRecRecord)
  const itemRec: EachItemRecord = { key, item, index: currentIndex, getIndex, rec: itemRecRecord, nodes }
  currentMap.set(key, itemRec)
  return itemRec
}

function mountEachInitial(
  desc: EachNode,
  home: ReactiveHome,
  rec: RenderRecord,
  currentMap: Map<string | number, EachItemRecord>,
  items: unknown[],
  nextKeys: (string | number)[],
): globalThis.Node[] {
  const nodes: globalThis.Node[] = []
  for (let i = 0; i < items.length; i++) {
    const itemRec = createEachItem(desc, home, rec, currentMap, nextKeys[i], items[i], i)
    for (const n of itemRec.nodes) nodes.push(n)
  }
  return nodes
}

function insertNodesBefore(nodes: globalThis.Node[], refNode: globalThis.Node): void {
  for (const n of nodes) {
    (refNode as globalThis.ChildNode).before(n)
  }
}

function repositionItem(itemRec: EachItemRecord, i: number, item: unknown, refNode: globalThis.Node): void {
  itemRec.item = item
  itemRec.index = i
  const lastNode = itemRec.nodes.at(-1)
  const isInPlace = lastNode?.nextSibling === refNode
  if (!isInPlace && itemRec.nodes.length > 0) {
    insertNodesBefore(itemRec.nodes, refNode)
  }
}

function reconcileEach(
  desc: EachNode,
  home: ReactiveHome,
  rec: RenderRecord,
  currentMap: Map<string | number, EachItemRecord>,
  items: unknown[],
  nextKeys: (string | number)[],
  endMarker: globalThis.Node,
): void {
  if (!endMarker.parentNode) return

  let refNode: globalThis.Node = endMarker

  for (let i = items.length - 1; i >= 0; i--) {
    const key = nextKeys[i]
    let itemRec = currentMap.get(key)

    if (!itemRec) {
      itemRec = createEachItem(desc, home, rec, currentMap, key, items[i], i)
      insertNodesBefore(itemRec.nodes, refNode)
    } else {
      repositionItem(itemRec, i, items[i], refNode)
    }

    if (itemRec.nodes.length > 0) {
      refNode = itemRec.nodes[0]
    }
  }
}

function mountEach(
  desc: EachNode,
  home: ReactiveHome,
  rec: RenderRecord,
): globalThis.Node[] {
  const startAnchor = document.createComment('kin-each')
  const endMarker = document.createComment('/kin-each')
  rec.nodes.push(startAnchor, endMarker)

  const currentMap = new Map<string | number, EachItemRecord>()
  let isFirstRun = true
  let initialNodes: globalThis.Node[] = []

  const sub = home.subscribe(() => {
    if (rec.disposed) return

    const raw = desc.collection()
    const items = raw != null ? Array.from(raw) : []
    const nextKeys = buildCollectionKeys(desc, items)

    removeStaleItems(home, rec, currentMap, new Set(nextKeys))

    if (isFirstRun) {
      isFirstRun = false
      initialNodes = mountEachInitial(desc, home, rec, currentMap, items, nextKeys)
      return
    }

    reconcileEach(desc, home, rec, currentMap, items, nextKeys, endMarker)
  })

  rec.subscriptions.push(sub)

  return [startAnchor, ...initialNodes, endMarker]
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

function bindText(
  home: ReactiveHome,
  rec: RenderRecord,
  node: Text,
  getter: ReactiveGetter,
): void {
  let current: string | typeof SENTINEL = SENTINEL
  const sub = home.subscribe(() => {
    if (rec.disposed) return
    const next = toText(getter())
    if (Object.is(next, current)) return
    current = next
    if (node.data !== next) {
      node.data = next
    }
  })
  rec.subscriptions.push(sub)
}

function bindProp(
  home: ReactiveHome,
  rec: RenderRecord,
  el: Element,
  key: string,
  getter: ReactiveGetter,
): void {
  let current: DomPrimitive | typeof SENTINEL = SENTINEL
  const sub = home.subscribe(() => {
    if (rec.disposed) return
    const next = getter()
    if (Object.is(next, current)) return
    current = next
    applyDomValue(el, key, next)
  })
  rec.subscriptions.push(sub)
}

function bindListener(
  rec: RenderRecord,
  el: Element,
  propKey: string,
  handler: EventHandler,
): void {
  const type = eventTypeFromPropKey(propKey)
  const listener: EventListener = (event) => {
    if (rec.disposed) return
    handler(event)
  }
  el.addEventListener(type, listener)
  rec.listeners.push({ target: el, type, listener })
}

/**
 * Convert a branded handler's prop key to a DOM event type.
 * Identification of handlers is `isEventHandler()` — this only names the event.
 *
 * `onClick` → `click`; any other key is used as the event type as-is.
 */
function eventTypeFromPropKey(key: string): string {
  if (key.length > 2 && key.startsWith('on')) {
    const code = key.codePointAt(2)
    if (code !== undefined && code >= 65 && code <= 90) {
      return key.slice(2).toLowerCase()
    }
  }
  return key
}

function toText(value: DomPrimitive): string {
  return value === null ? '' : String(value)
}

// ---------------------------------------------------------------------------
// Static / reactive DOM property mapping (intentionally small)
//
//   class / className → className
//   boolean           → IDL property when present, plus attribute presence
//   value             → IDL value on form controls
//   null              → remove attribute
//   string / number   → setAttribute
// ---------------------------------------------------------------------------

function applyClassName(
  el: Element,
  value: DomPrimitive,
): void {
  const next = value === null || value === false ? '' : String(value)
  if (!Object.is(el.className, next)) {
    el.className = next
  }
}

function applyBooleanProp(el: Element, key: string, value: boolean): void {
  if (key in el) {
    const current = (el as unknown as Record<string, unknown>)[key]
    if (!Object.is(current, value)) {
      ;(el as unknown as Record<string, unknown>)[key] = value
    }
  }
  if (value) {
    if (!el.hasAttribute(key)) el.setAttribute(key, '')
  } else if (el.hasAttribute(key)) {
    el.removeAttribute(key)
  }
}

function applyInputValue(el: Element, value: string | number): void {
  const next = String(value)
  const input = el as HTMLInputElement
  if (!Object.is(input.value, next)) {
    input.value = next
  }
}

function applyAttribute(
  el: Element,
  key: string,
  value: string | number | null,
): void {
  if (value === null) {
    if (el.hasAttribute(key)) el.removeAttribute(key)
    return
  }

  const next = String(value)
  if (el.getAttribute(key) !== next) {
    el.setAttribute(key, next)
  }
}

function applyDomValue(
  el: Element,
  key: string,
  value: DomPrimitive,
): void {
  if (key === 'class' || key === 'className') {
    applyClassName(el, value)
    return
  }

  if (typeof value === 'boolean') {
    applyBooleanProp(el, key, value)
    return
  }

  if (key === 'value' && 'value' in el) {
    applyInputValue(el, value ?? '')
    return
  }

  applyAttribute(el, key, value)
}

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

function disposeRecord(home: ReactiveHome, rec: RenderRecord): void {
  if (rec.disposed) return
  rec.disposed = true

  for (const child of rec.children) {
    disposeRecord(home, child)
  }

  for (const sub of rec.subscriptions) {
    home.unsubscribe(sub)
  }

  for (const binding of rec.listeners) {
    binding.target.removeEventListener(binding.type, binding.listener)
  }

  for (const node of rec.nodes) {
    node.remove()
  }

  rec.children.length = 0
  rec.subscriptions.length = 0
  rec.listeners.length = 0
  rec.nodes.length = 0
}
