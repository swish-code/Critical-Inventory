import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Usage events, one JSON object per line in the gitignored /data folder.
 *
 *   { t, type, email, name, sid, page, device, browser, os }
 *   type  'login' | 'view' | 'beat'   (a beat is one active minute on a page)
 *   sid   a short hash of the session cookie — groups events into sessions
 *         without storing anything that could be replayed as a login
 *
 * Held in memory for the report and appended to the file as they arrive.
 * Events older than the retention window are dropped when the file is read,
 * and the file is rewritten without them.
 */

export const RETENTION_DAYS = 90
const DAY_MS = 86_400_000

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let file = path.resolve(__dirname, '..', '..', 'data', 'usage.jsonl')
let events = null
let writing = Promise.resolve()

/** Points the store at another file — tests only. */
export function useUsageFile(p) {
  file = p
  events = null
}

function load() {
  if (events) return events
  events = []
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`  [usage] could not read ${file}: ${err.message}`)
    return events
  }
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS
  let dropped = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (e.t >= cutoff) events.push(e)
      else dropped++
    } catch {
      dropped++ // a half-written last line after a crash
    }
  }
  if (dropped) {
    try {
      fs.writeFileSync(`${file}.tmp`, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''))
      fs.renameSync(`${file}.tmp`, file)
    } catch (err) {
      console.warn(`  [usage] could not compact ${file}: ${err.message}`)
    }
  }
  return events
}

export const allEvents = () => load()

/** Records one event. Never throws: usage tracking must not break the app. */
export function record(event) {
  const e = { t: Date.now(), ...event }
  load().push(e)
  writing = writing
    .then(() => fs.promises.mkdir(path.dirname(file), { recursive: true }))
    .then(() => fs.promises.appendFile(file, JSON.stringify(e) + '\n'))
    .catch((err) => console.warn(`  [usage] could not write an event: ${err.message}`))
  return e
}

/** Waits for pending writes — tests only. */
export const flushed = () => writing
