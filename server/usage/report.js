/**
 * The Usage analytics report, computed from the raw events on request.
 *
 * Days and hours are Kuwait time. Kuwait keeps UTC+3 all year (no daylight
 * saving), so a fixed offset is exact and far cheaper than a time-zone lookup
 * per event.
 *
 * "Active time" is counted in beats: the browser sends one per minute while the
 * tab is visible and the person has used it in the last 10 minutes, so idle
 * time is never counted. One beat = one active minute.
 */

export const TIME_ZONE = 'Asia/Kuwait'
const OFFSET_MS = 3 * 3_600_000
const DAY_MS = 86_400_000

const local = (t) => new Date(t + OFFSET_MS)
export const dayOf = (t) => local(t).toISOString().slice(0, 10)
export const hourOf = (t) => local(t).getUTCHours()

/** The last `n` Kuwait days, oldest first, ending today. */
function lastDays(n, now) {
  const today = Date.parse(`${dayOf(now)}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10))
}

const countBy = (items, key) => {
  const m = new Map()
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1)
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

const distinct = (items, key) => new Set(items.map(key)).size

/**
 * @param {object[]} events   every stored event
 * @param {{ days?: number, now?: number }} options
 */
export function buildReport(events, { days = 14, now = Date.now() } = {}) {
  const range = lastDays(days, now)
  const inRange = new Set(range)
  const last7 = new Set(lastDays(7, now))
  const last30 = new Set(lastDays(30, now))
  const today = dayOf(now)

  // One person, however their address was cased: Microsoft sign-in returns the
  // directory's casing, the password sign-in a lower-case one.
  const withDay = events.map((e) => ({ ...e, email: String(e.email ?? '').toLowerCase(), day: dayOf(e.t) }))

  /** Each person's most recent known name, so the feed and tables never fall back to an address needlessly. */
  const nameOf = new Map()
  for (const e of [...withDay].sort((a, b) => a.t - b.t)) if (e.name) nameOf.set(e.email, e.name)
  const scoped = withDay.filter((e) => inRange.has(e.day))
  const views = scoped.filter((e) => e.type === 'view')
  const beats = scoped.filter((e) => e.type === 'beat')
  const logins = scoped.filter((e) => e.type === 'login')

  const activeIn = (daySet) => distinct(withDay.filter((e) => daySet.has(e.day)), (e) => e.email)
  const dau = activeIn(new Set([today]))
  const mau = activeIn(last30)

  // A session is everything sharing a sid; only sessions with activity in range count.
  const sessions = new Map()
  for (const e of scoped) {
    if (!e.sid) continue
    const s = sessions.get(e.sid) ?? { sid: e.sid, email: e.email, name: e.name, started: e.t, lastSeen: e.t, views: 0, minutes: 0, device: e.device, browser: e.browser, os: e.os }
    s.started = Math.min(s.started, e.t)
    s.lastSeen = Math.max(s.lastSeen, e.t)
    if (e.type === 'view') s.views++
    if (e.type === 'beat') s.minutes++
    if (e.name) s.name = e.name
    sessions.set(e.sid, s)
  }
  const sessionList = [...sessions.values()]

  /* ---- per day ---- */
  const daily = range.map((day) => {
    const on = scoped.filter((e) => e.day === day)
    return {
      day,
      views: on.filter((e) => e.type === 'view').length,
      users: distinct(on, (e) => e.email),
      logins: on.filter((e) => e.type === 'login').length,
    }
  })

  /* ---- by hour of day (active minutes) ---- */
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: 0 }))
  for (const b of beats) hours[hourOf(b.t)].minutes++

  /* ---- by page ---- */
  const pageMap = new Map()
  for (const e of [...views, ...beats]) {
    const p = pageMap.get(e.page) ?? { page: e.page, views: 0, minutes: 0 }
    if (e.type === 'view') p.views++
    else p.minutes++
    pageMap.set(e.page, p)
  }
  const pages = [...pageMap.values()].filter((p) => p.page)

  /* ---- people ---- */
  const lastEver = new Map()
  for (const e of withDay) {
    const prev = lastEver.get(e.email)
    if (!prev || e.t > prev.t) lastEver.set(e.email, e)
  }
  const lastPageEver = new Map()
  for (const e of withDay) {
    if (e.type !== 'view' && e.type !== 'beat') continue
    const prev = lastPageEver.get(e.email)
    if (!prev || e.t > prev.t) lastPageEver.set(e.email, e)
  }

  const people = [...new Set(scoped.map((e) => e.email))].map((email) => {
    const mine = scoped.filter((e) => e.email === email)
    const last = lastEver.get(email)
    return {
      email,
      name: nameOf.get(email) || '',
      logins: mine.filter((e) => e.type === 'login').length,
      views: mine.filter((e) => e.type === 'view').length,
      sessions: distinct(mine.filter((e) => e.sid), (e) => e.sid),
      minutes: mine.filter((e) => e.type === 'beat').length,
      daysActive: distinct(mine, (e) => e.day),
      spark: range.map((day) => mine.filter((e) => e.day === day && e.type === 'beat').length),
      lastSeen: last?.t ?? null,
      lastPage: lastPageEver.get(email)?.page ?? null,
      device: last ? `${last.device} · ${last.browser}` : null,
    }
  })
  people.sort((a, b) => b.minutes - a.minutes || b.views - a.views)

  const totalMin = beats.length

  return {
    range: { days, from: range[0], to: range.at(-1), timeZone: TIME_ZONE },
    kpis: {
      dau,
      wau: activeIn(last7),
      mau,
      stickiness: mau ? dau / mau : null,
      logins: logins.length,
      loginPeople: distinct(logins, (e) => e.email),
      views: views.length,
      sessions: sessionList.length,
      avgSessionMin: sessionList.length ? totalMin / sessionList.length : null,
      totalMin,
    },
    daily,
    hours,
    mostVisited: [...pages].sort((a, b) => b.views - a.views).filter((p) => p.views),
    timeSpent: [...pages].sort((a, b) => b.minutes - a.minutes).filter((p) => p.minutes),
    connect: {
      devices: countBy(sessionList, (s) => s.device ?? 'Other'),
      browsers: countBy(sessionList, (s) => s.browser ?? 'Other'),
      os: countBy(sessionList, (s) => s.os ?? 'Other'),
    },
    people,
    sessions: sessionList
      .sort((a, b) => b.started - a.started)
      .slice(0, 50)
      .map(({ email, started, lastSeen, views: v, minutes }) => ({
        email,
        name: nameOf.get(email) || '',
        started,
        lengthMin: Math.round((lastSeen - started) / 60_000),
        activeMin: minutes,
        views: v,
      })),
    feed: [...withDay]
      .sort((a, b) => b.t - a.t)
      .slice(0, 40)
      .map(({ t, type, email, page }) => ({ t, type, email, name: nameOf.get(email) || '', page })),
  }
}
