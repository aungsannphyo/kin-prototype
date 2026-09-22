/**
 * Cross-Node Authorization & Account Sharing Test Suite
 *
 * Verifies:
 * 1. Authorization: Bob receives only profile.name and profile.email; balance/address/password blocked.
 * 2. Reactivity: Alice changing profile.name or profile.email reactively updates Bob's UI.
 * 3. Reactive isolation: Alice changing balance does NOT trigger updates to Bob's UI.
 * 4. Revocation: Revoking grant terminates Bob's subscriptions and stops UI updates.
 * 5. Re-granting: Creating a new Grant restores authorization and reactive updates.
 * 6. Security bypass resistance:
 *    - Nested unauthorized access throws KinAuthError('FIELD_NOT_GRANTED')
 *    - Mutation on AuthorizedView throws TypeError
 *    - Property enumeration leaks no unauthorized fields
 *    - Prototype access blocked (__proto__, constructor, getPrototypeOf)
 *    - Raw Node reference unreachable
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

import { createAccountSharingApp } from '../playground/src/account-sharing.js'

let windowRef: Window

function installDom(): void {
  windowRef = new Window({ url: 'http://localhost:5173/account-sharing.html' })
  const globals = {
    document: windowRef.document,
    Event: windowRef.Event,
    MouseEvent: windowRef.MouseEvent,
    KeyboardEvent: windowRef.KeyboardEvent,
    Node: windowRef.Node,
    HTMLElement: windowRef.HTMLElement,
    HTMLInputElement: windowRef.HTMLInputElement,
    HTMLButtonElement: windowRef.HTMLButtonElement,
    Text: windowRef.Text,
    Comment: windowRef.Comment,
  }
  Object.assign(globalThis, globals)
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

describe('Cross-Node Authorization & Account Sharing', () => {
  it('1. Initial authorization: Alice renders all fields; Bob renders only authorized fields', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = createAccountSharingApp(container)
    await app.home.flush()

    // Alice View contains all fields
    const aliceBalance = container.querySelector('#alice-balance')!
    const aliceName = container.querySelector('#alice-name')!
    const aliceEmail = container.querySelector('#alice-email')!
    const aliceAddress = container.querySelector('#alice-address')!
    const alicePassword = container.querySelector('#alice-password')!

    assert.equal(aliceBalance.textContent, '$1500')
    assert.equal(aliceName.textContent, 'Alice Henderson')
    assert.equal(aliceEmail.textContent, 'alice@example.com')
    assert.equal(aliceAddress.textContent, '742 Evergreen Terrace, Springfield')
    assert.equal(alicePassword.textContent, 'super-secret-password-123')

    // Bob View contains only authorized fields
    const bobName = container.querySelector('#bob-name')!
    const bobEmail = container.querySelector('#bob-email')!
    const bobBalance = container.querySelector('#bob-balance')!
    const bobAddress = container.querySelector('#bob-address')!
    const bobPassword = container.querySelector('#bob-password')!
    const grantBadge = container.querySelector('#grant-status-badge')!

    assert.equal(bobName.textContent, 'Alice Henderson')
    assert.equal(bobEmail.textContent, 'alice@example.com')
    assert.equal(bobBalance.textContent, '[DENIED: FIELD_NOT_GRANTED]')
    assert.equal(bobAddress.textContent, '[DENIED: FIELD_NOT_GRANTED]')
    assert.equal(bobPassword.textContent, '[DENIED: FIELD_NOT_GRANTED]')
    assert.ok(grantBadge.textContent?.includes('ACTIVE'))

    app.unmount()
    container.remove()
  })

  it('2. Reactive behavior: Alice updating name and email reactively updates Bob; balance does not', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = createAccountSharingApp(container)
    await app.home.flush()

    const aliceName = container.querySelector('#alice-name')!
    const bobName = container.querySelector('#bob-name')!
    const aliceEmail = container.querySelector('#alice-email')!
    const bobEmail = container.querySelector('#bob-email')!
    const aliceBalance = container.querySelector('#alice-balance')!

    // 2a. Update Alice name
    app.alice.actions.updateName('Alice Cooper')
    await app.home.flush()

    assert.equal(aliceName.textContent, 'Alice Cooper')
    assert.equal(bobName.textContent, 'Alice Cooper', "Bob's authorized name updated")

    // 2b. Update Alice email
    app.alice.actions.updateEmail('alice.cooper@rock.io')
    await app.home.flush()

    assert.equal(aliceEmail.textContent, 'alice.cooper@rock.io')
    assert.equal(bobEmail.textContent, 'alice.cooper@rock.io', "Bob's authorized email updated")

    // 2c. Update Alice balance — verify Bob does NOT react
    // Capture bobName text node identity before mutation
    const bobNameTextNode = bobName.firstChild as Text
    const bobEmailTextNode = bobEmail.firstChild as Text

    app.alice.actions.deposit(500)
    await app.home.flush()

    assert.equal(aliceBalance.textContent, '$2000')
    // Bob's nodes were untouched
    assert.strictEqual(bobName.firstChild, bobNameTextNode)
    assert.strictEqual(bobEmail.firstChild, bobEmailTextNode)
    assert.equal(bobName.textContent, 'Alice Cooper')
    assert.equal(bobEmail.textContent, 'alice.cooper@rock.io')

    app.unmount()
    container.remove()
  })

  it('3. Revocation: revoking Grant stops subscriptions and freezes Bob access', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = createAccountSharingApp(container)
    await app.home.flush()

    assert.ok(container.querySelector('#bob-authorized-data'))
    assert.equal(container.querySelector('#bob-revoked-banner'), null)

    // Revoke Bob's grant
    app.revokeGrant()
    await app.home.flush()

    assert.equal(app.getGrant()?.isRevoked, true)

    // Revoked banner should now be displayed
    const revokedBanner = container.querySelector('#bob-revoked-banner')
    assert.ok(revokedBanner, 'Revoked banner rendered')
    assert.equal(container.querySelector('#bob-authorized-data'), null)
    assert.ok(container.querySelector('#grant-status-badge')?.textContent?.includes('REVOKED'))

    // Alice mutates state while Bob is revoked
    app.alice.actions.updateName('Alice Post-Revoke')
    await app.home.flush()

    assert.equal(container.querySelector('#alice-name')?.textContent, 'Alice Post-Revoke')
    // Bob remains revoked and does not display the new name
    assert.equal(container.querySelector('#bob-name'), null)

    app.unmount()
    container.remove()
  })

  it('4. Re-granting: issuing a new Grant restores authorization and updates', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = createAccountSharingApp(container)
    await app.home.flush()

    // Revoke
    app.revokeGrant()
    await app.home.flush()
    assert.ok(container.querySelector('#bob-revoked-banner'))

    // Alice changes name while revoked
    app.alice.actions.updateName('Alice Restored')
    await app.home.flush()

    // Re-grant Bob access
    const newGrant = app.regrant()
    await app.home.flush()

    assert.equal(newGrant.isRevoked, false)
    assert.ok(container.querySelector('#grant-status-badge')?.textContent?.includes('ACTIVE'))
    assert.equal(container.querySelector('#bob-revoked-banner'), null)

    // Bob now sees current state
    const bobName = container.querySelector('#bob-name')!
    assert.equal(bobName.textContent, 'Alice Restored')

    // Live updates resume
    app.alice.actions.updateName('Alice Live Again')
    await app.home.flush()
    assert.equal(bobName.textContent, 'Alice Live Again')

    app.unmount()
    container.remove()
  })

  it('5. Security Enforcement: kernel prevents unauthorized access and prototype bypasses', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = createAccountSharingApp(container)
    await app.home.flush()

    const audit = app.runSecurityAudit()

    assert.equal(audit.nestedBalanceBlocked, true, 'Balance access blocked with FIELD_NOT_GRANTED')
    assert.equal(audit.nestedPasswordBlocked, true, 'Password access blocked with FIELD_NOT_GRANTED')
    assert.equal(audit.nestedAddressBlocked, true, 'Address access blocked with FIELD_NOT_GRANTED')
    assert.equal(audit.mutationBlocked, true, 'Mutation blocked with TypeError')
    assert.equal(audit.prototypeBlocked, true, '__proto__, constructor, and prototype blocked')
    assert.deepEqual(audit.keysExposed.sort(), ['email', 'name'].sort(), 'Only authorized keys exposed')
    assert.equal(audit.rawNodeHidden, true, 'No raw Node or actions exposed')

    // Verify KinAuthError specifics
    const view = app.getAuthorizedView()!
    assert.throws(
      () => (view.state as any).balance,
      (err: any) => err?.name === 'KinAuthError' && err?.code === 'FIELD_NOT_GRANTED',
    )
    assert.throws(
      () => (view.state.profile as any).password,
      (err: any) => err?.name === 'KinAuthError' && err?.code === 'FIELD_NOT_GRANTED',
    )
    assert.throws(
      () => (view.state.profile as any).address,
      (err: any) => err?.name === 'KinAuthError' && err?.code === 'FIELD_NOT_GRANTED',
    )

    app.unmount()
    container.remove()
  })

  it('6. Browser UI interaction: clicking buttons triggers actions and updates', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = createAccountSharingApp(container)
    await app.home.flush()

    const btnDeposit = container.querySelector('#btn-deposit')!
    const btnToggleName = container.querySelector('#btn-update-name')!
    const btnRevoke = container.querySelector('#btn-revoke-bob')!
    const btnRegrant = container.querySelector('#btn-regrant-bob')!

    // Click Deposit
    click(btnDeposit)
    await app.home.flush()
    assert.equal(container.querySelector('#alice-balance')?.textContent, '$1550')

    // Click Toggle Name
    click(btnToggleName)
    await app.home.flush()
    assert.equal(container.querySelector('#alice-name')?.textContent, 'Alice Cooper')
    assert.equal(container.querySelector('#bob-name')?.textContent, 'Alice Cooper')

    // Click Revoke Bob
    click(btnRevoke)
    await app.home.flush()
    assert.ok(container.querySelector('#bob-revoked-banner'))

    // Click Re-grant Bob
    click(btnRegrant)
    await app.home.flush()
    assert.ok(container.querySelector('#bob-name'))

    app.unmount()
    container.remove()
  })
})
