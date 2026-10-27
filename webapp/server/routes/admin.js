import { Router } from 'express'
import { config } from '../config.js'
import { cached } from '../cache.js'
import { requireAdmin } from '../auth/middleware.js'
import { PAGE_IDS, PAGES, ROLES } from '../auth/pages.js'
import { createUser, deleteUser, findUser, lastLoginOf, listUsers, updateUser } from '../auth/store.js'
import { executeQuery } from '../powerbi/client.js'
import { allLocationsQuery } from '../powerbi/critical.js'
import { buildReport } from '../usage/report.js'
import { allEvents } from '../usage/store.js'

/**
 * The Admin page: who may sign in, and what each person may see.
 *
 * Every route here is administrators only. People named in ADMIN_EMAILS or
 * ALLOWED_EMAILS in .env are listed (read-only) so the page shows everyone who
 * can actually get in, not just the ones added here.
 */
export const admin = Router()
admin.use(requireAdmin)

const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
const norm = (e) => String(e ?? '').trim().toLowerCase()
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const bad = (message) => Object.assign(new Error(message), { status: 400 })

/**
 * The editable fields, validated. `partial` allows a PATCH to send only what
 * changed. Admins always see every page and location, so for them those two
 * fields are stored as given but ignored.
 */
function readUser(body = {}, { partial = false } = {}) {
  const out = {}
  if (!partial || 'name' in body) out.name = String(body.name ?? '').trim().slice(0, 120)
  if (!partial || 'role' in body) {
    if (!ROLES.includes(body.role)) throw bad('Role must be admin or viewer.')
    out.role = body.role
  }
  if (!partial || 'pages' in body) {
    const pages = Array.isArray(body.pages) ? [...new Set(body.pages.filter((p) => PAGE_IDS.includes(p)))] : []
    out.pages = pages
  }
  if (!partial || 'locations' in body) {
    if (body.locations === null || body.locations === undefined) out.locations = null
    else if (Array.isArray(body.locations)) {
      out.locations = [...new Set(body.locations.filter((l) => typeof l === 'string' && l.length <= 300))].sort()
    } else throw bad('Locations must be a list, or null for all locations.')
  }
  if (!partial || 'active' in body) out.active = body.active !== false
  return out
}

/** A viewer must be able to open at least one page and see at least one location. */
function checkViewer(u) {
  if (u.role !== 'viewer') return
  if (!u.pages?.length) throw bad('Give a viewer at least one page.')
  if (Array.isArray(u.locations) && !u.locations.length) throw bad('Choose at least one location, or allow all locations.')
}

/** An administrator may not lock themselves out from this page. */
function guardSelf(req, email, next) {
  if (!req.user.emails.includes(norm(email))) return
  if (next === null) throw bad('You cannot remove your own account.')
  if (next.active === false) throw bad('You cannot disable your own account.')
  if (next.role && next.role !== 'admin') throw bad('You cannot remove your own administrator role.')
}

const isEnvAdmin = (email) => config.access.admins.includes(norm(email))

admin.get('/users', (req, res) => {
  const stored = listUsers().map((u) => ({ ...u, source: 'app' }))
  const known = new Set(stored.map((u) => norm(u.email)))
  const fromEnv = [
    ...config.access.admins.map((email) => ({ email, role: 'admin' })),
    ...config.access.allowed.map((email) => ({ email, role: 'viewer' })),
  ]
    .filter((u) => !known.has(u.email) || isEnvAdmin(u.email))
    .map((u) => ({
      email: u.email,
      name: '',
      role: u.role,
      pages: [...PAGE_IDS],
      locations: null,
      active: true,
      source: 'env',
      lastLoginAt: lastLoginOf(u.email),
    }))
  // An .env administrator always wins, so hide any stored row for the same address.
  const visibleStored = stored.filter((u) => !isEnvAdmin(u.email))
  const seen = new Set()
  const users = [...fromEnv, ...visibleStored].filter((u) => (seen.has(u.email) ? false : seen.add(u.email)))
  res.json({ users, pages: PAGES, me: req.user.email })
})

/** Usage analytics for the last 7, 14 or 30 days (Kuwait time). */
admin.get('/usage', (req, res) => {
  const days = [7, 14, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 14
  res.json(buildReport(allEvents(), { days }))
})

/** Every location in the model, for the access picker. */
admin.get('/locations', handle(async (req, res) => {
  const rows = await cached('admin:locations', () => executeQuery(allLocationsQuery()))
  res.json({ locations: rows.map((r) => r.Location).filter(Boolean) })
}))

admin.post('/users', (req, res) => {
  const email = norm(req.body?.email)
  if (!EMAIL.test(email)) throw bad('Enter a valid email address.')
  if (isEnvAdmin(email)) throw bad('That address is already an administrator through ADMIN_EMAILS in .env.')
  const data = readUser(req.body)
  checkViewer(data)
  const user = createUser({ email, ...data })
  console.log(`  [admin] ${req.user.email} added ${email} as ${data.role}`)
  res.status(201).json({ user })
})

admin.patch('/users/:email', (req, res) => {
  const email = norm(req.params.email)
  if (isEnvAdmin(email)) throw bad('Administrators from ADMIN_EMAILS are managed in .env.')
  const current = findUser(email)
  if (!current) return res.status(404).json({ error: 'No such user. Users from ALLOWED_EMAILS must be added here before they can be changed.' })
  const patch = readUser(req.body, { partial: true })
  guardSelf(req, email, patch)
  checkViewer({ ...current, ...patch })
  const user = updateUser(email, patch)
  console.log(`  [admin] ${req.user.email} updated ${email}`)
  res.json({ user })
})

admin.delete('/users/:email', (req, res) => {
  const email = norm(req.params.email)
  if (isEnvAdmin(email)) throw bad('Administrators from ADMIN_EMAILS are managed in .env.')
  guardSelf(req, email, null)
  deleteUser(email)
  console.log(`  [admin] ${req.user.email} removed ${email}`)
  res.json({ ok: true })
})
