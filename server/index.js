import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { gzip } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { config, missingSettings, missingSignIn } from './config.js'
import { attachUser } from './auth/middleware.js'
import { admin } from './routes/admin.js'
import { api } from './routes/api.js'
import { auth } from './routes/auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.join(__dirname, '..', 'client', 'dist')

const app = express()
// Behind IIS or a reverse proxy this makes req.ip the real client address.
app.set('trust proxy', 0)
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

// Every request learns who is signed in; individual routes decide what that means.
app.use(attachUser)

/*
 * JSON responses are compressed when the browser accepts it.
 *
 * Written against node's own zlib rather than pulling in a package, and
 * asynchronous so compressing a large payload never stalls the event loop.
 */
const MIN_GZIP = 1400

const wantsGzip = (req) => /\bgzip\b/.test(req.headers['accept-encoding'] || '')

app.use((req, res, next) => {
  if (!wantsGzip(req)) return next()
  const plain = res.json.bind(res)

  res.json = (body) => {
    let text
    try {
      text = JSON.stringify(body)
    } catch {
      return plain(body)
    }
    // Below about one packet the gzip header costs more than it saves.
    if (text.length < MIN_GZIP) return plain(body)

    gzip(text, (err, buf) => {
      if (err) return plain(body)
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Content-Encoding', 'gzip')
      res.setHeader('Vary', 'Accept-Encoding')
      res.setHeader('Content-Length', buf.length)
      res.end(buf)
    })
    return res
  }

  next()
})

app.use('/api/auth', auth)
app.use('/api/admin', admin)
app.use('/api', api)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))

/*
 * index.html must never be cached: it is the only file that knows which hashed
 * bundles are current, and a stale copy asks for bundles that no longer exist.
 */
const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

// Serve the built SPA in production; in dev, Vite serves it and proxies /api.
app.use(
  express.static(clientDist, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) noStore(res)
    },
  })
)
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  if (!fs.existsSync(path.join(clientDist, 'index.html'))) return next()
  noStore(res)
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next()
  })
})

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
app.use((err, req, res, next) => {
  const status = err.status || 500
  if (status >= 500) console.error(`[api] ${req.method} ${req.originalUrl.split('?')[0]}`, err)
  res.status(status).json({ error: err.message || 'Internal error' })
})

/*
 * A stray promise must not take the site down. Node ends the process on an
 * unhandled rejection; staying up with one broken background task beats
 * dropping every request in flight.
 */
process.on('unhandledRejection', (reason) => {
  console.error('  [unhandledRejection]', reason)
})

const server = app.listen(config.port, () => {
  console.log(`\n  Critical Inventory API  ->  http://localhost:${config.port}`)
  console.log('  Mode: POWER BI executeQueries')
  const missing = [...new Set([...missingSettings(), ...missingSignIn()])]
  if (missing.length) console.log(`  WARNING: missing .env settings -> ${missing.join(', ')}`)
  if (config.localLogin.enabled) {
    console.log(`  WARNING: temporary password sign-in is ON for ${config.localLogin.email}.`)
    console.log('           Remove LOCAL_LOGIN_EMAIL / LOCAL_LOGIN_PASSWORD from .env once Microsoft sign-in works.')
  } else if (config.localLogin.problem) {
    console.log(`  Password sign-in is off: ${config.localLogin.problem}`)
  }
  console.log('')
})

// A dead API behind a live Vite proxy shows up in the browser only as a vague
// "Request failed (500)", so say plainly what happened and how to clear it.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ERROR: port ${config.port} is already in use.\n`)
    console.error('  Another copy of the API is still running. Free the port, then start again:')
    console.error(`    PowerShell:  Get-NetTCPConnection -LocalPort ${config.port} -State Listen |`)
    console.error('                 ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }\n')
    process.exit(1)
  }
  console.error('[server]', err)
  process.exit(1)
})
