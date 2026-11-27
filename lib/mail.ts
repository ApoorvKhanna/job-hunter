// Outgoing mail. With RESEND_API_KEY set, it goes through Resend from Job
// Hunter's own sender on notify.vaaya.ai (a domain verified there with DKIM),
// with replies to MAIL_REPLY_TO. Without it, it goes through the provider's
// shared agentmail inbox, a generic agent-…@agentmail.to address: fine for a
// receipt, wrong for anything written as Apoorv, so those ask for our own
// sender (`requireOwnSender`) and are not sent without it.
import { run } from './provider'

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''
export const MAIL_FROM = process.env.MAIL_FROM || 'Apoorv from Job Hunter <apoorv@notify.vaaya.ai>'
/** Where replies go. notify.vaaya.ai receives no mail, so without this a reply
 *  bounces. */
export const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO ?? ''

/** Our own sender is set up: a key, and somewhere for replies to land. */
export const ownSender = () => !!RESEND_API_KEY && !!MAIL_REPLY_TO

export interface Mail { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }
export type MailResult = { ok: true; via: 'resend' | 'agentmail' } | { ok: false; code: string; detail?: string }

export async function sendMail(m: Mail, opts: { requireOwnSender?: boolean } = {}): Promise<MailResult> {
  if (RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: MAIL_FROM,
          to: [m.to],
          subject: m.subject,
          text: m.text,
          html: m.html,
          ...(MAIL_REPLY_TO ? { reply_to: MAIL_REPLY_TO } : {}),
          ...(m.headers ? { headers: m.headers } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return { ok: true, via: 'resend' }
      const detail = (await res.text()).slice(0, 300)
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
