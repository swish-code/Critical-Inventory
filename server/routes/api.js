import { Router } from 'express'
import { cached, clearCache } from '../cache.js'
import { config, missingSettings, missingSignIn } from '../config.js'
import { requireAdmin, requireAuth, requirePage } from '../auth/middleware.js'
import { getAccessToken } from '../powerbi/auth.js'
import { executeQuery, restGet } from '../powerbi/client.js'
import * as q from '../powerbi/critical.js'
import { evaluate } from '../powerbi/dax.js'
import { recordActivity } from '../usage/track.js'
import { applyScope, filterKey, NO_LOCATION, parseFilters, parseTarget } from './filters.js'

export const api = Router()

/** Wrap a handler so thrown errors reach the Express error middleware. */
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)

/**
 * Public on purpose: an uptime monitor must reach it without credentials, and
 * it exposes only which settings are missing, never their values or any data.
 */
api.get('/health', (req, res) => {
  res.json({
    ok: true,
    signedIn: Boolean(req.user),
    missingSettings: missingSettings(),
    missingSignIn: missingSignIn(),
  })
})

// Everything below this line requires a session.
api.use(requireAuth)

/**
 * Can the server reach the semantic model?
 *
 * The smallest possible round trip — a one-row DAX table — so it proves the
 * token, the workspace access and the dataset id without knowing anything
 * about the model's tables.
 */
api.get('/model/check', handle(async (req, res) => {
  const started = Date.now()
  const rows = await cached('model:check', () => executeQuery(evaluate('ROW("ok", 1)')), { seconds: 30 })
  res.json({ ok: rows[0]?.ok === 1, ms: Date.now() - started })
}))

/**
 * One real measure from the model, with each link in the chain checked in turn.
 *
 * When a query fails, Power BI's own answer rarely says which permission is
 * missing - a workspace the principal cannot see comes back as 404, not 403. So
 * this walks the chain and stops at the first link that breaks:
 *
 *   token      the app registration can get a Power BI token at all
 *   workspace  the service principal is a member of the workspace
 *   dataset    the semantic model id exists in that workspace
 *   query      executeQueries is allowed (Build permission + tenant settings)
 */
const TEST_MEASURE = "'critical measures'[Critical Closing Stock]"

const CAUSES = {
  token: 'The token request failed: check MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET (and that the secret has not expired).',
  workspace: 'The service principal cannot see the workspace: add the app registration to it as Contributor (or Member), and check PBI_WORKSPACE_ID.',
  dataset: 'The workspace is visible but the semantic model is not: check PBI_DATASET_ID is a dataset in that workspace.',
  query: 'The model is visible but the query was refused: the principal needs Build permission on the semantic model (Contributor grants it, Viewer does not), and the tenant settings "Service principals can use Fabric APIs" and "Dataset Execute Queries REST API" must be enabled.',
}

api.get('/model/test', requireAdmin, handle(async (req, res) => {
  const { workspaceId, datasetId } = config.pbi
  const steps = []
  const fail = (step, detail) => {
    steps.push({ step, ok: false, detail })
    res.json({ ok: false, failedAt: step, cause: CAUSES[step], steps })
  }

  try {
    await getAccessToken()
    steps.push({ step: 'token', ok: true })
  } catch (err) {
    return fail('token', err.message)
  }

  const ws = await restGet(`/groups?$filter=${encodeURIComponent(`id eq '${workspaceId}'`)}`)
  if (!ws.ok || !ws.json?.value?.length) {
    return fail('workspace', ws.ok ? 'Not in the list of workspaces this principal can see.' : `HTTP ${ws.status}`)
  }
  steps.push({ step: 'workspace', ok: true, detail: ws.json.value[0].name })

  const ds = await restGet(`/groups/${workspaceId}/datasets/${datasetId}`)
  if (!ds.ok) return fail('dataset', `HTTP ${ds.status}`)
  steps.push({ step: 'dataset', ok: true, detail: ds.json?.name })

  const started = Date.now()
  try {
    const rows = await executeQuery(evaluate(`ROW("value", ${TEST_MEASURE})`))
    steps.push({ step: 'query', ok: true, detail: `${Date.now() - started} ms` })
    res.json({ ok: true, measure: TEST_MEASURE, value: rows[0]?.value ?? null, steps })
  } catch (err) {
    fail('query', err.message)
  }
}))

/*
 * Page routes. `api.all` so the client can send its filter state as a JSON
 * body. Each one parses the body down to known keys and then applies the
 * user's location access, BEFORE any DAX is built — the browser cannot widen
 * what a user sees by editing a request.
 */

/** The request's filters with this user's location access applied. */
function scopedFilters(req) {
  return applyScope(parseFilters(req.body), req.user)
}

/** Slicer options (each narrowed by the other slicers) and the date extent. */
api.all('/slicers', handle(async (req, res) => {
  const { filters: f, scope } = scopedFilters(req)
  const locationScope = scope && !scope.length ? [NO_LOCATION] : scope
  const key = filterKey(f)
  const [locations, articles, bounds] = await Promise.all([
    cached(`slicers:locations:${key}:${filterKey(locationScope)}`, () =>
      executeQuery(q.locationOptionsQuery(f, locationScope))
    ),
    cached(`slicers:articles:${key}`, () => executeQuery(q.articleOptionsQuery(f))),
    cached('slicers:dates', () => executeQuery(q.dateBoundsQuery())),
  ])
  res.json({
    locations: locations.map((r) => r.Location).filter(Boolean),
    articles: articles.map((r) => r.Article).filter(Boolean),
    dateMin: q.day(bounds[0]?.minDate),
    dateMax: q.day(bounds[0]?.maxDate),
  })
}))

/** Daily Critical Report — the six cards. */
api.all('/daily/kpis', requirePage('daily'), handle(async (req, res) => {
  const { filters: f } = scopedFilters(req)
  const rows = await cached(`daily:kpis:${filterKey(f)}`, () => executeQuery(q.dailyKpisQuery(f)))
  res.json(q.unprefix(rows[0], q.DAILY_KPIS, 'k_'))
}))

/** Summary - Critical Inventory — the matrix with every total from the model. */
api.all('/summary/matrix', requirePage('summary'), handle(async (req, res) => {
  const { filters: f } = scopedFilters(req)
  const key = filterKey(f)
  const [cells, units] = await Promise.all([
    cached(`summary:matrix:${key}`, () => executeQuery(q.summaryMatrixQuery(f), { bulk: true })),
    cached(`summary:units:${key}`, () => executeQuery(q.summaryUnitsQuery(f))),
  ])
  res.json(q.shapeMatrix(cells, units))
}))

/** Comparison Report — one row per count day, and the totals row. */
api.all('/comparison', requirePage('comparison'), handle(async (req, res) => {
  const { filters: f } = scopedFilters(req)
  // The Comparison page has no Location or Article slicer; only the dates and
  // the user's own location access apply.
  const page = { ...f, articles: [] }
  const target = parseTarget(req.body?.target)
  const key = `${filterKey(page)}:${target}`
  const [rows, totals] = await Promise.all([
    cached(`comparison:rows:${key}`, () => executeQuery(q.comparisonQuery(page, target))),
    cached(`comparison:totals:${key}`, () => executeQuery(q.comparisonTotalsQuery(page, target))),
  ])
  res.json({
    target,
    rows: rows.map((r) => ({ date: q.day(r.Date), ...q.unprefix(r, q.COMPARISON, 'c_') })),
    totals: q.unprefix(totals[0], q.COMPARISON, 'c_'),
  })
}))

/** Daily Critical Report — the table and its totals row. */
api.all('/daily/table', requirePage('daily'), handle(async (req, res) => {
  const { filters: f } = scopedFilters(req)
  const key = filterKey(f)
  const [rows, totals] = await Promise.all([
    cached(`daily:table:${key}`, () => executeQuery(q.dailyTableQuery(f), { bulk: true })),
    cached(`daily:totals:${key}`, () => executeQuery(q.dailyTotalsQuery(f))),
  ])
  res.json({
    rows: rows.map(q.shapeDailyRow),
    totals: q.unprefix(totals[0], q.DAILY_COLUMNS, 'q_'),
  })
}))

/**
 * Usage tracking from the browser: a page view, or one active minute ("beat").
 * Always answers 204 — a tracking hiccup must never surface as an error.
 */
api.post('/usage/event', (req, res) => {
  recordActivity(req.user, req.sessionToken, req, { type: req.body?.type, page: req.body?.page })
  res.status(204).end()
})

api.post('/cache/clear', (req, res) => {
  clearCache()
  res.json({ ok: true })
})
