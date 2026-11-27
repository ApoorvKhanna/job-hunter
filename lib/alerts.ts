// Weekly job alerts. Opt-in only: one saved search per user and, every
// Monday, one email with postings they have not been sent before. Nothing is
// sent unless the user turned it on from the results step.
//
// One private blob per user (`alerts/<sub>.json`), separate from the ledger
// so an alert write can never collide with a debit. Writes are ETag-checked
// like lib/ledger.ts, so the cron recording a send never undoes a user's
// opt-out made in the same moment.
//
// Cost: the cron only ever uses the cheap job source (`searchJobs`, about 1¢
// through the provider). The deep source (TheirStack) is never called here.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { BlobPreconditionFailedError, get, list, put } from '@vercel/blob'
import { isBlocked } from './blocks'
import { COUNTRIES } from './countries'
import { APP_URL, SESSION_SECRET } from './env'
import { postedOn } from './format'
import { jsearchEnabled, searchJobs } from './jsearch'
import { getAccount } from './ledger'
import { sendMail } from './mail'
import type { Job } from './types'

export interface Alert {
  sub: string
  email: string
  name: string
  titles: string[]
  /** ISO 3166-1 alpha-2, or null for any country. */
  country: string | null
  remote: boolean
  on: boolean
  createdAt: string
  /** The user's last change (on, off, or a new search). */
  updatedAt: string
  lastSentAt: string | null
  /** Postings already emailed, newest first, capped, so none is sent twice. */
  sentJobIds: string[]
}

/** What the jobs page needs to draw the toggle. */
export interface AlertView {
  on: boolean
  titles: string[]
  country: string | null
  remote: boolean
}

export interface AlertInput {
  on: boolean
  titles: string[]
  country: string | null
  remote: boolean
}

export const MAX_TITLES = 5
export const SENT_CAP = 200
export const JOBS_PER_EMAIL = 8
/** The search window each Monday. */
export const WINDOW_DAYS = 7
/** Alerts handled per run at most; the rest wait for the next run. */
export const RUN_CAP = 250
export const CONCURRENCY = 5
/** Stop starting new alerts after this long, well inside maxDuration (300s). */
const RUN_BUDGET_MS = 240_000
/** A second run in the same week (a retried cron, a manual trigger) sends nothing twice. */
const MIN_GAP_MS = 6 * 86_400_000

const SUB_RE = /^[A-Za-z0-9_-]{1,128}$/
const path = (sub: string) => `alerts/${sub}.json`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── input ────────────────────────────────────────────────────────────────────

/** Validate a toggle the way the jobs route validates a search: up to five
 *  titles, a two-letter country (anything else means any country), remote
 *  only when it is exactly true. */
export function parseAlertInput(body: unknown): { ok: true; input: AlertInput } | { ok: false; message: string } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>
  if (typeof b.on !== 'boolean') return { ok: false, message: 'Say whether the email is on or off.' }
  const raw = Array.isArray(b.titles) ? b.titles : []
  const seen = new Set<string>()
  const titles: string[] = []
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const clean = t.replace(/\s+/g, ' ').trim().slice(0, 100)
    if (!clean || seen.has(clean.toLowerCase())) continue
    seen.add(clean.toLowerCase())
    titles.push(clean)
  }
  if (b.on && titles.length === 0) return { ok: false, message: 'Add at least one job title.' }
  const cc = typeof b.country_code === 'string' && /^[A-Z]{2}$/i.test(b.country_code) ? b.country_code.toUpperCase() : null
  return { ok: true, input: { on: b.on, titles: titles.slice(0, MAX_TITLES), country: cc, remote: b.remote === true } }
}

// ── storage ──────────────────────────────────────────────────────────────────

function normalize(raw: Record<string, unknown>, sub: string): Alert {
  const a = raw as Partial<Alert>
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    sub: typeof a.sub === 'string' ? a.sub : sub,
    email: typeof a.email === 'string' ? a.email : '',
    name: typeof a.name === 'string' ? a.name : '',
    titles: strings(a.titles).slice(0, MAX_TITLES),
    country: typeof a.country === 'string' && /^[A-Z]{2}$/.test(a.country) ? a.country : null,
    remote: a.remote === true,
    on: a.on === true,
    createdAt: typeof a.createdAt === 'string' ? a.createdAt : new Date(0).toISOString(),
    updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : new Date(0).toISOString(),
    lastSentAt: typeof a.lastSentAt === 'string' ? a.lastSentAt : null,
    sentJobIds: strings(a.sentJobIds).slice(0, SENT_CAP),
  }
}

async function load(sub: string): Promise<{ alert: Alert; etag: string } | null> {
  const blob = await get(path(sub), { access: 'private', useCache: false })
  if (!blob) return null
  const text = await new Response(blob.stream).text()
  // Same as the ledger: the store's ifMatch only takes the strong validator.
  const etag = (blob.headers?.get('etag') ?? blob.headers?.get('ETag') ?? '').replace(/^W\//, '')
  return { alert: normalize(JSON.parse(text) as Record<string, unknown>, sub), etag }
}

const isStale = (err: unknown) => err instanceof BlobPreconditionFailedError || /precondition/i.test(String((err as Error)?.message ?? ''))

/** Read, change, write with the ETag; retry when someone wrote in between.
 *  A new blob is only ever created, never blindly overwritten. `fn` returns
 *  null to write nothing. */
async function mutate(sub: string, fn: (current: Alert | null) => Alert | null): Promise<Alert | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await load(sub)
    const next = fn(found ? structuredClone(found.alert) : null)
    if (!next) return found?.alert ?? null
    try {
      await put(path(sub), JSON.stringify(next), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        ...(found ? { allowOverwrite: true, ...(found.etag ? { ifMatch: found.etag } : {}) } : { allowOverwrite: false }),
      })
      return next
    } catch (err) {
      // A stale ETag, or a parallel first write that created the blob first.
      const retry = isStale(err) || (!found && (await load(sub).catch(() => null)) !== null)
      if (!retry || attempt === 3) throw err
      await sleep(120 * (attempt + 1))
    }
  }
  throw new Error('alert_contention')
}

export async function getAlert(sub: string): Promise<Alert | null> {
  return (await load(sub))?.alert ?? null
}

export const viewOf = (a: Alert): AlertView => ({ on: a.on, titles: a.titles, country: a.country, remote: a.remote })

/** Turn the alert on for this search (replacing any earlier one), or off. */
export async function saveAlert(who: { sub: string; email: string; name: string }, input: AlertInput): Promise<Alert | null> {
  const now = new Date().toISOString()
  return mutate(who.sub, (cur) => {
    if (!input.on) return cur?.on ? { ...cur, on: false, updatedAt: now } : null
    return {
      sub: who.sub,
      email: who.email || cur?.email || '',
      name: who.name || cur?.name || '',
      titles: input.titles,
      country: input.country,
      remote: input.remote,
      on: true,
      createdAt: cur?.createdAt ?? now,
      updatedAt: now,
      lastSentAt: cur?.lastSentAt ?? null,
      // Kept across searches: a posting already sent is never sent again.
      sentJobIds: cur?.sentJobIds ?? [],
    }
  })
}

/** The unsubscribe link's action. Idempotent; no alert is fine. */
export async function turnOff(sub: string): Promise<void> {
  const now = new Date().toISOString()
  await mutate(sub, (cur) => (cur?.on ? { ...cur, on: false, updatedAt: now } : null))
}

async function recordSent(sub: string, ids: string[], at: string): Promise<void> {
  await mutate(sub, (cur) => {
    if (!cur) return null
    const fresh = new Set(ids)
    return { ...cur, lastSentAt: at, sentJobIds: [...ids, ...cur.sentJobIds.filter((id) => !fresh.has(id))].slice(0, SENT_CAP) }
  })
}

// ── unsubscribe link ─────────────────────────────────────────────────────────

/** HMAC-SHA256 of the sub under SESSION_SECRET, hex, first 32 characters.
 *  Prefixed so the same key can never be made to sign anything else. */
export function unsubscribeToken(sub: string): string {
  return createHmac('sha256', SESSION_SECRET).update(`alerts-unsubscribe:${sub}`).digest('hex').slice(0, 32)
}

export function validUnsubscribe(sub: string, token: string | null | undefined): boolean {
  if (!SESSION_SECRET || !token || !SUB_RE.test(sub)) return false
  const want = Buffer.from(unsubscribeToken(sub))
  const got = Buffer.from(token)
  return got.length === want.length && timingSafeEqual(got, want)
}

export const unsubscribeUrl = (sub: string) => `${APP_URL}/api/alerts/unsubscribe?u=${encodeURIComponent(sub)}&t=${unsubscribeToken(sub)}`

// ── the email ────────────────────────────────────────────────────────────────

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c])
/** One line of third-party text: no control characters, no long dashes, bounded. */
const line = (s: string, max = 140) =>
  s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s*[\u2013\u2014]\s*/g, ' - ').replace(/\s+/g, ' ').trim().slice(0, max)
function linkOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}
const firstName = (name: string) => line(name).split(' ')[0] || 'there'

export function describeSearch(a: Pick<Alert, 'titles' | 'country' | 'remote'>): string {
  const country = a.country ? (COUNTRIES.find((c) => c.code === a.country)?.name ?? a.country) : null
  return `${a.titles.map((t) => line(t, 80)).join(', ')}${country ? ` in ${country}` : ''}${a.remote ? ', remote only' : ''}`
}

/** Subject, plain text and HTML for one week's postings. */
export function buildAlertEmail(alert: Pick<Alert, 'sub' | 'name' | 'titles' | 'country' | 'remote'>, jobs: Job[]): { subject: string; text: string; html: string } {
  const n = jobs.length
  const role = line(alert.titles[0] ?? 'matching', 60)
  const subject = `${n} new ${role} ${n === 1 ? 'job' : 'jobs'} this week`
  const hi = firstName(alert.name)
  const search = describeSearch(alert)
  const cta = `${APP_URL}/jobs?utm_source=job-alert&utm_medium=email`
  const unsub = unsubscribeUrl(alert.sub)
  const rows = jobs.map((j) => {
    const title = line(j.title)
    const company = line(j.company, 100)
    const where = [line(j.location, 80), j.remote ? 'remote' : '', j.posted ? `posted ${postedOn(j.posted)}` : ''].filter(Boolean).join(', ')
    return { title, company, where, url: linkOf(j.url) }
  })

  const text = [
    `Hi ${hi},`,
    '',
    `${n === 1 ? 'One new posting' : `${n} new postings`} from the last 7 days for ${search}.`,
    '',
    ...rows.flatMap((r, i) => [`${i + 1}. ${r.title} at ${r.company}`, ...(r.where ? [`   ${r.where}`] : []), ...(r.url ? [`   ${r.url}`] : []), '']),
    `Find who's hiring: ${cta}`,
    '',
    'You get this because you turned on the Monday job email on Job Hunter.',
    `Unsubscribe: ${unsub}`,
    '',
    'Job Hunter',
  ].join('\n')

  const item = (r: (typeof rows)[number]) =>
    `<div style="padding:12px 0;border-top:1px solid #e6e6ea">` +
    (r.url
      ? `<a href="${esc(r.url)}" style="font-size:15px;font-weight:600;color:#1e2f96;text-decoration:none">${esc(r.title)}</a>`
      : `<span style="font-size:15px;font-weight:600">${esc(r.title)}</span>`) +
    `<div style="font-size:14px;margin-top:2px">${esc(r.company)}</div>` +
    (r.where ? `<div style="font-size:13px;color:#7a7f87;margin-top:2px">${esc(r.where)}</div>` : '') +
    `</div>`
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#1d1d1f">` +
    `<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7a7f87;margin:0 0 10px">Job Hunter</p>` +
    `<h1 style="font-size:22px;margin:0 0 14px">${esc(subject)}</h1>` +
    `<p style="font-size:15px;line-height:1.55;margin:0 0 14px">Hi ${esc(hi)}, here ${n === 1 ? 'is a new posting' : 'are new postings'} from the last 7 days for <b>${esc(search)}</b>.</p>` +
    rows.map(item).join('') +
    `<p style="margin:22px 0 26px"><a href="${esc(cta)}" style="display:inline-block;background:#1e2f96;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">Find who's hiring</a></p>` +
    `<p style="font-size:12px;color:#7a7f87;margin:0 0 6px">You get this because you turned on the Monday job email on Job Hunter.</p>` +
    `<p style="font-size:12px;color:#7a7f87;margin:0"><a href="${esc(unsub)}" style="color:#7a7f87">Unsubscribe</a></p>` +
    `</div>`
  return { subject, text, html }
}

// ── the weekly run ───────────────────────────────────────────────────────────

type Outcome = { kind: 'sent'; jobs: number } | { kind: 'skipped'; reason: string } | { kind: 'failed'; reason: string }

export interface RunStats {
  /** Alerts in the store. */
  alerts: number
  /** Alerts looked at this run; sent + skipped + failed. */
  checked: number
  sent: number
  skipped: number
  failed: number
  /** Not reached this run (the cap or the time budget). */
  deferred: number
  /** Postings emailed in total. */
  jobs: number
  reasons: Record<string, number>
  ms: number
}

async function alertOne(sub: string, now: number): Promise<Outcome> {
  const skip = (reason: string): Outcome => ({ kind: 'skipped', reason })
  const found = await load(sub)
  if (!found) return skip('gone')
  const a = found.alert
  if (!a.on) return skip('off')
  if (a.lastSentAt && now - Date.parse(a.lastSentAt) < MIN_GAP_MS) return skip('recent')
  if (a.titles.length === 0) return skip('no_titles')
  const account = await getAccount(sub)
  if (!account) return skip('no_account')
  if (await isBlocked('sub', sub)) return skip('blocked')
  const to = account.email || a.email
  if (!to) return skip('no_email')

  // The cheap source only, never the deep one.
  const res = await searchJobs({ titles: a.titles, countryCode: a.country, remoteOnly: a.remote, days: WINDOW_DAYS, page: 0 }, account)
  if (!res.ok) {
    console.error('[alerts] search failed', JSON.stringify({ sub, code: res.code }))
    return { kind: 'failed', reason: 'search' }
  }
  const sent = new Set(a.sentJobIds)
  const fresh = res.jobs.filter((j) => j.id && !sent.has(j.id)).slice(0, JOBS_PER_EMAIL)
  if (fresh.length === 0) return skip('nothing_new')

  const mail = buildAlertEmail({ ...a, name: account.name || a.name }, fresh)
  // List-Unsubscribe lets Gmail and others show their own unsubscribe button;
  // with the -Post header they POST to the link, which turns the alert off.
  const unsub = unsubscribeUrl(a.sub)
  const out = await sendMail({ to, subject: mail.subject, text: mail.text, html: mail.html, headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } })
  if (!out.ok) {
    console.error('[alerts] mail failed', JSON.stringify({ sub, code: out.detail ?? out.code }))
    return { kind: 'failed', reason: 'mail' }
  }
  try {
    await recordSent(sub, fresh.map((j) => j.id), new Date(now).toISOString())
  } catch (err) {
    // The email went out; only the record of it did not. Count it as sent.
    console.error('[alerts] sent but not recorded', sub, err)
  }
  return { kind: 'sent', jobs: fresh.length }
}

/** One weekly pass over every alert. Bounded (a cap per run, a time budget,
 *  a few at a time) and one user's failure never stops the rest. */
export async function runAlerts(opts: { now?: number; cap?: number; concurrency?: number; budgetMs?: number } = {}): Promise<RunStats | { error: string }> {
  const started = Date.now()
  const now = opts.now ?? started
  // Without the secret every unsubscribe link would be dead: send nothing.
  if (!SESSION_SECRET) return { error: 'no_session_secret' }
  if (!jsearchEnabled()) return { error: 'no_job_source' }

  const entries: Array<{ sub: string; at: number }> = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix: 'alerts/', cursor, limit: 1000 })
    for (const b of page.blobs) {
      const m = /^alerts\/([A-Za-z0-9_-]{1,128})\.json$/.exec(b.pathname)
      if (m) entries.push({ sub: m[1], at: b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0 })
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  // Least recently written first, so a capped run reaches everyone over time.
  entries.sort((x, y) => x.at - y.at)
  const queue = entries.slice(0, Math.max(0, opts.cap ?? RUN_CAP))

  const stats: RunStats = { alerts: entries.length, checked: 0, sent: 0, skipped: 0, failed: 0, deferred: 0, jobs: 0, reasons: {}, ms: 0 }
  const budget = opts.budgetMs ?? RUN_BUDGET_MS
  let next = 0
  const worker = async () => {
    for (;;) {
      if (Date.now() - started > budget) return
      const k = next++
      if (k >= queue.length) return
      const sub = queue[k].sub
      let out: Outcome
      try {
        out = await alertOne(sub, now)
      } catch (err) {
        console.error('[alerts] failed', sub, err)
        out = { kind: 'failed', reason: 'error' }
      }
      stats.checked++
      stats[out.kind]++
      if (out.kind === 'sent') stats.jobs += out.jobs
      else stats.reasons[out.reason] = (stats.reasons[out.reason] ?? 0) + 1
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? CONCURRENCY, queue.length)) }, worker))
  stats.deferred = entries.length - stats.checked
  stats.ms = Date.now() - started
  console.log('[alerts] run', JSON.stringify(stats))
  return stats
}
