/**
 * Public API Surface & Compatibility Test
 *
 * Verifies that the frozen root package exports (`src/index.ts`) contain exactly
 * the intended public runtime symbols and do NOT leak internal implementation
 * symbols (such as EVENT_HANDLER_BRAND or CHILD_NODE_BRAND).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Kin from '../src/index.js'

describe('v0.1 Public API Surface Compatibility', () => {
  it('exports all required runtime functions and classes', () => {
    // Runtime
    assert.equal(typeof Kin.createReactiveHome, 'function')
    assert.equal(typeof Kin.createHome, 'function')
    assert.equal(typeof Kin.capability, 'function')
    assert.equal(typeof Kin.KinAuthError, 'function')

    // Views
    assert.equal(typeof Kin.element, 'function')
    assert.equal(typeof Kin.text, 'function')
    assert.equal(typeof Kin.fragment, 'function')
    assert.equal(typeof Kin.when, 'function')
    assert.equal(typeof Kin.each, 'function')
    assert.equal(typeof Kin.handler, 'function')

    // Advanced view utilities
    assert.equal(typeof Kin.isEventHandler, 'function')
    assert.equal(typeof Kin.isChildNode, 'function')

    // Browser
    assert.equal(typeof Kin.mount, 'function')
  })

  it('does NOT export internal branding symbols from the root package', () => {
    const exportedKeys = Object.keys(Kin)

    assert.equal(
      exportedKeys.includes('EVENT_HANDLER_BRAND'),
      false,
      'EVENT_HANDLER_BRAND must not be exported from root package'
    )
    assert.equal(
      exportedKeys.includes('CHILD_NODE_BRAND'),
      false,
      'CHILD_NODE_BRAND must not be exported from root package'
    )

    // Also verify symbol-keyed exports do not expose them on module namespace
    const symbols = Object.getOwnPropertySymbols(Kin)
    assert.equal(
      symbols.some((s) => s.description === 'EventHandler'),
      false,
      'EventHandler brand symbol must not be exported from root'
    )
    assert.equal(
      symbols.some((s) => s.description === 'ChildNode'),
      false,
      'ChildNode brand symbol must not be exported from root'
    )
  })

  it('has exactly the 13 intended runtime value exports', () => {
    const expectedExports = [
      'createHome',
      'createReactiveHome',
      'capability',
      'KinAuthError',
      'mount',
      'element',
      'text',
      'fragment',
      'when',
      'each',
      'handler',
      'isEventHandler',
      'isChildNode',
    ].sort()

    const actualExports = Object.keys(Kin).sort()
    assert.deepEqual(actualExports, expectedExports)
  })
})
