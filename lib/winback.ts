// A one-time note to people who signed up before free search went live, in
// two groups with their own copy:
//   launch:  signed up on launch day, when the first search cost more than the
//            welcome credit, so nobody saw a single job before being asked to pay.
//   earlier: signed up before launch (mostly the 14-15 Sep wave) and tried the
//            first version.
// The operator previews each group's list and text on /admin and sends it from
// there. Each account gets at most one note across both groups (a marker blob,
// `winback/<sub>.json`, written before the send).
import { del, list, put } from '@vercel/blob'
import { isBlocked } from './blocks'
import { APP_URL } from './env'
import { type Account, getAccount, hasPaid } from './ledger'
import { LEGACY_EMAIL_PRICE, PACKS, money } from './prices'
import { sendMail, ownSender } from './mail'

export type Cohort = 'launch' | 'earlier'

export const COHORTS: Record<Cohort, { from: string; to: string; label: string }> = {
  // Launch day (00:00 IST, 26 Nov) until free search went live (27 Nov, ~12:10 IST).
  launch: { from: '2026-11-25T18:30:00Z', to: '2026-11-27T06:40:00Z', label: 'Signed up 26 Nov to 27 Nov 12:10 IST' },
  earlier: { from: '2000-01-01T00:00:00Z', to: '2026-11-25T18:30:00Z', label: 'Signed up before launch (mostly the 14-15 Sep wave)' },
}

export const isCohort = (c: unknown): c is Cohort => c === 'launch' || c === 'earlier'

/** Sends per click, so one request stays well inside the function's time
 *  limit. The panel shows what is left; click again for the rest. */
const PER_RUN = 150

export interface Recipient { sub: string; email: string; name: string; createdAt: string; line: string }
export interface Letter { subject: string; text: string; html: string }

const marker = (sub: string) => `winback/${sub}.json`
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function firstName(name: string): string {
  return (name.trim().split(/\s+/)[0] || 'there').toLowerCase()
}

/** The month they signed up, in India time: "september". */
function monthOf(iso: string): string {
  return MONTHS[new Date(Date.parse(iso) + 5.5 * 3600e3).getUTCMonth()]
}

/** What their old balance still buys, in one line. */
function balanceLine(a: Account): string {
  const legacy = LEGACY_EMAIL_PRICE[a.currency]
  const n = Math.floor(a.balance / legacy)
  if (n > 0) return `your ${money(a.balance, a.currency)} balance still covers ${n} work ${n === 1 ? 'email' : 'emails'}, and drafting the note is free.`
  return `emails come in packs from ${money(PACKS[0].price[a.currency], a.currency)}, and drafting the note is free.`
}

function render(paragraphs: string[], cta: { href: string; label: string }): string {
  const p = 'font-size:15px;line-height:1.6;margin:0 0 14px'
  const body = paragraphs.map((t) => `<p style="${p}">${t}</p>`).join('')
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#1d1d1f">${body}<p style="margin:0 0 22px"><a href="${cta.href}" style="display:inline-block;background:#1e2f96;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">${cta.label}</a></p><p style="${p}">apoorv</p><p style="font-size:12px;color:#7a7f87;margin:18px 0 0">A one-time note about the change. You will not get more like it.</p></div>`
}

export function letterFor(a: Account, cohort: Cohort): Letter {
  const hi = firstName(a.name)
  const line = balanceLine(a)
  const footer = ['apoorv', '', 'a one-time note about the change. you will not get more like it.']
  if (cohort === 'launch') {
    const link = `${APP_URL}/jobs`
    const paras = [
      `hi ${hi}... apoorv here, I built job hunter.`,
      'on launch day it asked you to pay before showing you a single job. that was the wrong call.',
      `it's fixed... searching and finding the people hiring are free now. ${line}`,
    ]
    return {
      subject: 'searching on job hunter is free now',
      text: [...paras.flatMap((x) => [x, '']), `pick up where you left off: ${link}`, '', ...footer].join('\n'),
      html: render(paras, { href: link, label: 'Pick up where you left off' }),
    }
  }
  const link = `${APP_URL}/app`
  const paras = [
    `hi ${hi}... apoorv here, I built job hunter.`,
    `you tried it back in ${monthOf(a.createdAt)}. a lot has changed since.`,
    `searching for jobs and finding the people hiring are free now, and there's a free 6-second scan that shows where a recruiter's eye lands on your resume. ${line}`,
  ]
  return {
    subject: 'job hunter is free to search now',
    text: [...paras.flatMap((x) => [x, '']), `have a look: ${link}`, '', ...footer].join('\n'),
    html: render(paras, { href: link, label: 'Have a look' }),
  }
}

async function listAll(prefix: string): Promise<string[]> {
  const out: string[] = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix, cursor, limit: 1000 })
    for (const b of page.blobs) out.push(b.pathname.slice(prefix.length).replace(/\.json$/, ''))
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return out
}

/** Everyone in the group who never paid, is not blocked, and has not had a
 *  note (from either group). */
export async function candidates(cohort: Cohort): Promise<{ recipients: Recipient[]; sample: Letter | null }> {
  const win = COHORTS[cohort]
  const [done, subs] = await Promise.all([listAll('winback/').then((x) => new Set(x)), listAll('users/')])
  const eligible: Account[] = []
  for (let i = 0; i < subs.length; i += 25) {
    const batch = await Promise.all(subs.slice(i, i + 25).filter((s) => !done.has(s)).map((s) => getAccount(s).catch(() => null)))
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

/** Send to up to PER_RUN people still eligible in the group. The marker is
 *  written first, so two clicks can never send anyone two copies; a failed
 *  send clears it, so a later run retries just those. */
export async function sendAll(cohort: Cohort): Promise<{ sent: number; failed: number; skipped: number; left: number; error?: string }> {
  // Written as Apoorv: only from our own sender, never the shared agentmail inbox.
  if (!ownSender()) return { sent: 0, failed: 0, skipped: 0, left: 0, error: 'Set RESEND_API_KEY and MAIL_REPLY_TO first, so this goes from Job Hunter and replies reach you.' }
  const { recipients } = await candidates(cohort)
  const now = recipients.slice(0, PER_RUN)
  let sent = 0
  let failed = 0
  let skipped = 0
  for (let i = 0; i < now.length; i += 6) {
    await Promise.all(
      now.slice(i, i + 6).map(async (r) => {
        try {
          await put(marker(r.sub), JSON.stringify({ status: 'sending', cohort, at: new Date().toISOString() }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false })
        } catch {
          skipped++
          return
        }
        const a = await getAccount(r.sub)
        const letter = a ? letterFor(a, cohort) : null
        const out = letter ? await sendMail({ to: r.email, ...letter }, { requireOwnSender: true }).catch(() => ({ ok: false as const })) : { ok: false as const }
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
  const left = Math.max(0, recipients.length - now.length)
  console.log('[winback]', JSON.stringify({ cohort, sent, failed, skipped, left }))
  return { sent, failed, skipped, left }
}
