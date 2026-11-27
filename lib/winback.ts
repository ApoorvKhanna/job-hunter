// A one-time note to people who signed up before free search went live, in
// two groups with their own copy:
//   launch:  signed up on launch day, when the first search cost more than the
//            welcome credit, so nobody saw a single job before being asked to pay.
//   earlier: signed up before launch (mostly the 14-15 Sep wave) and tried the
//            first version.
// The operator previews each group's list and text on /admin and sends it from
// there. Each account gets at most one note across both groups (a marker blob,
// `winback/<sub>.json`, written before the send).
//
// Deliverability, since thejobhunter.in is a brand-new sending domain:
//   - Plain words, one link, no button, no prices or currency, no "free" or
//     other promotional stacking: it should read like a note from a person.
//   - A one-click unsubscribe (headers + a line in the body), so people who do
//     not want it unsubscribe instead of reporting spam.
//   - A daily cap (DAILY_LIMIT, per calendar day in India time, across both
//     groups), so the new domain builds a reputation before it sends in volume.
// A daily cron (/api/cron/winback, 10:00 IST) sends the day's batch: the
// launch group first, then the earlier group, each with its own copy.
import { del, list, put } from '@vercel/blob'
import { isBlocked } from './blocks'
import { APP_URL } from './env'
import { type Account, getAccount, hasPaid } from './ledger'
import { MAIL_REPLY_TO, ownSender, sendMail } from './mail'
import { optOutHeaders, optOutUrl, optedOut } from './optout'
import { LEGACY_EMAIL_PRICE } from './prices'

export type Cohort = 'launch' | 'earlier'

export const COHORTS: Record<Cohort, { from: string; to: string; label: string }> = {
  // Launch day (00:00 IST, 26 Nov) until free search went live (27 Nov, ~12:10 IST).
  launch: { from: '2026-11-25T18:30:00Z', to: '2026-11-27T06:40:00Z', label: 'Signed up 26 Nov to 27 Nov 12:10 IST' },
  earlier: { from: '2000-01-01T00:00:00Z', to: '2026-11-25T18:30:00Z', label: 'Signed up before launch (mostly the 14-15 Sep wave)' },
}

export const isCohort = (c: unknown): c is Cohort => c === 'launch' || c === 'earlier'

/** Most notes per calendar day (India time), across both groups. Apoorv asked
 *  for 20 a day (2026-11-27); a new domain starts at 10-20 a day. */
export const DAILY_LIMIT = 20

export interface Recipient { sub: string; email: string; name: string; createdAt: string; line: string }
export interface Letter { subject: string; text: string; html: string }

const marker = (sub: string) => `winback/${sub}.json`
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const IST_MS = 5.5 * 3600e3
/** "2026-11-28": the calendar day in India time. */
const istDay = (t: number) => new Date(t + IST_MS).toISOString().slice(0, 10)

function firstName(name: string): string {
  return (name.trim().split(/\s+/)[0] || 'there').toLowerCase()
}

/** The month they signed up, in India time: "september". */
function monthOf(iso: string): string {
  return MONTHS[new Date(Date.parse(iso) + 5.5 * 3600e3).getUTCMonth()]
}

/** What their old balance still covers, without naming an amount. Empty when
 *  there is nothing to say. */
function balanceLine(a: Account): string {
  const n = Math.floor(a.balance / LEGACY_EMAIL_PRICE[a.currency])
  return n > 0 ? `your account still has enough for ${n} work ${n === 1 ? 'email' : 'emails'}.` : ''
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Plain paragraphs, the link written out, a small opt-out line. No button,
 *  no colours, no images: it should look like a note, not a campaign. */
function render(paragraphs: string[], link: string, optout: string, why: string): string {
  const p = 'margin:0 0 14px'
  const body = paragraphs.map((t) => `<p style="${p}">${escape(t)}</p>`).join('')
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1d1d1f;max-width:560px">${body}<p style="${p}"><a href="${link}">${link}</a></p><p style="${p}">apoorv</p><p style="margin:18px 0 0;font-size:12px;color:#6b6f76">${escape(why)} <a href="${optout}" style="color:#6b6f76">Stop emails from Job Hunter</a>.</p></div>`
}

export function letterFor(a: Account, cohort: Cohort): Letter {
  const hi = firstName(a.name)
  const line = balanceLine(a)
  const optout = optOutUrl(a.sub)
  if (cohort === 'launch') {
    const link = `${APP_URL}/jobs`
    const why = 'You signed up for Job Hunter on launch day. This is a one-time note.'
    const paras = [
      `hi ${hi}... apoorv here, I built job hunter.`,
      'on launch day it asked you to pay before you could see a single job. that was a mistake, and I have changed it.',
      `you can now search jobs and see who is hiring at each company before deciding anything.${line ? ` ${line}` : ''}`,
      'if you are still looking, it is here:',
    ]
    return {
      subject: 'job hunter, after launch day',
      text: [...paras.flatMap((x) => [x, '']), link, '', 'apoorv', '', `${why} Stop emails from Job Hunter: ${optout}`].join('\n'),
      html: render(paras, link, optout, why),
    }
  }
  const link = `${APP_URL}/app`
  const month = monthOf(a.createdAt)
  const why = `You signed up for Job Hunter in ${month[0].toUpperCase()}${month.slice(1)}. This is a one-time note.`
  const paras = [
    `hi ${hi}... apoorv here, I built job hunter.`,
    `you tried it back in ${month}. a lot has changed since then.`,
    `searching jobs and seeing who is hiring at each company no longer cost anything, and there is a new 6-second resume scan that shows where a recruiter's eye lands first.${line ? ` ${line}` : ''}`,
    'if you are still looking, it is here:',
  ]
  return {
    subject: `job hunter has changed since ${month}`,
    text: [...paras.flatMap((x) => [x, '']), link, '', 'apoorv', '', `${why} Stop emails from Job Hunter: ${optout}`].join('\n'),
    html: render(paras, link, optout, why),
  }
}

async function listAll(prefix: string): Promise<Array<{ name: string; at: number }>> {
  const out: Array<{ name: string; at: number }> = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix, cursor, limit: 1000 })
    for (const b of page.blobs) out.push({ name: b.pathname.slice(prefix.length).replace(/\.json$/, ''), at: new Date(b.uploadedAt).getTime() })
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return out
}

/** How many more notes may go out today (calendar day, India time), across
 *  both groups. `day` is which sending day this is, counting today. */
export async function allowanceToday(now = Date.now()): Promise<{ limit: number; sentToday: number; left: number; day: number }> {
  const markers = await listAll('winback/')
  const today = istDay(now)
  const sentToday = markers.filter((m) => istDay(m.at) === today).length
  const days = new Set([...markers.map((m) => istDay(m.at)), today])
  return { limit: DAILY_LIMIT, sentToday, left: Math.max(0, DAILY_LIMIT - sentToday), day: days.size }
}

/** Everyone in the group who never paid, is not blocked, did not opt out, and
 *  has not had a note (from either group). */
export async function candidates(cohort: Cohort): Promise<{ recipients: Recipient[]; sample: Letter | null }> {
  const win = COHORTS[cohort]
  const [done, subs, off] = await Promise.all([
    listAll('winback/').then((x) => new Set(x.map((m) => m.name))),
    listAll('users/').then((x) => x.map((m) => m.name)),
    optedOut(),
  ])
  const eligible: Account[] = []
  for (let i = 0; i < subs.length; i += 25) {
    const batch = await Promise.all(subs.slice(i, i + 25).filter((s) => !done.has(s) && !off.has(s)).map((s) => getAccount(s).catch(() => null)))
    const inWindow = batch.filter((a): a is Account => !!a && !!a.email && a.createdAt >= win.from && a.createdAt < win.to && !hasPaid(a))
    const blocked = await Promise.all(inWindow.map((a) => isBlocked('sub', a.sub)))
    eligible.push(...inWindow.filter((_, k) => !blocked[k]))
  }
  eligible.sort((x, y) => x.createdAt.localeCompare(y.createdAt))
  return {
    recipients: eligible.map((a) => ({ sub: a.sub, email: a.email, name: a.name, createdAt: a.createdAt, line: balanceLine(a) })),
    sample: eligible[0] ? letterFor(eligible[0], cohort) : null,
  }
}

/** Exactly the note the group's first recipient would get (same subject,
 *  same headers), sent to the reply-to inbox, so where it lands there is where
 *  the real ones will land. Marks nobody and does not count toward the cap. */
export async function sendTest(cohort: Cohort): Promise<{ ok: boolean; to?: string; error?: string }> {
  if (!ownSender()) return { ok: false, error: 'Set RESEND_API_KEY and MAIL_REPLY_TO first.' }
  const { recipients, sample } = await candidates(cohort)
  if (!sample || !recipients[0]) return { ok: false, error: 'Nobody left in this group to write for.' }
  const out = await sendMail({ to: MAIL_REPLY_TO, ...sample, headers: optOutHeaders(recipients[0].sub) }, { requireOwnSender: true, noFallback: true })
  return out.ok ? { ok: true, to: MAIL_REPLY_TO } : { ok: false, error: `${out.code}${out.detail ? `: ${out.detail}` : ''}` }
}

/** Send to as many people still eligible in the group as today's warm-up
 *  allows. The marker is written first, so two clicks can never send anyone
 *  two copies; a failed send clears it, so a later run retries just those. */
export async function sendAll(cohort: Cohort, now = Date.now()): Promise<{ sent: number; failed: number; skipped: number; left: number; todayLeft: number; error?: string }> {
  // Written as Apoorv: only from our own sender, never the shared agentmail inbox.
  if (!ownSender()) return { sent: 0, failed: 0, skipped: 0, left: 0, todayLeft: 0, error: 'Set RESEND_API_KEY and MAIL_REPLY_TO first, so this goes from Job Hunter and replies reach you.' }
  const [{ recipients }, today] = await Promise.all([candidates(cohort), allowanceToday(now)])
  if (today.left === 0) {
    return { sent: 0, failed: 0, skipped: 0, left: recipients.length, todayLeft: 0, error: `Today's limit of ${today.limit} is reached. The rest go out tomorrow at 10:00 IST.` }
  }
  const batch = recipients.slice(0, today.left)
  let sent = 0
  let failed = 0
  let skipped = 0
  for (let i = 0; i < batch.length; i += 5) {
    await Promise.all(
      batch.slice(i, i + 5).map(async (r) => {
        try {
          await put(marker(r.sub), JSON.stringify({ status: 'sending', cohort, at: new Date().toISOString() }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false })
        } catch {
          skipped++
          return
        }
        const a = await getAccount(r.sub)
        const letter = a ? letterFor(a, cohort) : null
        const out = letter
          ? await sendMail({ to: r.email, ...letter, headers: optOutHeaders(r.sub) }, { requireOwnSender: true, noFallback: true }).catch(() => ({ ok: false as const }))
          : { ok: false as const }
        if (out.ok) {
          await put(marker(r.sub), JSON.stringify({ status: 'sent', cohort, at: new Date().toISOString() }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true }).catch(() => {})
          sent++
        } else {
          // Not sent: clear the marker so the next run can try again.
          await del(marker(r.sub)).catch(() => {})
          failed++
        }
      }),
    )
  }
  const left = Math.max(0, recipients.length - sent - skipped)
  const todayLeft = Math.max(0, today.left - sent)
  console.log('[winback]', JSON.stringify({ cohort, sent, failed, skipped, left, todayLeft, day: today.day }))
  return { sent, failed, skipped, left, todayLeft }
}

/** The day's batch, for the cron: the launch group first (warmest, and the
 *  launch copy), then whatever today's limit leaves for the earlier group (its
 *  own copy). Stops quietly when everyone has had a note. */
export async function runDaily(now = Date.now()): Promise<{ launch: Awaited<ReturnType<typeof sendAll>> | null; earlier: Awaited<ReturnType<typeof sendAll>> | null; error?: string }> {
  if (!ownSender()) return { launch: null, earlier: null, error: 'no_sender' }
  const launch = await sendAll('launch', now)
  const earlier = launch.todayLeft > 0 ? await sendAll('earlier', now) : null
  console.log('[winback] daily', JSON.stringify({ day: istDay(now), launch: launch && { sent: launch.sent, left: launch.left }, earlier: earlier && { sent: earlier.sent, left: earlier.left } }))
  return { launch, earlier }
}
