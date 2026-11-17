// Profile links: what people paste (full URLs, @handles, bare usernames)
// turned into what each source can use. Pure, so the browser uses it too.
export interface Links { linkedin?: string; x?: string; github?: string; site?: string }
export type SourceKey = keyof Links
export type SourceState = 'read' | 'failed' | 'skipped'

/** Accept what people paste (full URLs, @handles, bare usernames) and keep
 *  only what each source can use. Unusable values are dropped. */
export function normalizeLinks(raw: Record<string, unknown> | undefined): Links {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const out: Links = {}
  const li = /linkedin\.com\/in\/([A-Za-z0-9\-_%.]+)/i.exec(s(raw?.linkedin))
  if (li) out.linkedin = `https://www.linkedin.com/in/${li[1].replace(/\/+$/, '')}`
  const xv = s(raw?.x)
  const xm = /(?:^|\/\/|\.)(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})/i.exec(xv) ?? /^@?([A-Za-z0-9_]{1,15})$/.exec(xv)
  if (xm && !/^(home|i|intent|share|search)$/i.test(xm[1])) out.x = xm[1]
  const gv = s(raw?.github)
  const gm = /github\.com\/([A-Za-z0-9-]{1,39})/i.exec(gv) ?? /^@?([A-Za-z0-9-]{1,39})$/.exec(gv)
  if (gm) out.github = gm[1]
  let site = s(raw?.site)
  if (site && !/^https?:\/\//i.test(site)) site = `https://${site}`
  try {
    const u = new URL(site)
    if (/^https?:$/.test(u.protocol) && u.hostname.includes('.') && !isSocial(u.hostname)) out.site = u.toString()
  } catch {}
  return out
}

/** Hosts that are a platform, not someone's own site. */
function isSocial(hostname: string): boolean {
  return /(^|\.)(linkedin\.com|twitter\.com|x\.com|github\.com|t\.co|wa\.me|calendly\.com|cal\.com|medium\.com|instagram\.com|facebook\.com|youtube\.com|google\.com)$/i.test(hostname)
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname
  } catch {
    return ''
  }
}

/** Profile links printed on the resume, sorted into sources. */
export function linksFromResume(urls: string[]): Links {
  const on = (re: RegExp) => urls.find((u) => re.test(hostOf(u)))
  return normalizeLinks({
    linkedin: urls.find((u) => /(^|\.)linkedin\.com$/i.test(hostOf(u)) && /\/in\//i.test(u)),
    x: on(/(^|\.)(x|twitter)\.com$/i),
    github: urls.find((u) => /(^|\.)github\.com$/i.test(hostOf(u)) && /github\.com\/[A-Za-z0-9-]+\/?$/i.test(u)),
    site: urls.find((u) => /^https?:\/\//i.test(u) && hostOf(u) && !isSocial(hostOf(u))),
  })
}

