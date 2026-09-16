import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createReactiveHome } from '../src/index.js'

describe('Phase F.3 - State Ownership and Validation Correctness', () => {
  it('STATE-OWN-1: Original nested object mutation after Node creation must NOT mutate Node state', () => {
    const home = createReactiveHome()
    const profile = { name: 'Alice' }
    const node = home.node({
      state: { profile }
    })
    
    profile.name = 'Mallory'
    
    assert.equal(node.state.profile.name, 'Alice')
  })

  it('STATE-OWN-2: Original nested array mutation after Node creation must NOT mutate Node state', () => {
    const home = createReactiveHome()
    const roles = ['admin']
    const node = home.node({
      state: { roles }
    })
    
    roles.push('root')
    
    assert.equal(node.state.roles.length, 1)
    assert.equal(node.state.roles[0], 'admin')
  })

  it('STATE-OWN-3: Deep nested caller mutation must NOT affect Node state', () => {
    const home = createReactiveHome()
    const data = { level1: { level2: { level3: 'deep' } } }
    const node = home.node({
      state: { data }
    })
    
    data.level1.level2.level3 = 'hacked'
    
    assert.equal(node.state.data.level1.level2.level3, 'deep')
  })

  it('STATE-OWN-4: Objects inside arrays must not remain aliased', () => {
    const home = createReactiveHome()
    const obj = { id: 1 }
    const list = [obj]
    const node = home.node({
      state: { list }
    })
    
    obj.id = 2
    
    assert.equal(node.state.list[0].id, 1)
  })

  it('STATE-OWN-5: Arrays inside objects must not remain aliased', () => {
    const home = createReactiveHome()
    const arr = [1, 2, 3]
    const data = { arr }
    const node = home.node({
      state: { data }
    })
    
    arr.push(4)
    
    assert.equal(node.state.data.arr.length, 3)
    assert.equal(node.state.data.arr[0], 1)
    assert.equal(node.state.data.arr[1], 2)
    assert.equal(node.state.data.arr[2], 3)
  })

  it('STATE-OWN-6: Cyclic supported state clones correctly without infinite recursion', () => {
    const home = createReactiveHome()
    const state: any = {
      profile: {
        name: 'Alice'
      }
    }
    state.self = state
    
    const node = home.node({
      state
    })
    
    assert.equal(node.state.profile.name, 'Alice')
    assert.equal(node.state.self.profile.name, 'Alice')
  })

  it('STATE-TYPE-12: function at top level rejected', () => {
    const home = createReactiveHome()
    assert.throws(() => {
      home.node({
        state: {
          cb: () => {}
        }
      })
    }, /TypeError.*functions are not supported/)
  })

  it('STATE-TYPE-13: function nested in object rejected', () => {
    const home = createReactiveHome()
    assert.throws(() => {
      home.node({
        state: {
          profile: {
            cb: () => {}
          }
        }
      })
    }, /TypeError.*functions are not supported/)
  })

  it('STATE-TYPE-14: function nested in array rejected', () => {
    const home = createReactiveHome()
    assert.throws(() => {
      home.node({
        state: {
          list: [() => {}]
        }
      })
    }, /TypeError.*functions are not supported/)
  })
})
