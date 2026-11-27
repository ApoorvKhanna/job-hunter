// Outgoing mail.
// - With RESEND_API_KEY: through Resend from Job Hunter's own domain,
//   hello@thejobhunter.in, so the sender matches every link in the mail.
//   Until Resend has verified that domain, it falls back to
//   apoorv@notify.vaaya.ai, unless the caller says not to (`noFallback`).
//   Replies go to MAIL_REPLY_TO.
// - Without it: through the provider's shared agentmail inbox, a generic
//   agent-…@agentmail.to address. Fine for a receipt, wrong for anything
//   written as Apoorv, so those ask for our own sender (`requireOwnSender`).
import { run } from './provider'

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''
export const MAIL_FROM = process.env.MAIL_FROM || 'Apoorv from Job Hunter <hello@thejobhunter.in>'
/** Used while Resend still refuses MAIL_FROM's domain (DNS not verified yet). */
const FALLBACK_FROM = 'Apoorv from Job Hunter <apoorv@notify.vaaya.ai>'
/** Where replies go. notify.vaaya.ai receives no mail, so without this a reply
 *  bounces. */
export const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO ?? ''

/** Resend refusing the From domain: not verified on the account yet, or an API
 *  key limited to another domain. Either way the fallback sender may work. */
const unverified = (status: number, body: string) => status === 403 && /not verified|verify your domain|domain is not|not authorized to send emails from/i.test(body)

/** Our own sender is set up: a key, and somewhere for replies to land. */
export const ownSender = () => !!RESEND_API_KEY && !!MAIL_REPLY_TO

export interface Mail { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }
export type MailResult = { ok: true; via: 'resend' | 'agentmail' } | { ok: false; code: string; detail?: string }

export async function sendMail(m: Mail, opts: { requireOwnSender?: boolean; noFallback?: boolean } = {}): Promise<MailResult> {
  if (RESEND_API_KEY) {
    // Resend allows 10 requests a second per account (shared with every other
    // app on it): on a 429, wait as long as it says and try again.
    const post = async (from: string): Promise<Response> => {
      for (let attempt = 0; ; attempt++) {
        const res = await send(from)
        if (res.status !== 429 || attempt === 3) return res
        const wait = Math.min(5000, (Number(res.headers.get('retry-after')) || 1) * 1000 + attempt * 500)
        await new Promise((r) => setTimeout(r, wait))
      }
    }
    const send = (from: string) =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [m.to],
          subject: m.subject,
          text: m.text,
          html: m.html,
          ...(MAIL_REPLY_TO ? { reply_to: MAIL_REPLY_TO } : {}),
          ...(m.headers ? { headers: m.headers } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      })
    try {
      let res = await post(MAIL_FROM)
      if (res.ok) return { ok: true, via: 'resend' }
      let detail = (await res.text()).slice(0, 300)
      if (unverified(res.status, detail) && opts.noFallback) {
        return { ok: false, code: 'domain_unverified', detail: `Resend will not send from ${MAIL_FROM} yet (${detail.replace(/"/g, "'")}). Verify the domain, and use an API key allowed to send from it.` }
      }
      if (unverified(res.status, detail) && MAIL_FROM !== FALLBACK_FROM) {
        console.log('[mail] own domain not verified yet, sending from the fallback')
        res = await post(FALLBACK_FROM)
        if (res.ok) return { ok: true, via: 'resend' }
        detail = (await res.text()).slice(0, 300)
      }
      console.error('[mail] resend refused', res.status, detail)
      return { ok: false, code: `resend_${res.status}`, detail }
    } catch (err) {
      console.error('[mail] resend unreachable', String(err))
      return { ok: false, code: 'resend_network', detail: String(err) }
    }
  }
  if (opts.requireOwnSender) return { ok: false, code: 'no_sender', detail: 'RESEND_API_KEY is not set' }
  const out = await run<unknown>('agentmail', 'send', { to: m.to, subject: m.subject, text: m.text, html: m.html }, 2)
  return out.ok ? { ok: true, via: 'agentmail' } : { ok: false, code: out.code, detail: out.detail }
}
