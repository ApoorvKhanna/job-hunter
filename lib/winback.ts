// A one-time note to the people who signed up around launch, when the first
// search cost more than the welcome credit, so nobody saw a single job before
// being asked to pay. The operator previews the list and the text on /admin
// and sends it from there; each account gets it at most once (a marker blob,
// `winback/<sub>.json`, written before the send).
import { del, list, put } from '@vercel/blob'
import { isBlocked } from './blocks'
import { APP_URL } from './env'
import { type Account, getAccount, hasPaid } from './ledger'
import { LEGACY_EMAIL_PRICE, PACKS, money } from './prices'
import { run } from './provider'

/** Signed up from launch day (00:00 IST, 26 Nov) until free search went live
 *  (27 Nov, about 12:10 IST). */
export const WINDOW = { from: '2026-11-25T18:30:00Z', to: '2026-11-27T06:40:00Z' }

export interface Recipient { sub: string; email: string; name: string; createdAt: string; line: string }
export interface Letter { subject: string; text: string; html: string }

const marker = (sub: string) => `winback/${sub}.json`

function firstName(name: string): string {
  return (name.trim().split(/\s+/)[0] || 'there').toLowerCase()
}

/** What their old balance still buys, in one line. */
function balanceLine(a: Account): string {
  const legacy = LEGACY_EMAIL_PRICE[a.currency]
  const n = Math.floor(a.balance / legacy)
  if (n > 0) return `your ${money(a.balance, a.currency)} balance still covers ${n} work ${n === 1 ? 'email' : 'emails'}, and drafting the note is free.`
  return `emails come in packs from ${money(PACKS[0].price[a.currency], a.currency)}, and drafting the note is free.`
}

export function letterFor(a: Account): Letter {
  const hi = firstName(a.name)
  const link = `${APP_URL}/jobs`
  const line = balanceLine(a)
  const subject = 'searching on job hunter is free now'
  const text = [
    `hi ${hi}... apoorv here, I built job hunter.`,
    '',
    'on launch day it asked you to pay before showing you a single job. that was the wrong call.',
    '',
    `it's fixed... searching and finding the people hiring are free now. ${line}`,
    '',
    `pick up where you left off: ${link}`,
    '',
    'apoorv',
    '',
    'a one-time note about the change. you will not get more like it.',
  ].join('\n')
  const p = 'font-size:15px;line-height:1.6;margin:0 0 14px'
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#1d1d1f"><p style="${p}">hi ${hi}... apoorv here, I built job hunter.</p><p style="${p}">on launch day it asked you to pay before showing you a single job. that was the wrong call.</p><p style="${p}">it's fixed... searching and finding the people hiring are free now. ${line}</p><p style="margin:0 0 22px"><a href="${link}" style="display:inline-block;background:#1e2f96;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">Pick up where you left off</a></p><p style="${p}">apoorv</p><p style="font-size:12px;color:#7a7f87;margin:18px 0 0">A one-time note about the change. You will not get more like it.</p></div>`
  return { subject, text, html }
}

async function alreadySent(): Promise<Set<string>> {
  const done = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await list({ prefix: 'winback/', cursor, limit: 1000 })
    for (const b of page.blobs) done.add(b.pathname.slice('winback/'.length).replace(/\.json$/, ''))
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return done
}

/** Everyone in the window who never paid, is not blocked, and has not had it. */
export async function candidates(): Promise<{ recipients: Recipient[]; sample: Letter | null }> {
  const done = await alreadySent()
  const subs: string[] = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix: 'users/', cursor, limit: 1000 })
    for (const b of page.blobs) subs.push(b.pathname.slice('users/'.length).replace(/\.json$/, ''))
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  const recipients: Recipient[] = []
  let sample: Letter | null = null
  for (let i = 0; i < subs.length; i += 20) {
    const batch = await Promise.all(subs.slice(i, i + 20).map((s) => getAccount(s).catch(() => null)))
    for (const a of batch) {
      if (!a || !a.email || done.has(a.sub)) continue
      if (a.createdAt < WINDOW.from || a.createdAt >= WINDOW.to) continue
      if (hasPaid(a) || (await isBlocked('sub', a.sub))) continue
      recipients.push({ sub: a.sub, email: a.email, name: a.name, createdAt: a.createdAt, line: balanceLine(a) })
      sample ??= letterFor(a)
    }
  }
  recipients.sort((x, y) => x.createdAt.localeCompare(y.createdAt))
  return { recipients, sample }
}

/** Send to everyone still eligible. The marker is written first, so two
 *  clicks can never send anyone two copies; a failed send clears it, so a
 *  later run retries just those. */
export async function sendAll(): Promise<{ sent: number; failed: number; skipped: number }> {
  const { recipients } = await candidates()
  let sent = 0
  let failed = 0
  let skipped = 0
  for (let i = 0; i < recipients.length; i += 4) {
    await Promise.all(
      recipients.slice(i, i + 4).map(async (r) => {
        try {
          await put(marker(r.sub), JSON.stringify({ status: 'sending', at: new Date().toISOString() }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false })
        } catch {
          skipped++
          return
        }
        const a = await getAccount(r.sub)
        const letter = a ? letterFor(a) : null
        const out = letter ? await run<unknown>('agentmail', 'send', { to: r.email, ...letter }, 2).catch(() => ({ ok: false as const })) : { ok: false as const }
        if (out.ok) {
          await put(marker(r.sub), JSON.stringify({ status: 'sent', at: new Date().toISOString() }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true }).catch(() => {})
          sent++
        } else {
          // Not sent: clear the marker so the next run can try again.
          await del(marker(r.sub)).catch(() => {})
          failed++
        }
      }),
    )
  }
  console.log('[winback]', JSON.stringify({ sent, failed, skipped }))
  return { sent, failed, skipped }
}
