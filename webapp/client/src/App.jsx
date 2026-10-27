import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { DateRange } from './components/DateRange.jsx'
import { IconBox, IconCompare, IconDaily, IconGrid, IconPin, IconShield } from './components/Icons.jsx'
import { MultiSelect } from './components/MultiSelect.jsx'
import { Rail } from './components/Rail.jsx'
import { DEFAULT_TARGET, TargetInput } from './components/TargetInput.jsx'
import { TopBar } from './components/TopBar.jsx'
import { Empty } from './components/ui.jsx'
import { periodLabel, relativeTime } from './format.js'
import { Admin } from './pages/Admin.jsx'
import { Comparison } from './pages/Comparison.jsx'
import { DailyCritical } from './pages/DailyCritical.jsx'
import { Summary } from './pages/Summary.jsx'
import { useTheme } from './theme.js'
import { useUsageTracking } from './usage.js'
import { useData } from './useData.js'

/**
 * The report's three visible pages, plus Admin.
 *
 * `dateGroup` mirrors the report's slicer sync: Summary and Comparison share
 * one date range, the Daily Critical Report keeps its own.
 */
const PAGES = [
  {
    id: 'daily',
    label: 'Daily Critical Report',
    Icon: IconDaily,
    blurb: 'Critical stock counts — opening, movements, closing and variance by item and day.',
    slicers: ['locations', 'articles', 'date'],
    dateGroup: 'daily',
  },
  {
    id: 'summary',
    label: 'Summary - Critical Inventory',
    Icon: IconGrid,
    blurb: 'Variance by item across every count day.',
    slicers: ['locations', 'articles', 'date'],
    dateGroup: 'shared',
  },
  {
    id: 'comparison',
    label: 'Comparison Report',
    Icon: IconCompare,
    blurb: 'Actual variance against the target variance, day by day.',
    slicers: ['date', 'target'],
    dateGroup: 'shared',
  },
  {
    id: 'admin',
    label: 'Admin',
    Icon: IconShield,
    blurb: 'Who can sign in, what each person sees, and how the dashboard is used.',
    slicers: [],
    adminOnly: true,
  },
]

const EMPTY_SLICERS = { locations: [], articles: [] }
const EMPTY_DATES = { dateFrom: null, dateTo: null }
const DEFAULT_STATE = {
  page: 'daily',
  slicers: { daily: EMPTY_SLICERS, summary: EMPTY_SLICERS },
  dates: { daily: EMPTY_DATES, shared: EMPTY_DATES },
  target: DEFAULT_TARGET,
}

/* Filters and the open page are remembered in this browser only. */
const STORE = 'ci-view'

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null')
    if (!saved || typeof saved !== 'object') return DEFAULT_STATE
    return {
      page: typeof saved.page === 'string' ? saved.page : DEFAULT_STATE.page,
      slicers: { ...DEFAULT_STATE.slicers, ...saved.slicers },
      dates: { ...DEFAULT_STATE.dates, ...saved.dates },
      target: saved.target === null || typeof saved.target === 'number' ? saved.target : DEFAULT_TARGET,
    }
  } catch {
    return DEFAULT_STATE
  }
}

function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function App({ session, onSignedOut }) {
  const { user } = session
  const theme = useTheme()
  const [view, setView] = useState(loadState)
  const [nonce, setNonce] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [loadedAt, setLoadedAt] = useState(null)
  const [, setTick] = useState(0)

  /** Only what this person may open. The server refuses the rest regardless. */
  const pages = useMemo(
    () => PAGES.filter((p) => (p.adminOnly ? user.isAdmin : user.isAdmin || user.pages?.includes(p.id))),
    [user]
  )

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(view))
    } catch {
      /* remembered for this visit only */
    }
  }, [view])

  // Keeps "updated N mins ago" current.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const page = pages.find((p) => p.id === view.page) ?? pages[0] ?? null
  const isReport = Boolean(page && !page.adminOnly)
  useUsageTracking(page?.id ?? null)
  const slicers = (page && view.slicers[page.id]) ?? EMPTY_SLICERS
  const dates = (page?.dateGroup && view.dates[page.dateGroup]) ?? EMPTY_DATES

  /** What the server receives: only the slicers this page has. */
  const filters = useMemo(() => {
    if (!isReport) return {}
    return {
      ...(page.slicers.includes('locations') ? { locations: slicers.locations } : {}),
      ...(page.slicers.includes('articles') ? { articles: slicers.articles } : {}),
      ...dates,
    }
  }, [isReport, page, slicers, dates])

  const options = useData(api.slicers, filters, { enabled: isReport, nonce })
  const opts = options.data ?? {}

  const setSlicer = (key) => (value) =>
    setView((v) => ({ ...v, slicers: { ...v.slicers, [page.id]: { ...slicers, [key]: value } } }))
  const setDates = (value) => setView((v) => ({ ...v, dates: { ...v.dates, [page.dateGroup]: value } }))
  const setTarget = (value) => setView((v) => ({ ...v, target: value }))

  const canReset =
    isReport &&
    Boolean(
      slicers.locations?.length ||
        slicers.articles?.length ||
        dates.dateFrom ||
        dates.dateTo ||
        (page.slicers.includes('target') && view.target !== DEFAULT_TARGET)
    )
  const reset = () =>
    setView((v) => ({
      ...v,
      slicers: { ...v.slicers, [page.id]: EMPTY_SLICERS },
      dates: { ...v.dates, [page.dateGroup]: EMPTY_DATES },
      ...(page.slicers.includes('target') ? { target: DEFAULT_TARGET } : {}),
    }))

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await api.clearCache()
    } catch {
      /* the refetch below still happens and will show any error */
    }
    setNonce((n) => n + 1)
    setRefreshing(false)
  }, [])

  const onLoaded = useCallback(() => setLoadedAt(Date.now()), [])

  const period = periodLabel(dates.dateFrom, dates.dateTo)
  const firstName = (user.name || '').trim().split(/\s+/)[0]
  const restricted = Array.isArray(user.locations)

  const pills = isReport ? (
    <>
      {page.slicers.includes('locations') && (
        <MultiSelect
          icon={<IconPin size={16} />}
          noun="location"
          plural={restricted ? 'my locations' : 'locations'}
          options={opts.locations}
          value={slicers.locations}
          onChange={setSlicer('locations')}
          loading={options.loading}
        />
      )}
      {page.slicers.includes('articles') && (
        <MultiSelect
          icon={<IconBox size={16} />}
          noun="item"
          plural="items"
          options={opts.articles}
          value={slicers.articles}
          onChange={setSlicer('articles')}
          loading={options.loading}
        />
      )}
      {page.slicers.includes('target') && <TargetInput value={view.target} onChange={setTarget} />}
      {page.slicers.includes('date') && (
        <DateRange value={dates} onChange={setDates} min={opts.dateMin} max={opts.dateMax} />
      )}
    </>
  ) : null

  return (
    <div className="shell">
      <Rail pages={pages} current={page?.id} onChange={(id) => setView((v) => ({ ...v, page: id }))} />

      <div className="main">
        <TopBar
          filters={pills}
          canReset={canReset}
          onReset={reset}
          busy={options.loading && Boolean(options.data)}
          onRefresh={refresh}
          refreshing={refreshing}
          theme={theme}
          user={user}
          onSignOut={onSignedOut}
        />

        <main className="content">
          <div className="hello">
            <div>
              <h1 className="hello__title">
                {greeting()}
                {firstName ? `, ${firstName}` : ''}
              </h1>
              {page && (
                <p className="hello__sub">
                  <strong>{page.label}</strong> · {page.blurb}
                </p>
              )}
            </div>
            {isReport && (
              <span className="live" title="Figures are read from the published Power BI semantic model">
                <span className="live__dot" aria-hidden="true" />
                Live Power BI
                {loadedAt && <span className="live__when">· updated {relativeTime(loadedAt)}</span>}
              </span>
            )}
          </div>

          {!page && (
            <section className="panel">
              <Empty title="No pages have been shared with you yet" hint="Ask an administrator for access." />
            </section>
          )}
          {page?.id === 'daily' && <DailyCritical filters={filters} period={period} nonce={nonce} onLoaded={onLoaded} />}
          {page?.id === 'summary' && <Summary filters={filters} period={period} nonce={nonce} onLoaded={onLoaded} />}
          {page?.id === 'comparison' && (
            <Comparison filters={filters} target={view.target} period={period} nonce={nonce} onLoaded={onLoaded} />
          )}
          {page?.id === 'admin' && <Admin me={user.email} />}
        </main>
      </div>
    </div>
  )
}
