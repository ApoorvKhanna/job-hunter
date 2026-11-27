// One-click unsubscribe from the weekly job email. No sign-in: the link
// carries the user's sub and an HMAC of it. GET is the link in the email;
// POST answers mail clients' one-click unsubscribe (RFC 8058).
import { turnOff, validUnsubscribe } from '@/lib/alerts'
import { APP_URL } from '@/lib/env'

export const dynamic = 'force-dynamic'

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${title} · Job Hunter</title></head><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:48px 20px;line-height:1.55"><p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin:0 0 10px">Job Hunter</p><h1 style="font-size:22px;margin:0 0 12px">${title}</h1><p style="margin:0 0 20px">${body}</p><p style="margin:0"><a href="${APP_URL}/jobs">Go to Job Hunter</a></p></body></html>`
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

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const sub = url.searchParams.get('u') ?? ''
  if (!validUnsubscribe(sub, url.searchParams.get('t'))) {
    return page(400, 'That link did not work', 'This unsubscribe link is not valid. You can turn the Monday email off on the jobs page.')
  }
  try {
    await turnOff(sub)
  } catch (err) {
    console.error('[alerts] unsubscribe failed', sub, err)
    return page(500, 'Something went wrong', 'We could not turn the email off just now. Open the link again in a minute.')
  }
  return page(200, 'You are unsubscribed', 'You will not get the Monday job email any more. You can turn it back on from the jobs page any time.')
}

export const GET = handle
export const POST = handle
