import { test } from 'node:test'
import assert from 'node:assert/strict'

// Fixed, fake settings. Set before config.js loads so a real .env cannot leak in.
Object.assign(process.env, {
  LOCAL_LOGIN_EMAIL: 'Tester@Example.com',
  LOCAL_LOGIN_PASSWORD: 'correct-horse-battery',
  ADMIN_EMAILS: '',
  ALLOWED_EMAILS: '',
})

const fs = await import('node:fs')
const os = await import('node:os')
const path = await import('node:path')
const { after } = await import('node:test')
const store = await import('./store.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-users-'))
store.useStoreFile(path.join(tmp, 'users.json'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const { config } = await import('../config.js')
const { isLocked, verifyLocal } = await import('./local.js')
const { currentAccount } = await import('./accounts.js')

test('the right email and password sign in as an administrator', () => {
  const a = verifyLocal({ email: 'tester@example.com', password: 'correct-horse-battery' }, 'ip-ok')
  assert.equal(a?.email, 'tester@example.com')
  assert.equal(a?.isAdmin, true)
  assert.ok(currentAccount(a))
})

test('the email is matched without regard to case or spaces', () => {
  assert.ok(verifyLocal({ email: '  TESTER@example.com ', password: 'correct-horse-battery' }, 'ip-case'))
})

test('a wrong password or wrong email is refused', () => {
  assert.equal(verifyLocal({ email: 'tester@example.com', password: 'nope' }, 'ip-bad'), null)
  assert.equal(verifyLocal({ email: 'other@example.com', password: 'correct-horse-battery' }, 'ip-bad'), null)
  assert.equal(verifyLocal({}, 'ip-bad'), null)
})

test('five failures lock that client out, and only that client', () => {
  for (let i = 0; i < 5; i++) verifyLocal({ email: 'tester@example.com', password: 'wrong' }, 'ip-lock')
  assert.equal(isLocked('ip-lock'), true)
  assert.equal(isLocked('ip-other'), false)
})

test('when password sign-in is off, nothing signs in', () => {
  assert.equal(config.localLogin.enabled, true)
  config.localLogin.enabled = false
  assert.equal(verifyLocal({ email: 'tester@example.com', password: 'correct-horse-battery' }, 'ip-off'), null)
  config.localLogin.enabled = true
})
