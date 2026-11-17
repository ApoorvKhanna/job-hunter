// The resume + profile review. One paid run does three things in parallel:
//   1. the hotspot scan: where a recruiter's eye lands in the first seconds,
//      from the page images (falling back to the text layout, then to layout
//      rules, so a scan always comes back);
//   2. reads the public profiles the user gave (LinkedIn, X, GitHub, site);
//   3. an evaluation of resume + profiles against the target roles.
// The price is debited before the run and refunded if the evaluation fails.
import { REVIEW_MODEL } from './env'
import { type Block, describeBlocks, priorScan } from './layout'
import { credit, debit, getAccount, InsufficientBalance } from './ledger'
import { REVIEW_PRICE } from './prices'
import { type SourceKey, readProfiles } from './profiles'
import { chat, type ChatPart } from './provider'
import { type Evaluation, type Review, type ScanResult, getReview, readPageImage, updateReview } from './review-store'
import { extractJson } from './route'
import { saveItems } from './saved'

const SCAN_SYSTEM = `You simulate where a recruiter's eyes go in the first 6 to 8 seconds on a resume, using what eye-tracking studies of recruiters show:
- The scan is an F-pattern: across the top, then down the left edge, with short sweeps into lines whose first words are worth reading.
- Eyes land on the name and top block, then the current job title and employer, its dates, the previous title and employer, then education. Large or bold text, short isolated lines, numbers, and well-known company or school names pull the eye. Long paragraphs, dense skill lists, small or light text, the right-hand ends of lines and most of page two get skipped.
- Photos, logos, icons, coloured bars, charts and skill-rating graphics pull fixations away from the content.
You get the page images when available, and always the page's text lines with their position (x, y, w, h as fractions of the page, origin top-left) and font size relative to body text (1.0). Refer to lines ONLY by their id.

Reply with ONLY a JSON object:
{"fixations": [{"id": string, "order": number, "dwell": number (0.2 to 1, share of attention), "note": string (under 12 words: what the eye picks up here)}] (8 to 14 items in scan order, mostly page 1),
 "six_seconds": string (at most two sentences: what a recruiter believes about this person after the scan),
 "seen": string[] (3 to 5 things that land),
 "missed": [{"id": string, "what": string, "fix": string}] (2 to 5 strong points the scan skips, each with a concrete fix),
 "layout": [{"issue": string, "fix": string}] (2 to 5 layout or formatting problems that cost attention),
 "score": number (0 to 100: how well the first scan sells this person for the target roles)}
Be specific to this resume. Plain words. No em dashes.`

// The evaluation is two calls in parallel (the assessment, then the
// rewrites and plan), so each answer stays short and fast.
const EVAL_BRIEF = `You are a senior recruiter and career coach reviewing a candidate's resume and public profiles for the roles they are targeting. You get the resume text, the profiles they shared (LinkedIn, X, GitHub, personal site; any may be missing), the target roles and their notes.
Be candid and specific: point to the actual line, field, repo or post. Never invent facts, employers, numbers or skills. Judge each profile for what it does for these target roles: a quiet X account is fine for most roles, a thin GitHub matters for engineers, a LinkedIn headline that disagrees with the resume matters for everyone.
Plain words. No em dashes. No buzzwords.`

const EVAL_ASSESS = `${EVAL_BRIEF}

Reply with ONLY a JSON object:
{"headline": string (one-line verdict),
 "overall": number (0 to 100),
 "profiles": [{"source": "resume" | "linkedin" | "x" | "github" | "site", "score": number (0 to 100), "verdict": string (one sentence), "strengths": string[] (1 to 3), "fixes": string[] (2 to 4 concrete changes to make this week)}] (resume first, then one per profile provided),
 "consistency": [{"issue": string, "fix": string}] (0 to 4 places where titles, dates, employers or claims disagree across sources),
 "roles": [{"role": string, "fit": number (0 to 100), "verdict": string, "strengths": string[] (1 to 3), "gaps": string[] (1 to 3), "resume_changes": string[] (2 to 4), "keywords": string[] (4 to 8 terms recruiters search for in this role that are missing or weak)}] (one per target role, in the order given)}`

const EVAL_REWRITE = `${EVAL_BRIEF}

Your job here is the rewrites and the week's plan. Reply with ONLY a JSON object:
{"rewrites": {"headline": string (a LinkedIn headline for the target roles, under 220 characters), "summary": string (a 2 to 3 sentence resume summary), "bullets": [{"before": string (an exact line from the resume), "after": string}] (3 to 5 of the weakest lines that matter most for the target roles, biggest gain first)},
 "plan": string[] (5 to 7 actions for the next 7 days to land the target roles, highest impact first; profile fixes, resume edits, outreach)}
Rewrites use ONLY facts and numbers that appear in the resume or profiles. The candidate will paste them onto a real resume, so a made-up number is a lie on their behalf. Where a number would make a line stronger but is not given, write a bracketed placeholder for them to fill in, like [number of merchants] or [monthly volume in ₹]. Never invent a number, tool, employer, team size or result.`

/** The model does not know what day it is; tenure maths needs it. */
const withDate = (system: string) => `Today is ${new Date().toISOString().slice(0, 10)}.\n${system}`

const SOURCE_LABEL: Record<SourceKey, string> = { linkedin: 'LinkedIn profile', x: 'X profile', github: 'GitHub profile', site: 'Personal website' }

// Models slip em dashes in however firmly they are told not to.
const str = (v: unknown, n = 600) => (typeof v === 'string' ? v.replace(/\s*—\s*/g, ', ').trim().slice(0, n) : '')
const strs = (v: unknown, max = 8, n = 300) => (Array.isArray(v) ? v.map((x) => str(x, n)).filter(Boolean).slice(0, max) : [])
const score = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null)
const pairs = <K extends string>(v: unknown, keys: [K, K], max = 6) =>
  (Array.isArray(v) ? v : [])
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ [keys[0]]: str(x[keys[0]]), [keys[1]]: str(x[keys[1]]) }) as Record<K, string>)
    .filter((x) => x[keys[0]] && x[keys[1]])
    .slice(0, max)

function cleanScan(raw: Record<string, unknown> | null, blocks: Block[], method: ScanResult['method']): ScanResult | null {
  if (!raw) return null
  const ids = new Set(blocks.map((b) => b.id))
  const fixations = (Array.isArray(raw.fixations) ? raw.fixations : [])
    .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>) : {}))
    .filter((f) => typeof f.id === 'string' && ids.has(f.id))
    .map((f, k) => ({
      id: f.id as string,
      order: typeof f.order === 'number' ? f.order : k + 1,
      dwell: typeof f.dwell === 'number' ? Math.max(0.15, Math.min(1, f.dwell)) : 0.5,
      note: str(f.note, 120),
    }))
    .sort((a, b) => a.order - b.order)
    .slice(0, 16)
    .map((f, k) => ({ ...f, order: k + 1 }))
  if (fixations.length < 3) return null
  const missed = (Array.isArray(raw.missed) ? raw.missed : [])
    .map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>) : {}))
    .map((m) => ({ id: typeof m.id === 'string' && ids.has(m.id) ? m.id : '', what: str(m.what), fix: str(m.fix) }))
    .filter((m) => m.what && m.fix)
    .slice(0, 6)
  return {
    fixations,
    six_seconds: str(raw.six_seconds, 500),
    seen: strs(raw.seen, 6),
    missed,
    layout: pairs(raw.layout, ['issue', 'fix']),
    score: score(raw.score),
    method,
  }
}

async function scan(review: Review, images: string[]): Promise<ScanResult> {
  const blocks = review.input.pages.flatMap((p) => p.blocks)
  const text = [
    `Target roles: ${review.input.roles.join('; ')}`,
    review.input.notes ? `Notes from the candidate: ${review.input.notes}` : '',
    ...review.input.pages.map((p) => `Page ${p.n} lines (id | position | size | text):\n${describeBlocks(p.blocks)}`),
  ]
    .filter(Boolean)
    .join('\n\n')

  if (images.length) {
    const parts: ChatPart[] = [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))]
    const out = await chat([{ role: 'system', content: withDate(SCAN_SYSTEM) }, { role: 'user', content: parts }], 2200, { model: REVIEW_MODEL, temperature: 0.2 })
    const got = out.ok ? cleanScan(extractJson(out.data), blocks, 'vision') : null
    console.log('[review] scan vision', JSON.stringify({ ok: out.ok, usable: !!got, code: out.ok ? undefined : out.detail }))
    if (got) return got
  }
  const out = await chat([{ role: 'system', content: withDate(SCAN_SYSTEM) }, { role: 'user', content: `No page images this time; use the line positions and sizes.\n\n${text}` }], 2200, { model: REVIEW_MODEL, temperature: 0.2 })
  const got = out.ok ? cleanScan(extractJson(out.data), blocks, 'layout') : null
  console.log('[review] scan layout', JSON.stringify({ ok: out.ok, usable: !!got }))
  if (got) return got
  return { fixations: priorScan(blocks), six_seconds: '', seen: [], missed: [], layout: [], score: null, method: 'rules' }
}

function cleanEvaluation(raw: Record<string, unknown> | null, roles: string[]): Evaluation | null {
  if (!raw) return null
  const profiles = (Array.isArray(raw.profiles) ? raw.profiles : [])
    .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
    .filter((p) => ['resume', 'linkedin', 'x', 'github', 'site'].includes(String(p.source)))
    .map((p) => ({
      source: p.source as Evaluation['profiles'][number]['source'],
      score: score(p.score),
      verdict: str(p.verdict),
      strengths: strs(p.strengths, 4),
      fixes: strs(p.fixes, 5),
    }))
  const roleRows = (Array.isArray(raw.roles) ? raw.roles : [])
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
    .map((r) => ({
      role: str(r.role, 120),
      fit: score(r.fit),
      verdict: str(r.verdict),
      strengths: strs(r.strengths, 4),
      gaps: strs(r.gaps, 4),
      resume_changes: strs(r.resume_changes, 5),
      keywords: strs(r.keywords, 10, 60),
    }))
    .filter((r) => r.role)
  const rw = (raw.rewrites && typeof raw.rewrites === 'object' ? raw.rewrites : {}) as Record<string, unknown>
  if (profiles.length === 0 && roleRows.length === 0) return null
  return {
    headline: str(raw.headline, 300),
    overall: score(raw.overall),
    profiles,
    consistency: pairs(raw.consistency, ['issue', 'fix'], 5),
    roles: roleRows.length ? roleRows : roles.map((role) => ({ role, fit: null, verdict: '', strengths: [], gaps: [], resume_changes: [], keywords: [] })),
    rewrites: { headline: str(rw.headline, 300), summary: str(rw.summary, 800), bullets: pairs(rw.bullets, ['before', 'after'], 6) },
    plan: strs(raw.plan, 8),
  }
}

async function ask(system: string, user: string, label: string): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await chat([{ role: 'system', content: withDate(system) }, { role: 'user', content: user }], 3000, { model: REVIEW_MODEL, temperature: 0.3 })
    const got = out.ok ? extractJson<Record<string, unknown>>(out.data) : null
    console.log('[review]', label, JSON.stringify({ attempt, ok: out.ok, parsed: !!got, code: out.ok ? undefined : out.detail }))
    if (got) return got
  }
  return null
}

async function evaluate(review: Review, profiles: Partial<Record<SourceKey, string>>, unread: SourceKey[]): Promise<Evaluation | null> {
  const user = [
    `Target roles:\n${review.input.roles.map((r) => `- ${r}`).join('\n')}`,
    review.input.notes ? `Notes from the candidate: ${review.input.notes}` : '',
    `=== Resume ===\n${review.input.resume.slice(0, 12000)}`,
    ...(Object.keys(profiles) as SourceKey[]).map((k) => `=== ${SOURCE_LABEL[k]} ===\n${profiles[k]}`),
    unread.length ? `The candidate also gave these, but they could not be read, so do not score them: ${unread.map((k) => SOURCE_LABEL[k]).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const [assess, rewrite] = await Promise.all([ask(EVAL_ASSESS, user, 'assess'), ask(EVAL_REWRITE, user, 'rewrite')])
  // The assessment is the review; without the rewrites it is still worth
  // delivering (their sections just do not show).
  return assess ? cleanEvaluation({ ...assess, ...(rewrite ?? {}) }, review.input.roles) : null
}

/** Debit the price and mark the review running, once. */
export async function startReview(sub: string, id: string): Promise<{ ok: true; review: Review; started: boolean } | { ok: false; code: string; message: string; balance?: number; need?: number }> {
  const [review, account] = await Promise.all([getReview(sub, id), getAccount(sub)])
  if (!review || !account) return { ok: false, code: 'invalid', message: 'That review was not found.' }
  if (review.status === 'running' || review.status === 'done') return { ok: true, review, started: false }
  const price = REVIEW_PRICE[account.currency]
  try {
    await debit(sub, price, `review ${id}`)
  } catch (err) {
    if (err instanceof InsufficientBalance) return { ok: false, code: 'recharge', message: 'Your balance is too low for the review.', balance: err.balance, need: price }
    throw err
  }
  try {
    const started = await updateReview(sub, id, (r) => {
      if (r.status === 'running' || r.status === 'done') throw new Error('already_started')
      r.status = 'running'
      r.stage = 'profiles'
      r.error = undefined
      r.charged = price
      r.currency = account.currency
    })
    return { ok: true, review: started, started: true }
  } catch (err) {
    // Someone else started it between our read and our write: give the money back.
    await credit(sub, price, `review ${id} (already started, returned)`)
    if ((err as Error).message === 'already_started') return { ok: true, review: (await getReview(sub, id)) as Review, started: false }
    throw err
  }
}

const STALE_MS = 8 * 60_000

/** Mark failed and refund, once: the status write decides who refunds. */
async function fail(review: Review, message: string, onlyIfStale = false): Promise<Review | null> {
  let refund = 0
  const next = await updateReview(review.sub, review.id, (r) => {
    if (r.status !== 'running') throw new Error('not_running')
    if (onlyIfStale && Date.now() - Date.parse(r.updatedAt) < STALE_MS) throw new Error('not_stale')
    refund = r.charged
    r.status = 'failed'
    r.stage = undefined
    r.error = message
    r.charged = 0
  }).catch(() => null)
  if (next && refund > 0) {
    await credit(review.sub, refund, `review ${review.id} refunded`).catch((e) => console.error('[review] refund failed', review.id, refund, e))
  }
  return next
}

/** A run that died without finishing (a timeout or a crash) is refunded the
 *  next time anyone looks at it. */
export async function recoverStale(review: Review): Promise<Review> {
  if (review.status !== 'running' || Date.now() - Date.parse(review.updatedAt) < STALE_MS) return review
  console.error('[review] stale run, refunding', review.id)
  return (await fail(review, 'The review took too long and stopped. Your money is back in your balance. Try again.', true)) ?? (await getReview(review.sub, review.id)) ?? review
}

/** The run itself. Called after the response has gone out. */
export async function runReview(sub: string, id: string): Promise<void> {
  const started = Date.now()
  const review = await getReview(sub, id)
  const account = await getAccount(sub)
  if (!review || !account || review.status !== 'running') return
  try {
    // The model's copies of the pages, page one first, inside the router's
    // 512 KB request cap (the text of the prompt rides along too).
    const images: string[] = []
    let budget = 400_000
    for (const p of review.input.pages.filter((x) => x.vision)) {
      const buf = await readPageImage(sub, id, p.n, 'v').catch(() => null)
      const url = buf ? `data:image/jpeg;base64,${buf.toString('base64')}` : null
      if (!url || url.length > budget) break
      images.push(url)
      budget -= url.length
    }

    const scanning = scan(review, images)
    const profiles = await readProfiles(account, review.input.links)
    await updateReview(sub, id, (r) => {
      r.stage = 'analysis'
    }).catch(() => {})
    const unread = (Object.keys(profiles.state) as SourceKey[]).filter((k) => profiles.state[k] === 'failed')
    const [scanResult, evaluation] = await Promise.all([scanning, evaluate(review, profiles.text, unread)])
    if (!evaluation) {
      await fail(review, 'The review did not come through. Your money is back in your balance. Try again in a minute.')
      return
    }
    const done = await updateReview(sub, id, (r) => {
      r.status = 'done'
      r.stage = undefined
      r.result = { scan: scanResult, evaluation, sources: profiles.state, model: REVIEW_MODEL, finishedAt: new Date().toISOString() }
    })
    await saveItems(sub, [
      { kind: 'review', at: done.createdAt, id, roles: done.input.roles, overall: evaluation.overall, headline: evaluation.headline, links: done.input.links },
    ])
    console.log('[review] done', JSON.stringify({ sub, id, ms: Date.now() - started, scan: scanResult.method, sources: profiles.state }))
  } catch (err) {
    console.error('[review] run threw', id, err)
    await fail(review, 'The review did not come through. Your money is back in your balance. Try again in a minute.')
  }
}
