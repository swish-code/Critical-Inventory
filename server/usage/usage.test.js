import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseUserAgent } from './agent.js'
import { buildReport, dayOf, hourOf } from './report.js'
import * as store from './store.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-usage-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const H = 3_600_000
const D = 24 * H

test('user agents read as device, browser and OS', () => {
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
  const edge = `${win} Edg/131.0`
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'
  assert.deepEqual(parseUserAgent(win), { device: 'Desktop', browser: 'Chrome', os: 'Windows' })
  assert.equal(parseUserAgent(edge).browser, 'Edge')
  assert.deepEqual(parseUserAgent(iphone), { device: 'Mobile', browser: 'Safari', os: 'iOS' })
  assert.deepEqual(parseUserAgent(android), { device: 'Mobile', browser: 'Chrome', os: 'Android' })
  assert.deepEqual(parseUserAgent(''), { device: 'Desktop', browser: 'Other', os: 'Other' })
})

test('days and hours are Kuwait time (UTC+3)', () => {
  const t = Date.parse('2026-10-24T22:30:00Z') // 01:30 on the 25th in Kuwait
  assert.equal(dayOf(t), '2026-10-25')
  assert.equal(hourOf(t), 1)
})

test('the report counts people, logins, views, sessions and active minutes', () => {
  const now = Date.parse('2026-10-25T09:00:00Z') // 12:00 Kuwait
  const ev = (o) => ({ device: 'Desktop', browser: 'Chrome', os: 'Windows', ...o })
  const events = [
    ev({ t: now - 2 * H, type: 'login', email: 'a@x', name: 'A', sid: 's1' }),
    ev({ t: now - 2 * H + 1000, type: 'view', email: 'a@x', sid: 's1', page: '/daily' }),
    ev({ t: now - 2 * H + 60_000, type: 'beat', email: 'a@x', sid: 's1', page: '/daily' }),
    ev({ t: now - 2 * H + 120_000, type: 'beat', email: 'a@x', sid: 's1', page: '/daily' }),
    ev({ t: now - 3 * D, type: 'login', email: 'b@x', name: 'B', sid: 's2', device: 'Mobile', browser: 'Safari', os: 'iOS' }),
    ev({ t: now - 3 * D + 1000, type: 'view', email: 'b@x', sid: 's2', page: '/summary' }),
    ev({ t: now - 3 * D + 60_000, type: 'beat', email: 'b@x', sid: 's2', page: '/summary' }),
    // Outside the 14-day range, but inside the 30-day MAU window.
    ev({ t: now - 20 * D, type: 'view', email: 'c@x', sid: 's3', page: '/daily' }),
  ]
  const r = buildReport(events, { days: 14, now })

  assert.equal(r.range.from, '2026-10-12')
  assert.equal(r.range.to, '2026-10-25')
  assert.equal(r.kpis.dau, 1)
  assert.equal(r.kpis.wau, 2)
  assert.equal(r.kpis.mau, 3)
  assert.equal(r.kpis.stickiness, 1 / 3)
  assert.equal(r.kpis.logins, 2)
  assert.equal(r.kpis.loginPeople, 2)
  assert.equal(r.kpis.views, 2)
  assert.equal(r.kpis.sessions, 2)
  assert.equal(r.kpis.totalMin, 3)
  assert.equal(r.kpis.avgSessionMin, 1.5)

  assert.equal(r.daily.length, 14)
  assert.deepEqual(r.daily.at(-1), { day: '2026-10-25', views: 1, users: 1, logins: 1 })
  assert.equal(r.hours[10].minutes, 2, 'two active minutes at 10:00 Kuwait')

  assert.deepEqual(r.mostVisited.map((p) => p.page), ['/daily', '/summary'])
  assert.deepEqual(r.timeSpent[0], { page: '/daily', views: 1, minutes: 2 })
  assert.deepEqual(r.connect.devices, [{ name: 'Desktop', count: 1 }, { name: 'Mobile', count: 1 }])

  const a = r.people.find((p) => p.email === 'a@x')
  assert.equal(a.name, 'A')
  assert.equal(a.minutes, 2)
  assert.equal(a.daysActive, 1)
  assert.equal(a.spark.at(-1), 2)
  assert.equal(a.lastPage, '/daily')
  assert.equal(a.device, 'Desktop · Chrome')
  assert.ok(!r.people.some((p) => p.email === 'c@x'), 'people are limited to the range')

  assert.equal(r.sessions[0].email, 'a@x', 'newest session first')
  assert.equal(r.sessions[0].lengthMin, 2)
  assert.equal(r.feed[0].type, 'beat')
  assert.equal(r.feed.length, events.length)
})

test('one person is one person, however their address was cased', () => {
  const now = Date.parse('2026-10-25T09:00:00Z')
  const r = buildReport(
    [
      { t: now - 60_000, type: 'login', email: 'Sam@X.com', name: 'Sam Smith', sid: 'a' },
      { t: now - 30_000, type: 'view', email: 'sam@x.com', name: '', sid: 'b', page: '/daily' },
    ],
    { days: 7, now }
  )
  assert.equal(r.people.length, 1)
  assert.equal(r.people[0].email, 'sam@x.com')
  assert.equal(r.people[0].name, 'Sam Smith')
  assert.equal(r.kpis.dau, 1)
  assert.ok(r.feed.every((e) => e.name === 'Sam Smith'), 'the feed shows the name for every event')
})

test('events are kept on disk and old ones are dropped on load', async () => {
  const f = path.join(tmp, 'usage.jsonl')
  const old = { t: Date.now() - (store.RETENTION_DAYS + 1) * D, type: 'view', email: 'old@x', page: '/daily' }
  fs.writeFileSync(f, JSON.stringify(old) + '\n{half a line')
  store.useUsageFile(f)
  assert.equal(store.allEvents().length, 0, 'the old event and the broken line are dropped')

  store.record({ type: 'view', email: 'new@x', page: '/daily' })
  await store.flushed()
  store.useUsageFile(f)
  assert.deepEqual(store.allEvents().map((e) => e.email), ['new@x'])
})

test('the browser can only report known pages, and beats are rate-limited', async () => {
  store.useUsageFile(path.join(tmp, 'track.jsonl'))
  const { recordActivity } = await import('./track.js')
  const user = { email: 'a@x', name: 'A' }
  const req = { headers: { 'user-agent': 'Windows Chrome/1' } }
  assert.equal(recordActivity(user, 'tok', req, { type: 'view', page: 'daily' }), true)
  assert.equal(recordActivity(user, 'tok', req, { type: 'view', page: '../../etc' }), false)
  assert.equal(recordActivity(user, 'tok', req, { type: 'delete', page: 'daily' }), false)
  assert.equal(recordActivity(user, 'tok', req, { type: 'beat', page: 'daily' }), true)
  assert.equal(recordActivity(user, 'tok', req, { type: 'beat', page: 'daily' }), false, 'a second beat inside a minute is ignored')
  const stored = store.allEvents()
  assert.equal(stored.length, 2)
  assert.ok(stored.every((e) => e.sid && e.sid !== 'tok'), 'the cookie is never stored')
  await store.flushed()
})
