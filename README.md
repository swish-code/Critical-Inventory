# Critical Inventory — web app

A Node/React front end for the Critical Inventory Power BI report. It reads the
published semantic model over the Power BI REST API (`executeQueries`) and
reuses the model's own DAX measures, so the numbers match the dashboard rather
than re-deriving them.

The report's measures and visuals are documented by `../pbip-reference`, a
read-only blueprint that is not part of the app code.

## Running it (local testing)

One-time:

```powershell
npm.cmd run install:all     # server + client dependencies
Copy-Item .env.example .env # then fill in .env
```

Every time:

```powershell
npm.cmd run dev
```

Then open **http://localhost:7011** — use `localhost`, not `127.0.0.1`, so the
session cookie set by the sign-in callback applies to the page.

Use `npm.cmd`, not plain `npm`, in PowerShell if the execution policy blocks
`npm.ps1`.

`npm run dev` starts two processes together:

- the **API** on port 7010 (talks to Power BI, handles sign-in)
- the **web page** on port 7011 (what you look at), which forwards its `/api`
  calls to 7010

Both reload automatically when a file changes. Stop them with `Ctrl+C`.
Sessions are held in memory, so a server restart signs you out.

`npm test` runs the server unit tests.

### Production

`npm run build` produces `client/dist` and `npm start` serves the whole app
from port 7010 as a single process. Serve it over HTTPS and leave
`COOKIE_INSECURE` unset.

## Configuration (`.env`)

| Key | Meaning |
|---|---|
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | Entra ID app registration: the Power BI service principal and the sign-in client |
| `MS_REDIRECT_URI` | Sign-in callback, registered on the app registration (platform **Web**) |
| `PBI_WORKSPACE_ID` / `PBI_DATASET_ID` | The workspace and the one semantic model this app reads |
| `ADMIN_EMAILS` | Comma-separated administrators. Always allowed to sign in |
| `ALLOWED_EMAILS` | Comma-separated addresses that may sign in |
| `LOCAL_LOGIN_EMAIL` / `LOCAL_LOGIN_PASSWORD` | **Temporary** email + password sign-in for local testing (one admin account, password 12+ characters). Delete both to turn it off |
| `SESSION_TTL_HOURS` | Session lifetime, default `12` |
| `COOKIE_INSECURE` | `1` drops the cookie `Secure` flag — local http development only |
| `PORT` | API port, default `7010` |
| `APP_ORIGIN` | Where the browser lands after sign-in; `http://localhost:7011` in dev |
| `CACHE_TTL` | Seconds each DAX result is cached in memory, default `120` |

`.env` holds a client secret and is gitignored — keep it that way, and rotate
the secret if it is ever committed or shared.

## Entra ID setup

1. **Redirect URI** — on the app registration, *Authentication → Add a
   platform → Web*, add `http://localhost:7010/api/auth/microsoft/callback`
   (and the production URL later). It must match `MS_REDIRECT_URI` exactly.
2. **Single tenant** — sign-in uses the tenant's own endpoint and rejects
   tokens from any other tenant; only addresses in `ADMIN_EMAILS` /
   `ALLOWED_EMAILS` get a session.
3. **Power BI access** — add the app registration to the workspace as
   **Contributor** (Viewer is not enough: `executeQueries` needs Build
   permission). Power BI's *Add people* box resolves by display name, not
   client ID. The tenant settings "Service principals can use Fabric APIs" and
   "Dataset Execute Queries REST API" must be enabled.

## Sign-in flow

The sign-in button calls `/api/auth/microsoft/start` (through the Vite proxy),
which redirects to Microsoft. Microsoft returns the browser **directly to the
API** at `MS_REDIRECT_URI` on port 7010; the API sets an HttpOnly session
cookie and redirects to `APP_ORIGIN`. Cookies are shared across ports on the
same host, so the page on 7011 then sends the cookie with every `/api` call.

## API

| Route | Access | Purpose |
|---|---|---|
| `GET /api/health` | public | Which settings are missing (names only) |
| `GET /api/auth/methods` | public | Whether Microsoft sign-in is configured |
| `GET /api/auth/microsoft/start` | public | Begins sign-in |
| `GET /api/auth/microsoft/callback` | public | Microsoft's redirect target |
| `POST /api/auth/logout` | public | Ends the session |
| `GET /api/auth/me` | session | The signed-in user |
| `POST /api/auth/local` | public | Temporary password sign-in (only while `LOCAL_LOGIN_*` is set) |
| `GET /api/model/check` | session | One-row DAX round trip to the semantic model |
| `GET /api/model/test` | admin | Reads one real measure, checking token → workspace → dataset → query |
| `POST /api/slicers` | session | Location / item options (cross-filtered) and the date extent |
| `POST /api/daily/kpis`, `/api/daily/table` | page: daily | Daily Critical Report cards, table and totals |
| `POST /api/summary/matrix` | page: summary | Summary matrix with every subtotal from the model |
| `POST /api/comparison` | page: comparison | Comparison table and totals (`target` 0–100, default 10) |
| `GET/POST/PATCH/DELETE /api/admin/users` | admin | Manage users and their access |
| `GET /api/admin/locations` | admin | Every location, for the access picker |
| `GET /api/admin/usage?days=7\|14\|30` | admin | Usage analytics report |
| `POST /api/usage/event` | session | Browser usage tracking: a page view, or one active minute |
| `POST /api/cache/clear` | session | Empties the server cache |

Every other `/api` route sits behind the session and answers 401 without one.

## Usage analytics (Admin page)

- The browser records a page view when a page opens, and one "active minute"
  per minute while the tab is visible and has been used (mouse, keys, scroll)
  in the last 10 minutes — idle time is never counted. Sign-ins are recorded
  by the server.
- Events go to `data/usage.jsonl` (gitignored) and are kept for 90 days. The
  session id stored is a hash, never the session cookie.
- Days and hours are Kuwait time (UTC+3, no daylight saving).
- The report is built on request from `server/usage/report.js`; only
  administrators can read it.

## Users and access (Admin page)

- **Administrators** see every page and location and manage users. Everyone in
  `ADMIN_EMAILS` is a permanent administrator — they cannot be edited or
  removed in the app, so access can never be locked out.
- **Viewers** see only the pages and locations given to them on the Admin page.
  Both are enforced by the server on every request; changes apply on the
  person's next request, without signing out.
- `ALLOWED_EMAILS` still lets people in as viewers with full access; add them on
  the Admin page to narrow what they see.
- Users are stored in `data/users.json` (gitignored). `server/auth/store.js` is
  the only module that reads it — the seam for a database later.
- Sales KD on the Comparison page is the whole business's sales for the day:
  the model has no link between sales and inventory locations, exactly as in
  the Power BI report, so a location restriction narrows the variance figures
  but not the sales.

## Layout

```
server/
  index.js             express setup, gzip, routers, static SPA, error handling
  config.js            env parsing, required-settings check
  cache.js             TTL memory cache, de-duplicates in-flight queries
  routes/api.js        /api/health and the session-protected data routes
  routes/auth.js       Microsoft sign-in, logout, me
  auth/microsoft.js    OIDC authorization code + PKCE, tenant checks
  auth/accounts.js     allow-list (the seam for a users table later)
  auth/sessions.js     in-memory sessions + cookie helpers (the seam for a store later)
  auth/middleware.js   attachUser, requireAuth
  powerbi/auth.js      client-credentials token, cached until 60s before expiry
  powerbi/client.js    executeQuery: retries, adaptive concurrency, row normalisation
  powerbi/dax.js       generic DAX helpers (lit, filterArgs, summarize, evaluate)
  routes/admin.js      Admin page: users and access
  auth/store.js        users kept in data/users.json
  powerbi/critical.js  the report's queries (cards, table, matrix, comparison)
client/
  index.html           welcome screen shown while the app loads
  src/Shell.jsx        session check: login screen or app
  src/App.jsx          frame: rail, top bar, filters per page
  src/api.js           fetch wrapper, 401 handling, read retries
  src/useData.js       debounced fetch hook, aborts superseded requests
  src/pages/           Login, DailyCritical, Summary, Comparison, Admin
  src/components/      rail, top bar, slicers, date range, cards, table
  src/styles/          tokens.css (colours, light/dark) and app.css
docs/                  project documentation
```
