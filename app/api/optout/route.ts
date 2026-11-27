// Stop all email from Job Hunter. No sign-in: the link carries the sub and an
// HMAC of it. GET only asks (mail scanners open every link); the page's button
// POSTs, and so does Gmail's own one-click unsubscribe (RFC 8058).
import { APP_URL } from '@/lib/env'
import { optOut, validOptOut } from '@/lib/optout'

export const dynamic = 'force-dynamic'

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function page(status: number, title: string, body: string, form = ''): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${title} · Job Hunter</title></head><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:48px 20px;line-height:1.55"><p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin:0 0 10px">Job Hunter</p><h1 style="font-size:22px;margin:0 0 12px">${title}</h1><p style="margin:0 0 20px">${body}</p>${form}<p style="margin:0"><a href="${APP_URL}">Go to Job Hunter</a></p></body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } })
}

function check(req: Request): { sub: string; token: string } | null {
  const url = new URL(req.url)
  const sub = url.searchParams.get('u') ?? ''
  const token = url.searchParams.get('t') ?? ''
  return validOptOut(sub, token) ? { sub, token } : null
}

const invalid = () => page(400, 'That link did not work', 'This link is not valid. Reply to any email from Job Hunter and we will take you off.')

export async function GET(req: Request): Promise<Response> {
  const ok = check(req)
  if (!ok) return invalid()
  const action = `/api/optout?u=${encodeURIComponent(ok.sub)}&t=${encodeURIComponent(ok.token)}`
  const form = `<form method="post" action="${attr(action)}" style="margin:0 0 20px"><button type="submit" style="font:inherit;font-weight:600;background:#1e2f96;color:#fff;border:0;border-radius:8px;padding:11px 18px;cursor:pointer">Stop emails from Job Hunter</button></form>`
  return page(200, 'Stop emails from Job Hunter?', 'You will not get any more emails from us, including the Monday job email. Payment receipts still arrive if you buy something.', form)
}

export async function POST(req: Request): Promise<Response> {
  const ok = check(req)
  if (!ok) return invalid()
  try {
    await optOut(ok.sub)
  } catch (err) {
    console.error('[optout] failed', ok.sub, err)
    return page(500, 'Something went wrong', 'We could not record that just now. Open the link again in a minute.')
  }
  return page(200, 'Done', 'You will not get any more emails from Job Hunter.')
}
