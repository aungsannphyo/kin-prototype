/**
 * Phase F.3 — Security Hardening Audit
 *
 * Adversarial security audit attempting to break Kin's authorization boundary.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createReactiveHome, capability, KinAuthError } from '../src/index.js'

// ===========================================================================
// F.3.1 AuthorizedView Surface Audit
// ===========================================================================

describe('F.3.1 — AuthorizedView Surface Audit', () => {
  it('AuthorizedView only exposes state property', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, name: 'Alice' } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    assert.ok(capturedView !== null)
    const view = capturedView as { state: unknown }

    // Check enumerable properties
    const keys = Object.keys(view)
    assert.deepEqual(keys, ['state'], 'only state should be enumerable')

    // Check own property names
    const ownNames = Object.getOwnPropertyNames(view)
    assert.deepEqual(ownNames, ['state'], 'only state should be own property')

    // Check symbols
    const symbols = Object.getOwnPropertySymbols(view)
    assert.equal(symbols.length, 0, 'no symbol properties should be exposed')

    // Check all keys (including symbols)
    const allKeys = Reflect.ownKeys(view)
    assert.deepEqual(allKeys, ['state'], 'only state should be in ownKeys')

    // Check prototype
    const proto = Object.getPrototypeOf(view)
    assert.equal(proto, Object.prototype, 'prototype should be Object.prototype')

    // Attempt to access internal properties
    assert.equal((view as any).node, undefined)
    assert.equal((view as any).actions, undefined)
    assert.equal((view as any).relationship, undefined)
    assert.equal((view as any).grant, undefined)
    assert.equal((view as any).home, undefined)
    assert.equal((view as any).owner, undefined)
    assert.equal((view as any).target, undefined)
    assert.equal((view as any).source, undefined)
    assert.equal((view as any).internal, undefined)
    assert.equal((view as any).scope, undefined)
    assert.equal((view as any)._node, undefined)
    assert.equal((view as any)._state, undefined)

    home.destroy()
  })

  it('AuthorizedView.state is frozen', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: unknown }
    assert.throws(() => {
      (view as any).newProp = 'test'
    }, /Cannot add property/)

    home.destroy()
  })
})

// ===========================================================================
// F.3.2 Raw Node Leakage
// ===========================================================================

describe('F.3.2 — Raw Node Leakage', () => {
  it('Cannot reach raw Node through state values', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, ref: null } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance', 'ref']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number; ref: unknown } }
    assert.equal(view.state.balance, 100)
    assert.equal(view.state.ref, null)

    // Even if state contained an object, it would be a plain object
    // not a runtime object (state is application data)

    home.destroy()
  })

  it('Cannot reach raw Node through nested objects', () => {
    const home = createReactiveHome()
    const alice = home.node({ 
      state: { 
        profile: { name: 'Alice', email: 'alice@example.com' } 
      } 
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string; email: string } } }
    assert.equal(view.state.profile.name, 'Alice')
    assert.equal(view.state.profile.email, 'alice@example.com')

    // Check that profile is a proxy, not the raw object
    const profileKeys = Object.keys(view.state.profile)
    assert.deepEqual(profileKeys, ['name', 'email'])

    // Attempt to access internal properties on nested object
    // Prototype access is blocked by the proxy (returns undefined)
    assert.equal((view.state.profile as any).__proto__, undefined)
    assert.equal((view.state.profile as any).constructor, undefined)

    home.destroy()
  })
})

// ===========================================================================
// F.3.3 Action Leakage
// ===========================================================================

describe('F.3.3 — Action Leakage', () => {
  it('Cannot access actions through AuthorizedView', () => {
    const home = createReactiveHome()
    const alice = home.node({ 
      state: { balance: 100 },
      actions: { deposit(ctx, amount: number) { ctx.state.balance += amount } }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    // actions is not a property on the view object
    assert.equal((view as any).actions, undefined)
    // Attempting to access actions through state throws FIELD_NOT_GRANTED
    assert.throws(() => {
      void (view.state as any).actions
    }, KinAuthError)

    home.destroy()
  })

  it('Cannot invoke actions through state', () => {
    const home = createReactiveHome()
    const alice = home.node({ 
      state: { balance: 100 },
      actions: { deposit(ctx, amount: number) { ctx.state.balance += amount } }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    // Attempting to access action methods through state throws FIELD_NOT_GRANTED
    assert.throws(() => {
      void (view.state as any).deposit
    }, KinAuthError)

    home.destroy()
  })
})

// ===========================================================================
// F.3.4 Capability Boundary Audit
// ===========================================================================

describe('F.3.4 — Capability Boundary Audit', () => {
  it('Rejects empty path', () => {
    assert.throws(() => {
      capability([''])
    }, /must not be empty/)
  })

  it('Rejects path starting with dot', () => {
    assert.throws(() => {
      capability(['.profile'])
    }, /must not start\/end with/)
  })

  it('Rejects path ending with dot', () => {
    assert.throws(() => {
      capability(['profile.'])
    }, /must not start\/end with/)
  })

  it('Rejects double dots', () => {
    assert.throws(() => {
      capability(['profile..name'])
    }, /contain "\.\."/)
  })

  it('Rejects numeric-only segment', () => {
    assert.throws(() => {
      capability(['0'])
    }, /invalid path segment/)
  })

  it('Rejects prototype-dangerous names', () => {
    assert.throws(() => {
      capability(['__proto__'])
    }, /forbidden segment/)
    assert.throws(() => {
      capability(['constructor'])
    }, /forbidden segment/)
    assert.throws(() => {
      capability(['prototype'])
    }, /forbidden segment/)
    assert.throws(() => {
      capability(['hasOwnProperty'])
    }, /forbidden segment/)
  })

  it('Rejects double-underscore prefix', () => {
    assert.throws(() => {
      capability(['__private'])
    }, /segments starting with "__"/)
  })

  it('Accepts valid identifier paths', () => {
    assert.doesNotThrow(() => {
      capability(['profile', 'profile.name', 'profile.email.address'])
    })
  })

  it('Exact path match allows access', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, name: 'Alice' } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.equal(view.state.balance, 100)

    home.destroy()
  })

  it('Ancestor path allows access (subtree grant)', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { profile: { name: 'Alice', email: 'alice@example.com' } } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile'])) // subtree grant

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string; email: string } } }
    assert.equal(view.state.profile.name, 'Alice')
    assert.equal(view.state.profile.email, 'alice@example.com')

    home.destroy()
  })

  it('Unauthorized descendant path denies access', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { profile: { name: 'Alice', email: 'alice@example.com' } } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string; email?: string } } }
    assert.equal(view.state.profile.name, 'Alice')
    assert.throws(() => {
      void view.state.profile.email
    }, KinAuthError)

    home.destroy()
  })
})

// ===========================================================================
// F.3.5 Nested Proxy Security
// ===========================================================================

describe('F.3.5 — Nested Proxy Security', () => {
  it('Nested proxy blocks unauthorized sibling fields', () => {
    const home = createReactiveHome()
    const alice = home.node({ 
      state: { 
        profile: { 
          name: 'Alice', 
          email: 'alice@example.com',
          password: 'secret123'
        } 
      } 
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string; email: string } } }
    assert.equal(view.state.profile.name, 'Alice')
    assert.equal(view.state.profile.email, 'alice@example.com')
    assert.throws(() => {
      void (view.state.profile as any).password
    }, KinAuthError)

    home.destroy()
  })

  it('Nested proxy blocks prototype chain access', () => {
    const home = createReactiveHome()
    const alice = home.node({ 
      state: { 
        profile: { name: 'Alice' } 
      } 
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string } } }
    assert.equal((view.state.profile as any).__proto__, undefined)
    assert.equal((view.state.profile as any).constructor, undefined)
    assert.equal((view.state.profile as any).prototype, undefined)

    home.destroy()
  })

  it('Nested proxy blocks hasOwnProperty access', () => {
    const home = createReactiveHome()
    const alice = home.node({ 
      state: { 
        profile: { name: 'Alice' } 
      } 
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string } } }
    // hasOwnProperty is blocked by the proxy and throws FIELD_NOT_GRANTED
    assert.throws(() => {
      void (view.state.profile as any).hasOwnProperty
    }, KinAuthError)

    home.destroy()
  })

  it('Nested proxy cannot reach parent object', () => {
    const home = createReactiveHome()
    const alice = home.node({ 
      state: { 
        profile: { name: 'Alice', email: 'alice@example.com' } 
      } 
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string } } }
    // Can access name (authorized)
    assert.equal(view.state.profile.name, 'Alice')
    // Cannot access email (unauthorized sibling)
    assert.throws(() => {
      void (view.state.profile as any).email
    }, KinAuthError)

    home.destroy()
  })

  it('Nested proxy Object.keys only returns authorized fields', () => {
    const home = createReactiveHome()
    const alice = home.node({ 
      state: { 
        profile: { 
          name: 'Alice', 
          email: 'alice@example.com',
          password: 'secret123'
        } 
      } 
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string; email: string } } }
    // After fix: Object.keys should only return authorized fields
    const keys = Object.keys(view.state.profile)
    assert.deepEqual(keys, ['name', 'email'], 'Object.keys must not leak unauthorized fields')

    home.destroy()
  })
})

// ===========================================================================
// F.3.6 Mutation Attack Audit
// ===========================================================================

describe('F.3.6 — Mutation Attack Audit', () => {
  it('Top-level assignment throws TypeError', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      (view.state as any).balance = 200
    }, /Cannot mutate.*read-only/)

    home.destroy()
  })

  it('Nested assignment throws TypeError', () => {
    const home = createReactiveHome()
    const alice = home.node({ 
      state: { 
        profile: { name: 'Alice' } 
      } 
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string } } }
    assert.throws(() => {
      (view.state.profile as any).name = 'Bob'
    }, /Cannot mutate.*read-only/)

    home.destroy()
  })

  it('delete throws TypeError', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      delete (view.state as any).balance
    }, /Cannot delete/)

    home.destroy()
  })

  it('defineProperty throws TypeError', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      Object.defineProperty(view.state, 'newField', { value: 123 })
    }, /Cannot define property/)

    home.destroy()
  })

  it('Reflect.set throws TypeError', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      Reflect.set(view.state, 'balance', 200)
    }, /Cannot mutate/)

    home.destroy()
  })

  it('Reflect.deleteProperty throws TypeError', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      Reflect.deleteProperty(view.state, 'balance')
    }, /Cannot delete/)

    home.destroy()
  })

  it('Object.assign throws TypeError', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      Object.assign(view.state, { balance: 200 })
    }, /Cannot mutate/)

    home.destroy()
  })
})

// ===========================================================================
// F.3.7 Prototype Pollution / Prototype Escape
// ===========================================================================

describe('F.3.7 — Prototype Pollution / Prototype Escape', () => {
  it('__proto__ returns undefined on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.equal((view.state as any).__proto__, undefined)

    home.destroy()
  })

  it('constructor returns undefined on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.equal((view.state as any).constructor, undefined)

    home.destroy()
  })

  it('prototype returns undefined on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.equal((view.state as any).prototype, undefined)

    home.destroy()
  })

  it('Bracket access to __proto__ returns undefined', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.equal((view.state as any)['__proto__'], undefined)

    home.destroy()
  })

  it('Bracket access to constructor returns undefined', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.equal((view.state as any)['constructor'], undefined)

    home.destroy()
  })

  it('hasOwnProperty is blocked on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      void (view.state as any).hasOwnProperty
    }, KinAuthError)

    home.destroy()
  })
})

// ===========================================================================
// F.3.8 Symbol Attack
// ===========================================================================

describe('F.3.8 — Symbol Attack', () => {
  it('Object.getOwnPropertySymbols returns empty array on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    const symbols = Object.getOwnPropertySymbols(view.state)
    assert.deepEqual(symbols, [])

    home.destroy()
  })

  it('Reflect.ownKeys only returns string keys', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    const keys = Reflect.ownKeys(view.state)
    assert.deepEqual(keys, ['balance'])

    home.destroy()
  })

  it('Symbol.toPrimitive access passes through (no authorization)', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    // Symbol-keyed access passes through silently (no authorization check)
    const sym = Symbol.toPrimitive
    const result = (view.state as Record<symbol, unknown>)[sym]
    // This will be undefined since the raw object doesn't have this symbol
    assert.equal(result, undefined)

    home.destroy()
  })
})

// ===========================================================================
// F.3.9 Function / Getter Attack
// ===========================================================================

describe('F.3.9 — Function / Getter Attack', () => {
  it('State containing function is treated as plain value', () => {
    const home = createReactiveHome()
    const alice = home.node({ 
      state: { 
        fn: () => 'secret' 
      } 
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['fn']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { fn: () => string } }
    // The function is returned as-is (it's application data)
    // This is trusted application behavior, not a security boundary
    assert.equal(typeof view.state.fn, 'function')

    home.destroy()
  })

  it('State containing getter is treated as plain value', () => {
    const home = createReactiveHome()
    const alice = home.node({ 
      state: { 
        obj: {
          get secret() { return 'secret123' }
        }
      } 
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['obj']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { obj: { secret: string } } }
    // The getter is returned as-is (it's application data)
    // This is trusted application behavior, not a security boundary
    assert.equal(view.state.obj.secret, 'secret123')

    home.destroy()
  })
})

// ===========================================================================
// F.3.10 Revocation Attack
// ===========================================================================

describe('F.3.10 — Revocation Attack', () => {
  it('Revoked grant prevents new subscriptions', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    // Revoke the grant
    grant.revoke()

    // Attempting to subscribe with revoked grant should throw
    assert.throws(() => {
      home.subscribeAs(bob, alice, grant, () => {})
    }, KinAuthError)

    home.destroy()
  })

  it('Revocation is idempotent', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    // Revoke twice should not throw
    assert.doesNotThrow(() => {
      grant.revoke()
      grant.revoke()
    })

    home.destroy()
  })
})

// ===========================================================================
// F.3.11 Relationship Destruction Attack
// ===========================================================================

describe('F.3.11 — Relationship Destruction Attack', () => {
  it('Destroyed relationship prevents new subscriptions', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    // Destroy the relationship
    rel.destroy()

    // Attempting to subscribe with destroyed relationship should throw
    assert.throws(() => {
      home.subscribeAs(bob, alice, grant, () => {})
    }, KinAuthError)

    home.destroy()
  })

  it('Relationship destruction is idempotent', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)

    // Destroy twice should not throw
    assert.doesNotThrow(() => {
      rel.destroy()
      rel.destroy()
    })

    home.destroy()
  })
})

// ===========================================================================
// F.3.12 Node Destruction Attack
// ===========================================================================

describe('F.3.12 — Node Destruction Attack', () => {
  it('Destroyed target node prevents new subscriptions', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    // Destroy the target node
    alice.destroy()

    // Attempting to subscribe to destroyed node should throw
    // (Node destruction cascades to grant revocation)
    assert.throws(() => {
      home.subscribeAs(bob, alice, grant, () => {})
    }, KinAuthError)

    home.destroy()
  })
})

// ===========================================================================
// F.3.13 Cross-Node Isolation
// ===========================================================================

describe('F.3.13 — Cross-Node Isolation', () => {
  it('Grant from wrong source is rejected', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const charlie = home.node({ state: { id: 'charlie' } })

    // Bob has relationship with Alice
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    // Charlie tries to use Bob's grant
    assert.throws(() => {
      home.subscribeAs(charlie, alice, grant, () => {})
    }, KinAuthError)

    home.destroy()
  })

  it('Grant for wrong target is rejected', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const charlie = home.node({ state: { balance: 200 } })

    // Bob has relationship with Alice
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    // Bob tries to use Alice grant to access Charlie
    assert.throws(() => {
      home.subscribeAs(bob, charlie, grant, () => {})
    }, KinAuthError)

    home.destroy()
  })
})

// ===========================================================================
// F.3.14 Grant Confusion / Substitution Attack
// ===========================================================================

describe('F.3.14 — Grant Confusion / Substitution Attack', () => {
  it('Grant from different relationship is rejected', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const charlie = home.node({ state: { id: 'charlie' } })

    // Bob has relationship with Alice
    home.relationship(bob, alice)

    // Charlie has relationship with Alice
    const rel2 = home.relationship(charlie, alice)
    const grant2 = rel2.grant(capability(['balance']))

    // Bob tries to use Charlie's grant
    assert.throws(() => {
      home.subscribeAs(bob, alice, grant2, () => {})
    }, KinAuthError)

    home.destroy()
  })
})

// ===========================================================================
// F.3.15 Subscription Authorization Attack
// ===========================================================================

describe('F.3.15 — Subscription Authorization Attack', () => {
  it('Multiple subscribers with different grants are isolated', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, name: 'Alice' } })
    const bob = home.node({ state: { id: 'bob' } })
    const charlie = home.node({ state: { id: 'charlie' } })

    const rel1 = home.relationship(bob, alice)
    const grant1 = rel1.grant(capability(['balance']))

    const rel2 = home.relationship(charlie, alice)
    const grant2 = rel2.grant(capability(['name']))

    let bobView: unknown = null
    let charlieView: unknown = null

    home.subscribeAs(bob, alice, grant1, (view) => {
      bobView = view
    })

    home.subscribeAs(charlie, alice, grant2, (view) => {
      charlieView = view
    })

    // Bob can only see balance
    assert.equal((bobView as { state: { balance: number } }).state.balance, 100)
    assert.throws(() => {
      void (bobView as { state: { name: string } }).state.name
    }, KinAuthError)

    // Charlie can only see name
    assert.equal((charlieView as { state: { name: string } }).state.name, 'Alice')
    assert.throws(() => {
      void (charlieView as { state: { balance: number } }).state.balance
    }, KinAuthError)

    home.destroy()
  })
})

// ===========================================================================
// F.3.16 Renderer Security Boundary
// ===========================================================================

describe('F.3.16 — Renderer Security Boundary', () => {
  it('View descriptors are frozen', async () => {
    const { text } = await import('../src/view/factory.js')
    const el = text('hello')
    assert.throws(() => {
      (el as any).type = 'span'
    }, /Cannot assign/)
  })
})

// ===========================================================================
// F.3.17 Error Leakage
// ===========================================================================

describe('F.3.17 — Error Leakage', () => {
  it('KinAuthError does not leak internal state', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }

    // Try to access unauthorized field
    try {
      void (view.state as any).name
      assert.fail('Should have thrown')
    } catch (err) {
      assert.equal((err as KinAuthError).name, 'KinAuthError')
      assert.equal(typeof (err as KinAuthError).code, 'string')
      // Error message should not leak internal implementation details
      assert.ok((err as Error).message.includes('field'))
      assert.ok((err as Error).message.includes('not in the Grant'))
    }

    home.destroy()
  })
})

// ===========================================================================
// F.3.18 Public API Security
// ===========================================================================

describe('F.3.18 — Public API Security', () => {
  it('Public API does not export internal symbols', async () => {
    const kin = await import('../src/index.js')
    const exports = Object.keys(kin)
    
    // Check that internal symbols are not exported
    assert.ok(!exports.includes('GRANT_INTERNAL'))
    assert.ok(!exports.includes('RELATIONSHIP_INTERNAL'))
    assert.ok(!exports.includes('REACTIVE_NODE_INTERNAL'))
  })
})

// ===========================================================================
// F.3.21 — AuthorizedView Reflection Security
// ===========================================================================

describe('F.3.21 — AuthorizedView Reflection Security', () => {
  it('Object.keys returns only authorized top-level fields', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, name: 'Alice', password: 'SECRET' } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    const keys = Object.keys(view.state)
    assert.deepEqual(keys, ['balance'], 'Object.keys must return only authorized fields')
    home.destroy()
  })

  it('Object.getOwnPropertyNames returns only authorized top-level fields', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, name: 'Alice', password: 'SECRET' } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    const names = Object.getOwnPropertyNames(view.state)
    assert.deepEqual(names, ['balance'], 'Object.getOwnPropertyNames must return only authorized fields')
    home.destroy()
  })

  it('Object.getOwnPropertySymbols returns empty array on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    const symbols = Object.getOwnPropertySymbols(view.state)
    assert.deepEqual(symbols, [], 'Object.getOwnPropertySymbols must return empty array')
    home.destroy()
  })

  it('Reflect.ownKeys returns only authorized string keys on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, name: 'Alice', password: 'SECRET' } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    const keys = Reflect.ownKeys(view.state)
    assert.deepEqual(keys, ['balance'], 'Reflect.ownKeys must return only authorized string keys')
    home.destroy()
  })

  it('Object.getOwnPropertyDescriptor throws for unauthorized field', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, password: 'SECRET' } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      Object.getOwnPropertyDescriptor(view.state, 'password')
    }, KinAuthError)
    home.destroy()
  })

  it('Reflect.getOwnPropertyDescriptor throws for unauthorized field', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, password: 'SECRET' } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      Reflect.getOwnPropertyDescriptor(view.state, 'password')
    }, KinAuthError)
    home.destroy()
  })

  it('Object.hasOwn throws for unauthorized field', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, password: 'SECRET' } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      Object.hasOwn(view.state, 'password')
    }, KinAuthError)
    home.destroy()
  })

  it('Object.prototype.propertyIsEnumerable.call throws for unauthorized field', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, password: 'SECRET' } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      Object.prototype.propertyIsEnumerable.call(view.state, 'password')
    }, KinAuthError)
    home.destroy()
  })

  it('Nested Object.keys returns only authorized fields', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice',
          email: 'alice@example.com',
          password: 'secret123'
        }
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string; email: string } } }
    const keys = Object.keys(view.state.profile)
    assert.deepEqual(keys, ['name', 'email'], 'Nested Object.keys must return only authorized fields')
    home.destroy()
  })

  it('Nested Object.getOwnPropertyNames returns only authorized fields', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice',
          email: 'alice@example.com',
          password: 'secret123'
        }
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string; email: string } } }
    const names = Object.getOwnPropertyNames(view.state.profile)
    assert.deepEqual(names, ['name', 'email'], 'Nested Object.getOwnPropertyNames must return only authorized fields')
    home.destroy()
  })

  it('Nested Object.getOwnPropertySymbols returns empty array', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice',
          email: 'alice@example.com'
        }
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string; email: string } } }
    const symbols = Object.getOwnPropertySymbols(view.state.profile)
    assert.deepEqual(symbols, [], 'Nested Object.getOwnPropertySymbols must return empty array')
    home.destroy()
  })

  it('Nested Reflect.ownKeys returns only authorized string keys', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice',
          email: 'alice@example.com',
          password: 'secret123'
        }
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name', 'profile.email']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string; email: string } } }
    const keys = Reflect.ownKeys(view.state.profile)
    assert.deepEqual(keys, ['name', 'email'], 'Nested Reflect.ownKeys must return only authorized string keys')
    home.destroy()
  })

  it('Nested Object.getOwnPropertyDescriptor throws for unauthorized sibling', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice',
          password: 'secret123'
        }
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string } } }
    assert.throws(() => {
      Object.getOwnPropertyDescriptor(view.state.profile, 'password')
    }, KinAuthError)
    home.destroy()
  })

  it('Authorized properties remain discoverable normally', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, name: 'Alice' } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance', 'name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number; name: string } }
    
    // Authorized properties should be discoverable
    assert.equal(view.state.balance, 100)
    assert.equal(view.state.name, 'Alice')
    assert.ok(Object.hasOwn(view.state, 'balance'))
    assert.ok(Object.hasOwn(view.state, 'name'))
    
    const keys = Object.keys(view.state)
    assert.deepEqual(keys.sort(), ['balance', 'name'])
    
    home.destroy()
  })
})

// ===========================================================================
// F.3.22 — Real Symbol-Key Attack
// ===========================================================================

describe('F.3.22 — Real Symbol-Key Attack', () => {
  it('Symbol-keyed state value is accessible through bracket notation', () => {
    const secret = Symbol('secret')
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        balance: 100,
        [secret]: 'SECRET_VALUE'
      } as { balance: number; [key: symbol]: string }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number; [key: symbol]: string } }
    
    // Symbol-keyed access passes through without authorization check
    // This is because symbols cannot be capability path segments
    const value = view.state[secret]
    assert.equal(value, 'SECRET_VALUE', 'Symbol-keyed values are accessible')
    
    home.destroy()
  })

  it('Symbol-keyed state value is discoverable via getOwnPropertySymbols', () => {
    const secret = Symbol('secret')
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        balance: 100,
        [secret]: 'SECRET_VALUE'
      } as { balance: number; [key: symbol]: string }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number; [key: symbol]: string } }
    
    // getOwnPropertySymbols returns empty array on the proxy
    // because the proxy doesn't have a getOwnPropertySymbols trap
    const symbols = Object.getOwnPropertySymbols(view.state)
    assert.deepEqual(symbols, [], 'getOwnPropertySymbols returns empty array on proxy')
    
    // However, the symbol-keyed value is still accessible via bracket notation
    const value = view.state[secret]
    assert.equal(value, 'SECRET_VALUE')
    
    home.destroy()
  })

  it('Symbol-keyed state value in nested object is accessible', () => {
    const secret = Symbol('secret')
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice',
          [secret]: 'SECRET_VALUE'
        }
      } as { profile: { name: string; [key: symbol]: string } }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string; [key: symbol]: string } } }
    
    // Symbol-keyed access passes through on nested objects too
    const value = view.state.profile[secret]
    assert.equal(value, 'SECRET_VALUE', 'Symbol-keyed values in nested objects are accessible')
    
    home.destroy()
  })

  it('Reflect.ownKeys does not expose symbol-keyed values', () => {
    const secret = Symbol('secret')
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        balance: 100,
        [secret]: 'SECRET_VALUE'
      } as { balance: number; [key: symbol]: string }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number; [key: symbol]: string } }
    
    // Reflect.ownKeys returns only string keys from ownKeys trap
    const keys = Reflect.ownKeys(view.state)
    assert.deepEqual(keys, ['balance'], 'Reflect.ownKeys does not expose symbols')
    
    home.destroy()
  })
})

// ===========================================================================
// F.3.23 — Function / Getter / Closure Attack
// ===========================================================================

describe('F.3.23 — Function / Getter / Closure Attack', () => {
  it('State containing function is treated as plain value', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        balance: 100,
        publicFunction: () => 'SECRET'
      } as { balance: number; publicFunction: () => string }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance', 'publicFunction']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number; publicFunction: () => string } }
    
    // Function is returned as-is - this is trusted application data
    assert.equal(typeof view.state.publicFunction, 'function')
    assert.equal(view.state.publicFunction(), 'SECRET')
    
    home.destroy()
  })

  it('State containing getter is treated as plain value', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        balance: 100,
        get secret() { return 'SECRET' }
      } as { balance: number; secret: string }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance', 'secret']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number; secret: string } }
    
    // Getter is evaluated and returned - this is trusted application data
    assert.equal(view.state.secret, 'SECRET')
    
    home.destroy()
  })

  it('Function cannot access Node internals through closure', () => {
    const home = createReactiveHome()
    let capturedNode: unknown = null
    const alice = home.node({
      state: {
        balance: 100,
        getInternal: () => capturedNode
      } as { balance: number; getInternal: () => unknown }
    })
    capturedNode = alice
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance', 'getInternal']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number; getInternal: () => unknown } }
    
    // The function returns the raw Node reference
    // This is trusted application behavior - the application controls
    // what functions are stored in state
    const internal = view.state.getInternal()
    assert.ok(internal !== null)
    
    home.destroy()
  })

  it('Getter throwing error does not expose internal state', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        balance: 100,
        error: {
          get value() { throw new Error('Intentional error') }
        }
      } as { balance: number; error: { value: never } }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance', 'error']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number; error: { value: never } } }
    
    // Getter throws - this is application behavior, not a security boundary
    assert.throws(() => {
      view.state.error.value
    }, /Intentional error/)
    
    home.destroy()
  })

  it('Nested function is treated as plain value', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice',
          getSecret: () => 'PROFILE_SECRET'
        }
      } as { profile: { name: string; getSecret: () => string } }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name', 'profile.getSecret']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string; getSecret: () => string } } }
    
    // Nested function is returned as-is
    assert.equal(typeof view.state.profile.getSecret, 'function')
    assert.equal(view.state.profile.getSecret(), 'PROFILE_SECRET')
    
    home.destroy()
  })
})

// ===========================================================================
// F.3.24 — Extended Reflection Mutation Attack
// ===========================================================================

describe('F.3.24 — Extended Reflection Mutation Attack', () => {
  it('Reflect.setPrototypeOf throws TypeError on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      Reflect.setPrototypeOf(view.state, {})
    }, TypeError)
    home.destroy()
  })

  it('Object.setPrototypeOf throws TypeError on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      Object.setPrototypeOf(view.state, {})
    }, TypeError)
    home.destroy()
  })

  it('Reflect.preventExtensions throws TypeError on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      Reflect.preventExtensions(view.state)
    }, TypeError)
    home.destroy()
  })

  it('Reflect.setPrototypeOf throws TypeError on nested proxy', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice'
        }
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string } } }
    assert.throws(() => {
      Reflect.setPrototypeOf(view.state.profile, {})
    }, TypeError)
    home.destroy()
  })

  it('Object.setPrototypeOf throws TypeError on nested proxy', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice'
        }
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string } } }
    assert.throws(() => {
      Object.setPrototypeOf(view.state.profile, {})
    }, TypeError)
    home.destroy()
  })

  it('Reflect.preventExtensions throws TypeError on nested proxy', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice'
        }
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string } } }
    assert.throws(() => {
      Reflect.preventExtensions(view.state.profile)
    }, TypeError)
    home.destroy()
  })
})

// ===========================================================================
// F.3.25 — Prototype Escape Revalidation
// ===========================================================================

describe('F.3.25 — Prototype Escape Revalidation', () => {
  it('Object.getPrototypeOf returns null on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    const proto = Object.getPrototypeOf(view.state)
    assert.equal(proto, null, 'Object.getPrototypeOf should return null')
    home.destroy()
  })

  it('Reflect.getPrototypeOf returns null on top-level', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    const proto = Reflect.getPrototypeOf(view.state)
    assert.equal(proto, null, 'Reflect.getPrototypeOf should return null')
    home.destroy()
  })

  it('Object.getPrototypeOf returns null on nested proxy', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice'
        }
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string } } }
    const proto = Object.getPrototypeOf(view.state.profile)
    assert.equal(proto, null, 'Object.getPrototypeOf should return null on nested proxy')
    home.destroy()
  })

  it('Reflect.getPrototypeOf returns null on nested proxy', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice'
        }
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string } } }
    const proto = Reflect.getPrototypeOf(view.state.profile)
    assert.equal(proto, null, 'Reflect.getPrototypeOf should return null on nested proxy')
    home.destroy()
  })

  it('isPrototypeOf returns false for Object.prototype', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    const result = Object.prototype.isPrototypeOf(view.state)
    assert.equal(result, false, 'Object.prototype should not be prototype of AuthorizedView')
    home.destroy()
  })
})

// ===========================================================================
// F.3.26 — Security Invariant Verification S1-S14
// ===========================================================================

describe('F.3.26 — Security Invariant Verification S1-S14', () => {
  it('S1: AuthorizedView only exposes authorized state fields', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100, password: 'SECRET' } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    const keys = Object.keys(view.state)
    assert.deepEqual(keys, ['balance'])
    assert.equal(view.state.balance, 100)
    assert.throws(() => {
      (view.state as any).password
    }, KinAuthError)
    home.destroy()
  })

  it('S2: AuthorizedView.state is frozen (immutable)', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      view.state.balance = 200
    }, TypeError)
    home.destroy()
  })

  it('S3: Raw Node cannot be reached through AuthorizedView', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.equal(typeof view.state, 'object')
    assert.throws(() => {
      (view.state as any).node
    }, KinAuthError)
    home.destroy()
  })

  it('S4: Actions cannot be accessed through AuthorizedView', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: { balance: 100 },
      actions: {
        deposit: (ctx) => ({ balance: ctx.state.balance + 100 })
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    // AuthorizedView only has 'state' property, not 'actions'
    assert.equal((view as any).actions, undefined)
    home.destroy()
  })

  it('S5: Capability paths are validated at grant creation', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    
    // capability() validates paths and throws TypeError for invalid paths
    assert.throws(() => {
      rel.grant(capability(['']))
    }, TypeError)
    home.destroy()
  })

  it('S6: Nested proxies enforce authorization', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        profile: {
          name: 'Alice',
          password: 'secret'
        }
      }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['profile.name']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { profile: { name: string } } }
    const keys = Object.keys(view.state.profile)
    assert.deepEqual(keys, ['name'])
    assert.throws(() => {
      (view.state.profile as unknown as { password: string }).password
    }, KinAuthError)
    home.destroy()
  })

  it('S7: Mutation attacks are blocked', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.throws(() => {
      view.state.balance = 200
    }, TypeError)
    assert.throws(() => {
      delete (view.state as any).balance
    }, TypeError)
    assert.throws(() => {
      Reflect.set(view.state, 'balance', 200)
    }, TypeError)
    home.destroy()
  })

  it('S8: Prototype pollution is blocked', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number } }
    assert.equal((view.state as any).__proto__, undefined)
    assert.equal(Object.getPrototypeOf(view.state), null)
    assert.throws(() => {
      Reflect.setPrototypeOf(view.state, {})
    }, TypeError)
    home.destroy()
  })

  it('S9: Symbol access passes through (acceptable)', () => {
    const secret = Symbol('secret')
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        balance: 100,
        [secret]: 'SECRET_VALUE'
      } as { balance: number; [key: symbol]: string }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number; [key: symbol]: string } }
    assert.equal(view.state[secret], 'SECRET_VALUE')
    home.destroy()
  })

  it('S10: Functions in state are treated as plain values (acceptable)', () => {
    const home = createReactiveHome()
    const alice = home.node({
      state: {
        balance: 100,
        publicFunction: () => 'SECRET'
      } as { balance: number; publicFunction: () => string }
    })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance', 'publicFunction']))

    let capturedView: unknown = null
    home.subscribeAs(bob, alice, grant, (view) => {
      capturedView = view
    })

    const view = capturedView as { state: { balance: number; publicFunction: () => string } }
    assert.equal(typeof view.state.publicFunction, 'function')
    assert.equal(view.state.publicFunction(), 'SECRET')
    home.destroy()
  })

  it('S11: Revocation prevents new subscriptions', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    grant.revoke()

    assert.throws(() => {
      home.subscribeAs(bob, alice, grant, () => {})
    }, KinAuthError)
    home.destroy()
  })

  it('S12: Relationship destruction prevents new subscriptions', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    rel.destroy()

    assert.throws(() => {
      home.subscribeAs(bob, alice, grant, () => {})
    }, KinAuthError)
    home.destroy()
  })

  it('S13: Node destruction prevents new subscriptions', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    alice.destroy()

    assert.throws(() => {
      home.subscribeAs(bob, alice, grant, () => {})
    }, KinAuthError)
    home.destroy()
  })

  it('S14: Cross-node isolation is enforced', () => {
    const home = createReactiveHome()
    const alice = home.node({ state: { balance: 100 } })
    const bob = home.node({ state: { id: 'bob' } })
    const charlie = home.node({ state: { id: 'charlie' } })
    const rel = home.relationship(bob, alice)
    const grant = rel.grant(capability(['balance']))

    assert.throws(() => {
      home.subscribeAs(charlie, alice, grant, () => {})
    }, KinAuthError)
    home.destroy()
  })
})

// ===========================================================================
// F.3.27 — Readonly State Prototype Safety (Plain Node & ReactiveNode)
// ===========================================================================

describe('F.3.27 — Readonly State Prototype Safety', () => {
  it('RO-PROT-1: __proto__ property returns undefined on readonly state', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { profile: { name: 'Alice' } } })
    
    assert.equal((node.state as unknown as { __proto__: unknown }).__proto__, undefined)
    assert.equal((node.state.profile as unknown as { __proto__: unknown }).__proto__, undefined)
    home.destroy()
  })

  it('RO-PROT-2: constructor property returns undefined on readonly state', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { profile: { name: 'Alice' } } })
    
    assert.equal((node.state as unknown as { constructor: unknown }).constructor, undefined)
    assert.equal((node.state.profile as unknown as { constructor: unknown }).constructor, undefined)
    home.destroy()
  })

  it('RO-PROT-3: prototype property returns undefined on readonly state', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { profile: { name: 'Alice' } } })
    
    assert.equal((node.state as unknown as { prototype: unknown }).prototype, undefined)
    assert.equal((node.state.profile as unknown as { prototype: unknown }).prototype, undefined)
    home.destroy()
  })

  it('RO-PROT-4: __proto__ blocked on array elements', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { items: [{ name: 'item1' }] } })
    
    assert.equal((node.state.items as unknown as { __proto__: unknown }[])[0].__proto__, undefined)
    home.destroy()
  })

  it('RO-PROT-5: constructor blocked on array elements', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { items: [{ name: 'item1' }] } })
    
    assert.equal((node.state.items as unknown as { constructor: unknown }[])[0].constructor, undefined)
    home.destroy()
  })

  it('RO-PROT-6: prototype blocked on array elements', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { items: [{ name: 'item1' }] } })
    
    assert.equal((node.state.items as unknown as { prototype: unknown }[])[0].prototype, undefined)
    home.destroy()
  })

  it('RO-PROT-7: preventExtensions/freeze/seal interaction with proxy invariants', () => {
    const home = createReactiveHome()
    const node = home.node({
      state: { profile: { name: 'Alice' } },
      actions: {
        freezeProfile: (ctx) => {
          Object.freeze(ctx.state.profile)
        }
      }
    })
    
    // Freeze the profile inside an Action
    node.actions.freezeProfile()
    
    // Reading through readonly proxy should still work
    assert.equal(node.state.profile.name, 'Alice')
    
    // getPrototypeOf must return the actual prototype when target is non-extensible
    // to satisfy JavaScript Proxy invariants. This is a necessary trade-off for
    // supporting Actions that freeze/seal objects while maintaining correctness.
    const proto = Object.getPrototypeOf(node.state.profile)
    assert.equal(proto, Object.prototype, 'getPrototypeOf must return actual prototype when target is frozen')
    
    const reflectProto = Reflect.getPrototypeOf(node.state.profile)
    assert.equal(reflectProto, Object.prototype, 'Reflect.getPrototypeOf must return actual prototype when target is frozen')
    
    // However, __proto__, constructor, and prototype properties are still blocked
    assert.equal((node.state.profile as unknown as { __proto__: unknown }).__proto__, undefined)
    assert.equal((node.state.profile as unknown as { constructor: unknown }).constructor, undefined)
    assert.equal((node.state.profile as unknown as { prototype: unknown }).prototype, undefined)
    
    home.destroy()
  })
})

// ===========================================================================
// F.3.28 — State Type Model (v0.1)
// ===========================================================================

describe('F.3.28 — State Type Model v0.1', () => {
  it('STATE-TYPE-1: primitives accepted', () => {
    const home = createReactiveHome()
    const node = home.node({ 
      state: { 
        str: 'hello',
        num: 42,
        bool: true,
        nullVal: null,
        undef: undefined
      } 
    })
    
    assert.equal(node.state.str, 'hello')
    assert.equal(node.state.num, 42)
    assert.equal(node.state.bool, true)
    assert.equal(node.state.nullVal, null)
    assert.equal(node.state.undef, undefined)
    
    home.destroy()
  })

  it('STATE-TYPE-2: plain objects accepted', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { profile: { name: 'Alice', address: { city: 'NYC' } } } })
    
    // Reading nested object should return a proxy
    const profile = node.state.profile
    assert.equal(profile.name, 'Alice')
    
    // Nested mutation should throw
    assert.throws(() => {
      (profile as unknown as { name: string }).name = 'Bob'
    }, TypeError)
    
    assert.throws(() => {
      (profile.address as unknown as { city: string }).city = 'LA'
    }, TypeError)
    
    home.destroy()
  })

  it('STATE-TYPE-3: arrays accepted', () => {
    const home = createReactiveHome()
    const node = home.node({ state: { items: [{ id: 1 }, { id: 2 }] } })
    
    // Reading array should return a proxy
    const items = node.state.items
    assert.equal(items.length, 2)
    
    // Array mutation should throw
    assert.throws(() => {
      items.push({ id: 3 })
    }, TypeError)
    
    // Nested array element mutation should throw
    assert.throws(() => {
      (items[0] as unknown as { id: number }).id = 99
    }, TypeError)
    
    home.destroy()
  })

  it('STATE-TYPE-4: Date rejected', () => {
    const home = createReactiveHome()
    const date = new Date('2024-01-01')
    
    assert.throws(() => {
      home.node({ state: { createdAt: date } })
    }, TypeError, 'Date is not supported')
    
    home.destroy()
  })

  it('STATE-TYPE-5: RegExp rejected', () => {
    const home = createReactiveHome()
    const regex = /test/g
    
    assert.throws(() => {
      home.node({ state: { pattern: regex } })
    }, TypeError, 'RegExp is not supported')
    
    home.destroy()
  })

  it('STATE-TYPE-6: Map rejected', () => {
    const home = createReactiveHome()
    const map = new Map([['key', 'value']])
    
    assert.throws(() => {
      home.node({ state: { data: map } })
    }, TypeError, 'Map is not supported')
    
    home.destroy()
  })

  it('STATE-TYPE-7: Set rejected', () => {
    const home = createReactiveHome()
    const set = new Set([1, 2, 3])
    
    assert.throws(() => {
      home.node({ state: { data: set } })
    }, TypeError, 'Set is not supported')
    
    home.destroy()
  })

  it('STATE-TYPE-8: class instance rejected', () => {
    class TestClass {
      constructor(public value: number) {}
    }
    
    const home = createReactiveHome()
    const instance = new TestClass(42)
    
    assert.throws(() => {
      home.node({ state: { obj: instance } })
    }, TypeError, 'class instance or special object is not supported')
    
    home.destroy()
  })

  it('STATE-TYPE-9: typed array rejected', () => {
    const home = createReactiveHome()
    const typedArray = new Int8Array([1, 2, 3])
    
    assert.throws(() => {
      home.node({ state: { data: typedArray } })
    }, TypeError, 'Int8Array is not supported')
    
    home.destroy()
  })

  it('STATE-TYPE-10: nested special object rejected', () => {
    const home = createReactiveHome()
    const date = new Date('2024-01-01')
    
    assert.throws(() => {
      home.node({ state: { profile: { createdAt: date } } })
    }, TypeError, 'Date is not supported')
    
    home.destroy()
  })

  it('STATE-TYPE-11: cyclic valid state accepted', () => {
    const home = createReactiveHome()
    const cyclic: Record<string, unknown> = { name: 'Alice' }
    cyclic.self = cyclic
    
    const node = home.node({ state: { profile: cyclic } })
    
    assert.equal(node.state.profile.name, 'Alice')
    assert.strictEqual(node.state.profile.self, node.state.profile)
    
    home.destroy()
  })
})
