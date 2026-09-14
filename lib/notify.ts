// Transactional mail to the user, sent through the provider's mail service on
// the operator key. Best-effort by design: a mail failure never fails a credit.
import { APP_URL } from './env'
import { inr } from './prices'
import { run } from './provider'

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there'
}

export async function sendCreditEmail(opts: { to: string; name: string; paise: number; balancePaise: number; utr: string }): Promise<boolean> {
  const amount = inr(opts.paise)
  const balance = inr(opts.balancePaise)
  const hi = firstName(opts.name)
  const link = `${APP_URL}/app`
  const subject = `${amount} added to your Job Hunter balance`
  const text = [
    `Hi ${hi},`,
    '',
    `Your UPI payment came through. ${amount} has been added and your balance is now ${balance}.`,
    '',
    `UTR: ${opts.utr}`,
    '',
    `You can pick up where you left off: ${link}`,
    '',
    'Job Hunter',
  ].join('\n')
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#1d1d1f"><p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7a7f87;margin:0 0 10px">Job Hunter</p><h1 style="font-size:22px;margin:0 0 14px">${amount} added to your balance</h1><p style="font-size:15px;line-height:1.55;margin:0 0 14px">Hi ${hi}, your UPI payment came through. Your balance is now <b>${balance}</b>.</p><p style="font-size:13px;color:#7a7f87;margin:0 0 22px">UTR ${opts.utr}</p><p style="margin:0 0 26px"><a href="${link}" style="display:inline-block;background:#1e2f96;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">Continue your search</a></p><p style="font-size:12px;color:#7a7f87;margin:0">Failed steps are never charged. Reply to this email if something looks off.</p></div>`
  try {
    const out = await run<unknown>('agentmail', 'send', { to: opts.to, subject, text, html }, 2)
    if (!out.ok) console.error('[notify] credit email failed', out.detail ?? out.code)
    return out.ok
  } catch (err) {
    console.error('[notify] credit email threw', err)
    return false
  }
}
