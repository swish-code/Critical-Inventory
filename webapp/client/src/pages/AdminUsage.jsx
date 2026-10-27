import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTip, XAxis, YAxis } from 'recharts'
import { api } from '../api.js'
import { useChartColors } from '../components/charts/useChartColors.js'
import { DataTable } from '../components/DataTable.jsx'
import { Empty, ErrorBanner } from '../components/ui.jsx'
import { Tooltip } from '../components/Tooltip.jsx'
import { fmtCount, fmtDay, fmtDuration, fmtPct, fmtStamp, shortAgo } from '../format.js'
import { useData } from '../useData.js'

const RANGES = [7, 14, 30]
const REFRESH_MS = 30_000

/** Friendly names for the tracked pages. */
const PAGE_NAMES = {
  '/daily': 'Daily Critical Report',
  '/summary': 'Summary',
  '/comparison': 'Comparison Report',
  '/admin': 'Admin',
}
const pageName = (p) => PAGE_NAMES[p] ?? p ?? '–'

/* ------------------------------------------------------------------ pieces -- */

function Tile({ label, value, foot, accent = false, hint }) {
  return (
    <Tooltip text={hint}>
      <section className="kpi kpi--compact" tabIndex={hint ? 0 : undefined}>
        <h3 className="kpi__label">{label}</h3>
        <p className={`kpi__value${accent ? ' kpi__value--pos' : ''}`}>{value}</p>
        {foot && <p className="kpi__foot">{foot}</p>}
      </section>
    </Tooltip>
  )
}

/** A card with a title, a note, and a Chart / Table switch for the table-view twin. */
function ChartCard({ title, note, table, children, className = '' }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={`panel ucard ${className}`}>
      <header className="ucard__head">
        <h2>{title}</h2>
        {note && <span className="ucard__note">{note}</span>}
        {table && (
          <button type="button" className="link ucard__switch" onClick={() => setAsTable((t) => !t)}>
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </header>
      <div className="ucard__body">{asTable ? table : children}</div>
    </section>
  )
}

function ChartTooltip({ active, payload, label, format }) {
  if (!active || !payload?.length) return null
  return (
    <div className="ctip">
      <p className="ctip__title">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="ctip__row">
          <span className="ctip__swatch" style={{ background: p.color }} />
          <span className="ctip__name">{p.name}</span>
          <span className="ctip__val">{format ? format(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  )
}

/**
 * Activity as small multiples: page views, active users and logins on their own
 * scales, one above the other on a shared date axis. On a single axis the
 * smaller two (tens) would be flattened against the floor by the views
 * (hundreds), so each gets its own panel instead of a second y-axis.
 */
function ActivityChart({ daily }) {
  const c = useChartColors()
  const data = daily.map((d) => ({ ...d, label: fmtDay(d.day) }))
  const series = [
    { key: 'views', name: 'Page views', color: c.s1 },
    { key: 'users', name: 'Active users', color: c.s2 },
    { key: 'logins', name: 'Logins', color: c.s3 },
  ]
  return (
    <div className="multiples">
      {series.map((s, i) => {
        const last = data.at(-1)?.[s.key] ?? 0
        const isLast = i === series.length - 1
        return (
          <div key={s.key} className="multiple">
            <div className="multiple__label">
              <span className="multiple__swatch" style={{ background: s.color }} />
              <span>{s.name}</span>
              <strong>{fmtCount(last)}</strong>
              <span className="muted">today</span>
            </div>
            <div style={{ height: isLast ? 92 : 70 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={c.grid} />
                  <XAxis
                    dataKey="label"
                    hide={!isLast}
                    tick={{ fill: c.axis, fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: c.grid }}
                    interval="preserveStartEnd"
                    minTickGap={18}
                  />
                  <YAxis
                    width={34}
                    allowDecimals={false}
                    tickCount={3}
                    tick={{ fill: c.axis, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ChartTip cursor={{ stroke: c.axis, strokeWidth: 1 }} content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function HoursChart({ hours }) {
  const c = useChartColors()
  const data = hours.map((h) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}:00` }))
  return (
    <div style={{ height: 248 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="14%">
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" tick={{ fill: c.axis, fontSize: 10 }} tickLine={false} axisLine={{ stroke: c.grid }} interval={1} />
          <YAxis width={34} allowDecimals={false} tick={{ fill: c.axis, fontSize: 10 }} tickLine={false} axisLine={false} />
          <ChartTip cursor={{ fill: c.grid, opacity: 0.6 }} content={<ChartTooltip format={fmtDuration} />} />
          <Bar dataKey="minutes" name="Active time" fill={c.s3} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Horizontal bars as plain HTML: name, bar, value — one series, one colour. */
function BarList({ rows, value, format }) {
  if (!rows.length) return <p className="muted small">Nothing yet.</p>
  const max = Math.max(...rows.map(value), 1)
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li key={r.page}>
          <span className="barlist__name">{pageName(r.page)}</span>
          <span className="barlist__track" aria-hidden="true">
            <span className="barlist__fill" style={{ width: `${(value(r) / max) * 100}%` }} />
          </span>
          <span className="barlist__val">{format(value(r))}</span>
        </li>
      ))}
    </ul>
  )
}

function Counts({ title, rows }) {
  return (
    <div className="counts">
      <h3 className="kpi__label">{title}</h3>
      {rows.length ? (
        <ul>
          {rows.map((r) => (
            <li key={r.name}>
              <span>{r.name}</span>
              <strong>{fmtCount(r.count)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">–</p>
      )}
    </div>
  )
}

/** A person's active minutes per day as tiny bars, oldest to newest. */
function Spark({ values }) {
  const max = Math.max(...values, 1)
  const w = 3
  const gap = 1
  return (
    <svg className="spark" width={values.length * (w + gap)} height={18} aria-hidden="true">
      {values.map((v, i) => {
        const h = v ? Math.max(2, (v / max) * 18) : 1
        return <rect key={i} x={i * (w + gap)} y={18 - h} width={w} height={h} rx={1} className={v ? 'spark__on' : 'spark__off'} />
      })}
    </svg>
  )
}

const BADGE = { view: 'Page view', beat: 'Heartbeat', login: 'Login' }

/* -------------------------------------------------------------------- page -- */

/**
 * Usage analytics — who uses the dashboard, how often and for how long.
 * Active time counts only minutes in which the tab was visible and in use;
 * idle time over 10 minutes is excluded. Days and hours are Kuwait time.
 */
export function AdminUsage() {
  const [days, setDays] = useState(14)
  const [nonce, setNonce] = useState(0)
  const report = useData(api.adminUsage, { days }, { nonce, debounce: 0 })
  const r = report.data

  // Keeps the live feed and "last seen" current while the page is open.
  useEffect(() => {
    const t = setInterval(() => setNonce((n) => n + 1), REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  const k = r?.kpis
  const empty = r && !r.feed.length

  return (
    <div className="usage">
      <div className="usage__head">
        <div>
          <h2 className="usage__title">Usage analytics</h2>
          <p className="muted">
            Who is using the dashboard, how often and for how long · idle time over 10 minutes is excluded
          </p>
        </div>
        <div className="seg" role="radiogroup" aria-label="Period">
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              className={`seg__opt${days === d ? ' seg__opt--on seg__opt--dark' : ''}`}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <ErrorBanner error={report.error} onRetry={report.reload} />
      {!r && report.loading && <div className="skel skel--table" aria-busy="true" />}
      {empty && (
        <section className="panel">
          <Empty title="No activity recorded yet" hint="Usage appears here as people sign in and use the dashboard." />
        </section>
      )}

      {r && !empty && (
        <>
          <div className="tiles">
            <Tile label="Active today" value={fmtCount(k.dau)} foot="DAU" accent hint="People who used the dashboard today" />
            <Tile label="Active this week" value={fmtCount(k.wau)} foot="WAU" hint="People active in the last 7 days" />
            <Tile label="Active this month" value={fmtCount(k.mau)} foot="MAU" hint="People active in the last 30 days" />
            <Tile
              label="Stickiness"
              value={k.stickiness === null ? '–' : fmtPct(k.stickiness).replace('.00', '')}
              foot="DAU ÷ MAU"
              accent
              hint="Share of this month's users who were active today — how many monthly users show up daily"
            />
            <Tile label="Total logins" value={fmtCount(k.logins)} foot={`${k.loginPeople} people`} hint="Sign-ins in the period" />
            <Tile label="Page views" value={fmtCount(k.views)} foot={`${k.sessions} sessions`} hint="Pages opened in the period" />
            <Tile label="Avg session" value={fmtDuration(k.avgSessionMin)} foot="active time per session" hint="Active minutes ÷ sessions" />
            <Tile label="Total time" value={fmtDuration(k.totalMin)} foot="all users, all sessions" hint="Every active minute in the period" />
          </div>

          <div className="ugrid ugrid--2">
            <ChartCard
              title="Activity"
              note={`last ${r.range.days} days · Asia/Kuwait`}
              table={
                <DataTable
                  columns={[
                    { key: 'day', label: 'Day', format: fmtDay },
                    { key: 'views', label: 'Page views', num: true },
                    { key: 'users', label: 'Active users', num: true },
                    { key: 'logins', label: 'Logins', num: true },
                  ]}
                  rows={[...r.daily].reverse()}
                  maxHeight={300}
                />
              }
            >
              <ActivityChart daily={r.daily} />
            </ChartCard>
            <ChartCard
              title="When people work"
              note="active time by hour of day"
              table={
                <DataTable
                  columns={[
                    { key: 'hour', label: 'Hour', format: (h) => `${String(h).padStart(2, '0')}:00` },
                    { key: 'minutes', label: 'Active time', num: true, format: fmtDuration },
                  ]}
                  rows={r.hours}
                  maxHeight={300}
                />
              }
            >
              <HoursChart hours={r.hours} />
            </ChartCard>
          </div>

          <div className="ugrid ugrid--3">
            <ChartCard title="Most visited" note="page views">
              <BarList rows={r.mostVisited} value={(p) => p.views} format={fmtCount} />
            </ChartCard>
            <ChartCard title="Where time goes" note="active time on page">
              <BarList rows={r.timeSpent} value={(p) => p.minutes} format={fmtDuration} />
            </ChartCard>
            <ChartCard title="How they connect" note="sessions by device · browser · OS">
              <div className="counts-row">
                <Counts title="Devices" rows={r.connect.devices} />
                <Counts title="Browsers" rows={r.connect.browsers} />
                <Counts title="OS" rows={r.connect.os} />
              </div>
            </ChartCard>
          </div>

          <section className="panel ucard">
            <header className="ucard__head">
              <h2>People</h2>
              <span className="ucard__note">
                {r.people.length} active in the last {r.range.days} days
              </span>
            </header>
            <div className="ucard__body">
              <DataTable
                columns={[
                  {
                    key: 'name',
                    label: 'User',
                    searchKeys: ['email'],
                    format: (v, row) => (
                      <span className="who">
                        <strong>{v || row.email.split('@')[0]}</strong>
                        <span>{row.email}</span>
                      </span>
                    ),
                  },
                  { key: 'logins', label: 'Logins', num: true },
                  { key: 'views', label: 'Views', num: true },
                  { key: 'sessions', label: 'Sessions', num: true },
                  { key: 'minutes', label: 'Time', num: true, format: fmtDuration, strong: true },
                  { key: 'spark', label: 'Daily', search: false, format: (v) => <Spark values={v} />, hint: 'Active time per day, oldest to newest' },
                  { key: 'daysActive', label: 'Days active', num: true },
                  { key: 'lastSeen', label: 'Last seen', num: true, format: (v) => shortAgo(v) },
                  { key: 'lastPage', label: 'Last page', format: pageName },
                  { key: 'device', label: 'Device' },
                ]}
                rows={r.people}
                searchPlaceholder="Find someone…"
                maxHeight={420}
              />
            </div>
          </section>

          <div className="ugrid ugrid--2">
            <section className="panel ucard">
              <header className="ucard__head">
                <h2>Recent sessions</h2>
                <span className="ucard__note">newest first</span>
              </header>
              <div className="ucard__body">
                <DataTable
                  columns={[
                    { key: 'email', label: 'User' },
                    { key: 'started', label: 'Started', num: true, format: fmtStamp },
                    { key: 'lengthMin', label: 'Length', num: true, format: fmtDuration, hint: 'From the first to the last activity in the session' },
                    { key: 'activeMin', label: 'Active', num: true, format: fmtDuration, hint: 'Minutes in use; idle time excluded' },
                    { key: 'views', label: 'Views', num: true },
                  ]}
                  rows={r.sessions}
                  maxHeight={420}
                />
              </div>
            </section>

            <section className="panel ucard">
              <header className="ucard__head">
                <h2>Live feed</h2>
                <span className="ucard__note">most recent events · refreshes every 30s</span>
              </header>
              <ul className="feed">
                {r.feed.map((e, i) => (
                  <li key={`${e.t}-${i}`}>
                    <span className={`badge badge--${e.type}`}>{BADGE[e.type] ?? e.type}</span>
                    <strong className="feed__who">{e.name || e.email}</strong>
                    <span className="feed__page">{e.page ? pageName(e.page) : 'Signed in'}</span>
                    <span className="feed__when">{shortAgo(e.t)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
