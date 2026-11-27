// Unsubscribe from the weekly job email. No sign-in: the link carries the
// user's sub and an HMAC of it. GET (the link in the email) only shows a
// confirmation page, because corporate mail scanners open every link and would
// otherwise switch people off; the page's button POSTs, and POST turns it off.
import { turnOff, validUnsubscribe } from '@/lib/alerts'
import { APP_URL } from '@/lib/env'

export const dynamic = 'force-dynamic'

function page(status: number, title: string, body: string, form = ''): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${title} · Job Hunter</title></head><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:48px 20px;line-height:1.55"><p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin:0 0 10px">Job Hunter</p><h1 style="font-size:22px;margin:0 0 12px">${title}</h1><p style="margin:0 0 20px">${body}</p>${form}<p style="margin:0"><a href="${APP_URL}/jobs">Go to Job Hunter</a></p></body></html>`
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      // The token is in this page's URL; do not hand it to the next site.
      'referrer-policy': 'no-referrer',
    },
  })
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function check(req: Request): { sub: string; token: string } | null {
  const url = new URL(req.url)
  const sub = url.searchParams.get('u') ?? ''
  const token = url.searchParams.get('t') ?? ''
  return validUnsubscribe(sub, token) ? { sub, token } : null
}

const invalid = () => page(400, 'That link did not work', 'This unsubscribe link is not valid. You can turn the Monday email off on the jobs page.')

export async function GET(req: Request): Promise<Response> {
  const ok = check(req)
  if (!ok) return invalid()
  const action = `/api/alerts/unsubscribe?u=${encodeURIComponent(ok.sub)}&t=${encodeURIComponent(ok.token)}`
  const form = `<form method="post" action="${attr(action)}" style="margin:0 0 20px"><button type="submit" style="font:inherit;font-weight:600;background:#1e2f96;color:#fff;border:0;border-radius:8px;padding:11px 18px;cursor:pointer">Turn off the Monday email</button></form>`
  return page(200, 'Stop the Monday job email?', 'You will not get new matches by email any more. You can turn it back on from the jobs page any time.', form)
}

export async function POST(req: Request): Promise<Response> {
  const ok = check(req)
  if (!ok) return invalid()
  const sub = ok.sub
  try {
    await turnOff(sub)
  } catch (err) {
    console.error('[alerts] unsubscribe failed', sub, err)
    return page(500, 'Something went wrong', 'We could not turn the email off just now. Open the link again in a minute.')
  }
  return page(200, 'You are unsubscribed', 'You will not get the Monday job email any more. You can turn it back on from the jobs page any time.')
}
