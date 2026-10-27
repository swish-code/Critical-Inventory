import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The users an administrator has added in the app, kept as one JSON file in the
 * gitignored /data folder.
 *
 * Small on purpose: a few dozen people, read once into memory and written back
 * whole on every change (to a temporary file, then renamed, so a crash mid-write
 * never leaves half a file). Moving to a database later means reimplementing
 * this module's exports; accounts.js and the admin routes do not change.
 *
 * user: { email, name, role, pages, locations, active, createdAt, updatedAt, lastLoginAt }
 *   pages      array of page ids (admins ignore it: they see everything)
 *   locations  null for every location, or an array of location names
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let file = path.resolve(__dirname, '..', '..', 'data', 'users.json')
let users = null
/** Last sign-in per address, for everyone — including people from .env, who have no user row. */
let logins = {}

const norm = (e) => String(e ?? '').trim().toLowerCase()

/** Points the store at another file — tests only. */
export function useStoreFile(p) {
  file = p
  users = null
  logins = {}
}

function load() {
  if (users) return users
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    users = Array.isArray(parsed?.users) ? parsed.users : []
    logins = parsed?.logins && typeof parsed.logins === 'object' ? parsed.logins : {}
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`  [users] could not read ${file}: ${err.message}`)
    users = []
    logins = {}
  }
  return users
}

function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ users, logins }, null, 2))
  fs.renameSync(tmp, file)
}

/** When this address last signed in, or null. */
export function lastLoginOf(email) {
  load()
  return logins[norm(email)] ?? null
}

export const listUsers = () => load().map((u) => ({ ...u }))

/** The stored user matching any of these addresses, or null. */
export function findUser(addresses) {
  const wanted = new Set([addresses].flat().map(norm).filter(Boolean))
  return load().find((u) => wanted.has(norm(u.email))) ?? null
}

export function createUser(data) {
  load()
  if (findUser(data.email)) throw Object.assign(new Error('A user with that email already exists.'), { status: 409 })
  const now = new Date().toISOString()
  const user = { ...data, email: norm(data.email), createdAt: now, updatedAt: now, lastLoginAt: null }
  users.push(user)
  save()
  return { ...user }
}

export function updateUser(email, patch) {
  load()
  const i = users.findIndex((u) => norm(u.email) === norm(email))
  if (i === -1) throw Object.assign(new Error('No such user.'), { status: 404 })
  users[i] = { ...users[i], ...patch, email: users[i].email, updatedAt: new Date().toISOString() }
  save()
  return { ...users[i] }
}

export function deleteUser(email) {
  load()
  const before = users.length
  users = users.filter((u) => norm(u.email) !== norm(email))
  if (users.length === before) throw Object.assign(new Error('No such user.'), { status: 404 })
  save()
}

/** Remembers when someone last signed in. Never fails a sign-in. */
export function touchLogin(addresses) {
  try {
    load()
    const now = new Date().toISOString()
    const list = [addresses].flat().map(norm).filter(Boolean)
    if (!list.length) return
    for (const e of list) logins[e] = now
    const u = findUser(list)
    if (u) u.lastLoginAt = now
    save()
  } catch (err) {
    console.warn(`  [users] could not record a sign-in: ${err.message}`)
  }
}
