import { test, after } from 'node:test'
import assert from 'node:assert/strict'

// Fixed, fake settings. Set before config.js loads so a real .env cannot leak in.
const TENANT = '11111111-1111-1111-1111-111111111111'
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222'
const CLIENT = '33333333-3333-3333-3333-333333333333'
Object.assign(process.env, {
  MS_TENANT_ID: TENANT,
  MS_CLIENT_ID: CLIENT,
  MS_CLIENT_SECRET: 'test-secret',
  MS_REDIRECT_URI: 'http://localhost:7010/api/auth/microsoft/callback',
  ADMIN_EMAILS: 'Boss@Example.com',
  ALLOWED_EMAILS: 'alice@example.com, bob@example.com',
  SESSION_TTL_HOURS: '1',
  COOKIE_INSECURE: '0',
})

const fs = await import('node:fs')
const os = await import('node:os')
const path = await import('node:path')
const store = await import('./store.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-users-'))
store.useStoreFile(path.join(tmp, 'users.json'))

const { accountFor, canSeePage, currentAccount } = await import('./accounts.js')
const sessions = await import('./sessions.js')
const { beginSignIn, completeSignIn } = await import('./microsoft.js')
const { applyScope, NO_LOCATION, parseFilters } = await import('../routes/filters.js')

const realFetch = globalThis.fetch
after(() => {
  globalThis.fetch = realFetch
  fs.rmSync(tmp, { recursive: true, force: true })
})

/* ---------------------------------------------------------- allow-list -- */

test('admins and allowed emails get in, case-insensitively', () => {
  assert.equal(accountFor({ email: 'boss@example.com' })?.isAdmin, true)
  assert.equal(accountFor({ email: 'ALICE@example.com' })?.isAdmin, false)
})

test('anyone not on the list is refused', () => {
  assert.equal(accountFor({ email: 'mallory@example.com' }), null)
})

test('any of the addresses a token carries can match', () => {
  const a = accountFor({ email: 'a.smith@corp.onmicrosoft.com', emails: ['a.smith@corp.onmicrosoft.com', 'bob@example.com'] })
  assert.ok(a)
  assert.ok(currentAccount(a))
})

/* ------------------------------------------------- users added in the app -- */

test('a user added in the app gets exactly the pages and locations given', () => {
  store.createUser({ email: 'Viewer@Example.com', name: 'Vee', role: 'viewer', pages: ['daily'], locations: ['MM-Jahra'], active: true })
  const a = accountFor({ email: 'viewer@example.com' })
  assert.equal(a.role, 'viewer')
  assert.equal(a.isAdmin, false)
  assert.deepEqual(a.pages, ['daily'])
  assert.deepEqual(a.locations, ['MM-Jahra'])
  assert.equal(canSeePage(a, 'daily'), true)
  assert.equal(canSeePage(a, 'comparison'), false)
})

test('a change in the app applies to a signed-in user straight away', () => {
  const before = accountFor({ email: 'viewer@example.com' })
  store.updateUser('viewer@example.com', { pages: ['daily', 'summary'] })
  assert.deepEqual(currentAccount(before).pages, ['daily', 'summary'])
  store.updateUser('viewer@example.com', { active: false })
  assert.equal(currentAccount(before), null, 'a disabled user loses access')
})

test('an app admin sees everything, and an .env admin cannot be narrowed by a stored row', () => {
  store.createUser({ email: 'boss@example.com', role: 'viewer', pages: ['daily'], locations: ['X'], active: false })
  const boss = accountFor({ email: 'boss@example.com' })
  assert.equal(boss.isAdmin, true)
  assert.equal(boss.locations, null)
  store.createUser({ email: 'ops@example.com', role: 'admin', pages: [], locations: ['X'], active: true })
  const ops = accountFor({ email: 'ops@example.com' })
  assert.equal(ops.isAdmin, true)
  assert.equal(ops.locations, null)
  assert.equal(canSeePage(ops, 'comparison'), true)
})

test('a stored user overrides ALLOWED_EMAILS for the same address', () => {
  store.createUser({ email: 'alice@example.com', role: 'viewer', pages: ['summary'], locations: null, active: true })
  assert.deepEqual(accountFor({ email: 'alice@example.com' }).pages, ['summary'])
})

test('location access narrows the filters and never widens them', () => {
  const user = { locations: ['A', 'B'] }
  assert.deepEqual(applyScope(parseFilters({}), user).filters.locations, ['A', 'B'], 'all locations means all of theirs')
  assert.deepEqual(applyScope(parseFilters({ locations: ['B', 'C'] }), user).filters.locations, ['B'])
  assert.deepEqual(applyScope(parseFilters({ locations: ['C'] }), user).filters.locations, [NO_LOCATION])
  assert.deepEqual(applyScope(parseFilters({ locations: ['C'] }), { locations: null }).filters.locations, ['C'])
})

test('the "no location" marker is printable, so the DAX it lands in still parses', () => {
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\u0000-\u001f\u007f]/.test(NO_LOCATION))
})

/* ------------------------------------------------------------ sessions -- */

test('a session resolves until revoked', () => {
  const raw = sessions.createSession({ email: 'alice@example.com', name: 'Alice', isAdmin: false })
  assert.equal(sessions.resolveSession(raw)?.email, 'alice@example.com')
  sessions.revokeSession(raw)
  assert.equal(sessions.resolveSession(raw), null)
})

test('an unknown session id resolves to nobody', () => {
  assert.equal(sessions.resolveSession('not-a-session'), null)
  assert.equal(sessions.resolveSession(null), null)
})

test('the session cookie is HttpOnly, SameSite=Lax and Secure unless disabled', () => {
  const c = sessions.sessionCookie('abc')
  assert.match(c, /^ci_session=abc; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600$/)
})

/* ---------------------------------------------------- Microsoft sign-in -- */

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (claims) => `${b64({ alg: 'none' })}.${b64(claims)}.sig`

/** Starts a sign-in and answers the token exchange with these claims. */
function signInWith(overrides = {}) {
  const { url, state } = beginSignIn()
  const nonce = new URL(url).searchParams.get('nonce')
  const claims = {
    aud: CLIENT,
    tid: TENANT,
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    nonce,
    exp: Math.floor(Date.now() / 1000) + 600,
    preferred_username: 'alice@example.com',
    name: 'Alice',
    ...overrides,
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ id_token: jwt(claims) }), { status: 200 })
  return { state }
}

test('the authorize URL uses the tenant endpoint, PKCE and the redirect URI', () => {
  const u = new URL(beginSignIn().url)
  assert.equal(u.origin + u.pathname, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`)
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(u.searchParams.get('redirect_uri'), process.env.MS_REDIRECT_URI)
})

test('a valid token from this tenant returns the identity', async () => {
  const { state } = signInWith()
  const id = await completeSignIn({ code: 'c', state, browserState: state })
  assert.equal(id.email, 'alice@example.com')
  assert.equal(id.name, 'Alice')
})

test('a token from another tenant is refused', async () => {
  const { state } = signInWith({ tid: OTHER_TENANT, iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` })
  await assert.rejects(completeSignIn({ code: 'c', state, browserState: state }), /different organisation/)
})

test('a token for another application is refused', async () => {
  const { state } = signInWith({ aud: 'someone-else' })
  await assert.rejects(completeSignIn({ code: 'c', state, browserState: state }), /different application/)
})

test('a mismatched nonce is refused', async () => {
  const { state } = signInWith({ nonce: 'forged' })
  await assert.rejects(completeSignIn({ code: 'c', state, browserState: state }), /could not be verified/)
})

test('a callback without the starting browser\'s state cookie is refused', async () => {
  const { state } = signInWith()
  await assert.rejects(completeSignIn({ code: 'c', state, browserState: null }), /different browser/)
})

test('a state can only be redeemed once', async () => {
  const { state } = signInWith()
  await completeSignIn({ code: 'c', state, browserState: state })
  await assert.rejects(completeSignIn({ code: 'c', state, browserState: state }), /expired/)
})
