// The user's public profiles, read for the review. Every source is optional
// and best-effort: a profile that cannot be read is reported as such and the
// review goes on without it. Output is compact text for the model.
import { GITHUB_TOKEN } from './env'
import type { Account } from './ledger'
import type { Links, SourceKey, SourceState } from './links'
import { runFor } from './provider'

export type { Links, SourceKey, SourceState } from './links'

const clip = (t: unknown, n: number) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, n) : '')
const ym = (d: unknown) => (typeof d === 'string' ? d.slice(0, 7) : '')

async function linkedin(account: Account, url: string): Promise<string | null> {
  const out = await runFor<{ data?: { found?: boolean; person?: Record<string, unknown> } }>(
    account, 'treg', 'submit', { endpoint: 'blitzapi.people.enrich', person_linkedin_url: url }, 3,
  )
  const p = out.ok ? out.data.data?.person : undefined
  if (!out.ok || !out.data.data?.found || !p) return null
  const loc = (p.location ?? {}) as Record<string, unknown>
  const exp = (Array.isArray(p.experiences) ? p.experiences : []) as Array<Record<string, unknown>>
  const edu = (Array.isArray(p.education) ? p.education : []) as Array<Record<string, unknown>>
  const lines = [
    `Name: ${clip(p.full_name, 80)}`,
    `Headline: ${clip(p.headline, 300) || '(none)'}`,
    `About: ${clip(p.about_me, 1500) || '(empty)'}`,
    `Location: ${[loc.city, loc.state_code, loc.country_code].filter(Boolean).join(', ')}`,
    `Connections: ${p.connections_count ?? 'unknown'}`,
    'Experience:',
    ...exp.slice(0, 10).map((e) => `- ${clip(e.job_title, 100)} at ${clip(e.company_name, 80)} (${ym(e.job_start_date)} to ${e.job_is_current ? 'now' : ym(e.job_end_date) || '?'})${e.job_description ? `: ${clip(e.job_description, 400)}` : ''}`),
    `Education: ${edu.map((e) => [clip(e.school_name, 80), clip(e.degree, 60), clip(e.field_of_study, 60)].filter(Boolean).join(', ')).join(' | ') || '(none)'}`,
    `Skills: ${(Array.isArray(p.skills) ? p.skills : []).slice(0, 30).map((x) => (typeof x === 'string' ? x : clip((x as Record<string, unknown>).name, 40))).join(', ') || '(none listed)'}`,
    `Certifications: ${(Array.isArray(p.certifications) ? p.certifications : []).slice(0, 8).map((x) => (typeof x === 'string' ? x : clip((x as Record<string, unknown>).name, 60))).join(', ') || '(none)'}`,
  ]
  return lines.join('\n')
}

async function xProfile(account: Account, handle: string): Promise<string | null> {
  const [prof, posts] = await Promise.all([
    runFor<Record<string, unknown>>(account, 'treg', 'fetch', { endpoint: 'scrapecreators.x.user.profile', handle }, 2),
    runFor<Record<string, unknown>>(account, 'treg', 'fetch', { endpoint: 'scrapecreators.x.user.posts', handle }, 2),
  ])
  const data = prof.ok ? ((prof.data.data ?? prof.data) as Record<string, unknown>) : null
  const legacy = (data?.legacy ?? null) as Record<string, unknown> | null
  if (!legacy) return null
  const urls = ((legacy.entities as Record<string, unknown> | undefined)?.url as { urls?: Array<{ expanded_url?: string }> } | undefined)?.urls ?? []
  const tweetsRaw = posts.ok ? (((posts.data.data ?? posts.data) as Record<string, unknown>).tweets as Array<Record<string, unknown>> | undefined) ?? [] : []
  const tweets = tweetsRaw
    .map((t) => (t.legacy ?? {}) as Record<string, unknown>)
    .filter((l) => typeof l.full_text === 'string' && !String(l.full_text).startsWith('RT @'))
    .slice(0, 15)
  return [
    `@${handle} · ${clip(legacy.name, 60)}`,
    `Bio: ${clip(legacy.description, 300) || '(empty)'}`,
    `Link: ${urls.map((u) => u.expanded_url).filter(Boolean).join(', ') || '(none)'}`,
    `Followers ${legacy.followers_count ?? '?'} · Following ${legacy.friends_count ?? '?'} · Posts ${legacy.statuses_count ?? '?'} · Joined ${clip(legacy.created_at, 40).slice(-4)}`,
    tweets.length ? 'Recent posts (originals):' : 'Recent posts: none readable',
    ...tweets.map((l) => `- [${new Date(String(l.created_at)).toISOString().slice(0, 10)}, ${l.favorite_count ?? 0} likes] ${clip(l.full_text, 280)}`),
  ].join('\n')
}

async function gh<T>(path: string): Promise<T | null> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'job-hunter', ...(GITHUB_TOKEN ? { authorization: `Bearer ${GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(12000),
  }).catch(() => null)
  if (!res?.ok) return null
  return (await res.json()) as T
}

async function github(user: string): Promise<string | null> {
  const [u, repos] = await Promise.all([
    gh<Record<string, unknown>>(`/users/${user}`),
    gh<Array<Record<string, unknown>>>(`/users/${user}/repos?sort=pushed&per_page=40`),
  ])
  if (!u) return null
  const readme = await fetch(`https://raw.githubusercontent.com/${user}/${user}/HEAD/README.md`, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '')
  const own = (repos ?? []).filter((r) => !r.fork)
  const stars = own.reduce((n, r) => n + Number(r.stargazers_count ?? 0), 0)
  const langs = new Map<string, number>()
  for (const r of own) if (r.language) langs.set(String(r.language), (langs.get(String(r.language)) ?? 0) + 1)
  return [
    `${clip(u.name, 60) || user} (@${user})`,
    `Bio: ${clip(u.bio, 200) || '(empty)'} · Company: ${clip(u.company, 60) || '-'} · Blog: ${clip(u.blog, 100) || '-'} · Location: ${clip(u.location, 60) || '-'}`,
    `Followers ${u.followers ?? 0} · Public repos ${u.public_repos ?? 0} · Joined ${ym(u.created_at)} · Stars on own repos ${stars}`,
    `Languages: ${[...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, n]) => `${l} (${n})`).join(', ') || '-'}`,
    readme ? `Profile README: ${clip(readme.replace(/<[^>]+>/g, ' '), 1200)}` : 'Profile README: none',
    'Repos, most recently pushed (forks left out):',
    ...own.slice(0, 15).map((r) => `- ${r.name}: ${clip(r.description, 140) || '(no description)'} [${r.language ?? '-'}, ★${r.stargazers_count ?? 0}, pushed ${ym(r.pushed_at)}]`),
  ].join('\n')
}

async function site(account: Account, url: string): Promise<string | null> {
  const out = await runFor<{ rows?: Array<{ url?: string; title?: string | null; content?: string | null }> }>(
    account, 'vaaya', 'onescrape', { urls: [url] }, 4,
  )
  const row = out.ok ? out.data.rows?.[0] : undefined
  if (!row?.content) return null
  return `${clip(row.title, 120)}\n${String(row.content).slice(0, 5000)}`
}

/** Read every profile the user gave, in parallel. */
export async function readProfiles(account: Account, links: Links): Promise<{ text: Partial<Record<SourceKey, string>>; state: Record<SourceKey, SourceState> }> {
  const tasks: Record<SourceKey, (() => Promise<string | null>) | null> = {
    linkedin: links.linkedin ? () => linkedin(account, links.linkedin as string) : null,
    x: links.x ? () => xProfile(account, links.x as string) : null,
    github: links.github ? () => github(links.github as string) : null,
    site: links.site ? () => site(account, links.site as string) : null,
  }
  const keys = Object.keys(tasks) as SourceKey[]
  const results = await Promise.all(
    keys.map(async (k) => {
      const run = tasks[k]
      if (!run) return [k, 'skipped', null] as const
      const started = Date.now()
      try {
        const text = await run()
        console.log('[review] profile', JSON.stringify({ source: k, ok: !!text, ms: Date.now() - started }))
        return [k, text ? 'read' : 'failed', text] as const
      } catch (err) {
        console.error('[review] profile threw', k, err)
        return [k, 'failed', null] as const
      }
    }),
  )
  const text: Partial<Record<SourceKey, string>> = {}
  const state = {} as Record<SourceKey, SourceState>
  for (const [k, s, t] of results) {
    state[k] = s
    if (t) text[k] = t
  }
  return { text, state }
}
