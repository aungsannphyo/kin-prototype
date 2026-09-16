import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import {
  createReactiveHome,
  capability,
  mount,
  element,
  text,
  when,
  handler
} from '../src/index.js'

// Setup global DOM for rendering tests
const window = new Window()
global.document = window.document as any
global.EventTarget = window.EventTarget as any
global.Event = window.Event as any
global.Node = window.Node as any
global.Text = window.Text as any
global.Element = window.Element as any

describe('Phase F.4 - Lifecycle & Resource Hardening', () => {

  describe('Node & Home Lifecycle', () => {
    it('LIFECYCLE-1: node.destroy() is idempotent and cascades to children', () => {
      const home = createReactiveHome()
      const parent = home.node({})
      const child1 = parent.child({})
      const grandChild = child1.child({})

      assert.equal(child1.isChild, true)
      assert.equal(parent.isParent, true)

      // First destroy
      parent.destroy()
      
      // Attempt mutation on destroyed parent
      assert.throws(() => {
        parent.child({})
      }, /destroyed/)

      // Attempt mutation on destroyed child
      assert.throws(() => {
        child1.child({})
      }, /destroyed/)

      // Second destroy (idempotent, should not throw)
      parent.destroy()
      child1.destroy()
      grandChild.destroy()
    })

    it('LIFECYCLE-2: home.destroy() cascades to roots and relationships', () => {
      const home = createReactiveHome()
      const n1 = home.node({})
      const n2 = home.node({})
      const rel = home.relationship(n1, n2)
      
      home.destroy()

      assert.throws(() => n1.child({}), /destroyed/)
      assert.throws(() => n2.child({}), /destroyed/)
      assert.equal(rel.isDestroyed, true)
      
      // Idempotent
      home.destroy()
    })
  })

  describe('Subscription & Scheduler Lifecycle', () => {
    it('LIFECYCLE-3: unsubscribe() prevents execution even if scheduled', async () => {
      const home = createReactiveHome()
      const n = home.node({
        state: { count: 0 },
        actions: { inc: (ctx) => { ctx.state.count++ } }
      })

      let runs = 0
      const sub = home.subscribe(() => {
        n.state.count // track
        runs++
      })

      assert.equal(runs, 1)

      // Mutate to schedule
      n.actions.inc()

      // Immediately unsubscribe before flush
      home.unsubscribe(sub)

      await home.flush()

      // Should still be 1
      assert.equal(runs, 1)
    })

    it('LIFECYCLE-4: node.destroy() purges pending scheduled executions', async () => {
      const home = createReactiveHome()
      const n = home.node({
        state: { count: 0 },
        actions: { inc: (ctx) => { ctx.state.count++ } }
      })

      let runs = 0
      home.subscribe(() => {
        n.state.count // track
        runs++
      })

      assert.equal(runs, 1)

      // Mutate to schedule
      n.actions.inc()

      // Destroy node before flush
      n.destroy()

      await home.flush()

      // Should still be 1 because destruction cleans subscriptions
      assert.equal(runs, 1)
    })
  })

  describe('Authorization Lifecycle', () => {
    it('LIFECYCLE-5: grant.revoke() is idempotent and disposes linked subscriptions', async () => {
      const home = createReactiveHome()
      const alice = home.node({
        state: { name: 'Alice' },
        actions: { rename: (ctx) => { ctx.state.name = 'Mallory' } }
      })
      const bob = home.node({})
      const rel = home.relationship(bob, alice)
      const grant = rel.grant(capability(['name']))

      let runs = 0
      home.subscribeAs(bob, alice, grant, (view) => {
        view.state.name
        runs++
      })

      assert.equal(runs, 1)

      // Revoke once
      grant.revoke()
      assert.equal(grant.isRevoked, true)

      // Revoke twice (idempotent)
      grant.revoke()

      // Mutate Alice
      alice.actions.rename()
      await home.flush()

      // Bob shouldn't see it
      assert.equal(runs, 1)
    })

    it('LIFECYCLE-6: rel.destroy() cascades to all grants', () => {
      const home = createReactiveHome()
      const alice = home.node({})
      const bob = home.node({})
      const rel = home.relationship(bob, alice)
      const grant1 = rel.grant(capability([]))
      const grant2 = rel.grant(capability([]))

      assert.equal(grant1.isRevoked, false)
      assert.equal(grant2.isRevoked, false)

      rel.destroy()

      assert.equal(grant1.isRevoked, true)
      assert.equal(grant2.isRevoked, true)
      assert.equal(rel.isDestroyed, true)
      
      // rel destroy idempotent
      rel.destroy()
    })
  })

  describe('DOM & Rendering Lifecycle', () => {
    it('LIFECYCLE-7: mount() and unmount() cleanup event listeners and subscriptions', async () => {
      const home = createReactiveHome()
      const n = home.node({
        state: { val: 0 },
        actions: { click: (ctx) => { ctx.state.val++ } }
      })

      const container = document.createElement('div')
      let renderRuns = 0
      
      const handle = mount(home, () => {
        return element('button', {
          id: 'btn',
          onClick: handler(() => { n.actions.click() })
        },
        text(() => {
          renderRuns++
          return n.state.val 
        }))
      }, container)

      const btn = container.querySelector('#btn')!
      assert.ok(btn)
      assert.equal(renderRuns, 1)

      // Fire event
      btn.dispatchEvent(new Event('click'))
      await home.flush()
      
      assert.equal(renderRuns, 2)
      assert.equal(n.state.val, 1)

      // Unmount
      handle.unmount()
      assert.equal(container.childNodes.length, 0)

      // Fire event on unmounted node
      btn.dispatchEvent(new Event('click'))
      await home.flush()

      // Mutate state directly
      n.actions.click()
      await home.flush()

      // No new renders, no new increments from the old button
      assert.equal(renderRuns, 2)
      assert.equal(n.state.val, 2)
      
      // Idempotent unmount
      handle.unmount()
    })

    it('LIFECYCLE-8: mountConditional() safely switches branches and cleans up', async () => {
      const home = createReactiveHome()
      const n = home.node({
        state: { show: true },
        actions: { toggle: (ctx) => { ctx.state.show = !ctx.state.show } }
      })

      const container = document.createElement('div')
      
      let trueRuns = 0
      let falseRuns = 0

      mount(home, () => {
        return when(() => n.state.show,
          element('div', { id: 'true-branch' },
            text(() => { trueRuns++; return 'A' })
          ),
          element('div', { id: 'false-branch' },
            text(() => { falseRuns++; return 'B' })
          )
        )
      }, container)

      assert.ok(container.querySelector('#true-branch'))
      assert.equal(trueRuns, 1)
      assert.equal(falseRuns, 0)

      n.actions.toggle()
      await home.flush()

      assert.equal(container.querySelector('#true-branch'), null)
      assert.ok(container.querySelector('#false-branch'))
      assert.equal(trueRuns, 1)
      assert.equal(falseRuns, 1)

      // Trigger another state update unrelated to branching (no internal state, just re-toggle)
      n.actions.toggle()
      await home.flush()
      
      assert.ok(container.querySelector('#true-branch'))
      assert.equal(container.querySelector('#false-branch'), null)
      assert.equal(trueRuns, 2)
      assert.equal(falseRuns, 1)
    })
  })
})
