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

/** Resend's answer when the From domain is not (yet) verified on the account. */
const unverified = (status: number, body: string) => status === 403 && /not verified|verify your domain|domain is not/i.test(body)

/** Our own sender is set up: a key, and somewhere for replies to land. */
export const ownSender = () => !!RESEND_API_KEY && !!MAIL_REPLY_TO

export interface Mail { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }
export type MailResult = { ok: true; via: 'resend' | 'agentmail' } | { ok: false; code: string; detail?: string }

export async function sendMail(m: Mail, opts: { requireOwnSender?: boolean; noFallback?: boolean } = {}): Promise<MailResult> {
  if (RESEND_API_KEY) {
    const post = (from: string) =>
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
        return { ok: false, code: 'domain_unverified', detail: `${MAIL_FROM} is not verified in Resend yet: add its DNS records, then press Verify.` }
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
