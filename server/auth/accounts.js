import { config } from '../config.js'
import { PAGE_IDS } from './pages.js'
import { findUser } from './store.js'

/**
 * Who may use the app, and what each person may see.
 *
 * Three sources, checked in this order:
 *   1. ADMIN_EMAILS in .env — always administrators with full access. They
 *      cannot be edited or removed in the app, so nobody can lock everyone out.
 *   2. Users added on the Admin page (store.js) — role, pages and locations as
 *      set there. A disabled user is refused.
 *   3. ALLOWED_EMAILS in .env — viewers with full access, for anyone not
 *      added on the Admin page.
 *
 * This is the only module that decides, and it is asked again on every request
 * (see middleware.js), so a change on the Admin page takes effect immediately.
 *
 * Matching is case-insensitive: Entra returns whatever casing the directory
 * holds, which is not necessarily what was typed in.
 */

const norm = (e) => String(e ?? '').trim().toLowerCase()

const full = (base, role, source) => ({
  ...base,
  role,
  isAdmin: role === 'admin',
  pages: [...PAGE_IDS],
  locations: null,
  source,
})

/**
 * The account for a verified identity, or null if it has no access.
 *
 * Every address the token carries is checked: a person's user principal name
 * and their mailbox address are often, but not always, the same string.
 *
 * @param {{ email: string, emails?: string[], name?: string }} identity
 * @returns {null | { email, emails, name, role, isAdmin, pages, locations, source }}
 */
export function accountFor({ email, emails, name }) {
  const lookup = (emails?.length ? emails : [email]).map(norm).filter(Boolean)
  if (!lookup.length) return null
  const base = { email, emails: lookup, name: String(name || '').trim() }
  const { admins, allowed } = config.access

  if (lookup.some((e) => admins.includes(e))) return full(base, 'admin', 'env')

  const stored = findUser(lookup)
  if (stored) {
    if (!stored.active) return null
    const named = { ...base, name: base.name || stored.name || '' }
    if (stored.role === 'admin') return full(named, 'admin', 'app')
    const pages = (stored.pages ?? []).filter((p) => PAGE_IDS.includes(p))
    return {
      ...named,
      role: 'viewer',
      isAdmin: false,
      pages,
      locations: Array.isArray(stored.locations) ? [...stored.locations] : null,
      source: 'app',
    }
  }

  if (lookup.some((e) => allowed.includes(e))) return full(base, 'viewer', 'env')
  return null
}

/** The account as it stands now, for someone who signed in earlier; null if access was withdrawn. */
export const currentAccount = (account) =>
  account ? accountFor({ email: account.email, emails: account.emails, name: account.name }) : null

export const canSeePage = (account, page) => Boolean(account?.isAdmin || account?.pages?.includes(page))
