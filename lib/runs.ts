// A run: one paid job search and everything it allows afterwards. One private
// blob per run, written with the same ETag pattern as the ledger.
//
// Every step input is checked against what the run itself holds: a job id
// must be one of its jobs, a person one of the contacts it found. A client can
// never point a lookup at something the run did not produce.
import { BlobPreconditionFailedError, get, put } from '@vercel/blob'
import { type AllowanceKind, RUN_ALLOWANCE } from './prices'
import type { Job, Person } from './types'

/** Per kind: `tries` = attempts that reached a backend, `used` = attempts
 *  that returned something, `misses` = attempts that came back empty. A try
 *  that is neither is still in flight, and counts against the cap so that
 *  parallel requests cannot run past it. */
export type Usage = Record<AllowanceKind, { used: number; tries: number; misses: number }>
export type Emails = { work: string[]; personal: string[] }

export interface Run {
  id: string
  sub: string
  at: string
  cents: number
  jobs: Job[]
  usage: Usage
  /** People found per company (see companyKey). */
  contacts: Record<string, Person[]>
  /** Emails found per LinkedIn profile (see linkedinKey). */
  emails: Record<string, Emails>
  /** Keys whose lookup came back empty, so asking again is a free miss. */
  missed: Partial<Record<AllowanceKind, string[]>>
}

export const KINDS: AllowanceKind[] = ['contacts', 'emails', 'drafts']

const path = (sub: string, id: string) => `runs/${sub}/${id}.json`

const fresh = () => ({ used: 0, tries: 0, misses: 0 })

/** Lookups this run may still start. */
function room(usage: Usage, kind: AllowanceKind): number {
  const cap = RUN_ALLOWANCE[kind]
  const u = usage[kind]
  // tries - misses = used + in flight
  return Math.max(0, Math.min(cap.used - (u.tries - u.misses), cap.tries - u.tries))
}

/** Lookups left, as the app shows them. */
export function left(usage: Usage): Record<AllowanceKind, number> {
  const out = {} as Record<AllowanceKind, number>
  for (const kind of KINDS) out[kind] = room(usage, kind)
  return out
}

async function load(sub: string, id: string): Promise<{ run: Run; etag: string } | null> {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null
  const blob = await get(path(sub, id), { access: 'private', useCache: false })
  if (!blob) return null
  const run = JSON.parse(await new Response(blob.stream).text()) as Run
  run.missed ??= {}
  for (const kind of KINDS) run.usage[kind] = { ...fresh(), ...run.usage[kind] }
  const etag = (blob.headers?.get('etag') ?? blob.headers?.get('ETag') ?? '').replace(/^W\//, '')
  return { run, etag }
}

export async function getRun(sub: string, id: string): Promise<Run | null> {
  return (await load(sub, id))?.run ?? null
}

export async function createRun(sub: string, cents: number, jobs: Job[]): Promise<Run> {
  const run: Run = {
    id: crypto.randomUUID(),
    sub,
    at: new Date().toISOString(),
    cents,
    jobs,
    usage: { contacts: fresh(), emails: fresh(), drafts: fresh() },
    contacts: {},
    emails: {},
    missed: {},
  }
  await put(path(sub, run.id), JSON.stringify(run), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: false,
  })
  return run
}

export class AllowanceSpent extends Error {
  constructor() {
    super('allowance_spent')
  }
}

async function mutate(sub: string, id: string, fn: (r: Run) => void): Promise<Run> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await load(sub, id)
    if (!found) throw new Error('no_run')
    const next = structuredClone(found.run)
    fn(next)
    try {
      await put(path(sub, id), JSON.stringify(next), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        ...(found.etag ? { ifMatch: found.etag } : {}),
      })
      return next
    } catch (err) {
      const stale = err instanceof BlobPreconditionFailedError || /precondition/i.test(String((err as Error)?.message ?? ''))
      if (!stale || attempt === 3) throw err
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 200 * (attempt + 1)))
    }
  }
  throw new Error('run_contention')
}

export type StepOutcome<T> =
  | { ok: true; data: T; left: Record<AllowanceKind, number> }
  | { ok: false; code: string; message: string; left?: Record<AllowanceKind, number> }

/** One lookup inside a run. A cached answer, or a key that already came back
 *  empty, is free. Otherwise a try is reserved before the backend call; an
 *  empty answer records a miss, which never uses up the allowance, and a
 *  backend error hands the try back. */
export async function runStep<T>(args: {
  sub: string
  runId: string
  kind: AllowanceKind
  /** A reason the input does not belong to this run, or null. */
  check: (r: Run) => string | null
  cached?: (r: Run) => T | undefined
  /** What a miss is remembered under (a company, a profile). */
  key?: (r: Run) => string
  /** Null means nothing came back. Throwing means the backend failed. */
  work: (r: Run) => Promise<T | null>
  save?: (r: Run, data: T) => void
  miss: string
}): Promise<StepOutcome<T>> {
  const run = await getRun(args.sub, args.runId)
  if (!run) return { ok: false, code: 'no_run', message: 'That search is no longer available. Start a new search' }
  const invalid = args.check(run)
  if (invalid) return { ok: false, code: 'invalid', message: invalid, left: left(run.usage) }
  const hit = args.cached?.(run)
  if (hit !== undefined) return { ok: true, data: hit, left: left(run.usage) }
  const missKey = args.key?.(run)
  if (missKey && run.missed[args.kind]?.includes(missKey)) {
    return { ok: false, code: 'miss', message: args.miss, left: left(run.usage) }
  }

  let reserved: Run
  try {
    reserved = await mutate(args.sub, args.runId, (r) => {
      if (room(r.usage, args.kind) <= 0) throw new AllowanceSpent()
      r.usage[args.kind].tries++
    })
  } catch (err) {
    if (err instanceof AllowanceSpent) {
      return { ok: false, code: 'allowance_spent', message: 'This run has none of those left. Start a new search for more', left: left(run.usage) }
    }
    throw err
  }

  let data: T | null
  try {
    data = await args.work(reserved)
  } catch (err) {
    await mutate(args.sub, args.runId, (r) => {
      r.usage[args.kind].tries = Math.max(0, r.usage[args.kind].tries - 1)
    }).catch((e) => console.error('[run] could not hand back a try', args.runId, e))
    throw err
  }
  if (data === null) {
    const after = await mutate(args.sub, args.runId, (r) => {
      r.usage[args.kind].misses++
      if (missKey) r.missed[args.kind] = [...(r.missed[args.kind] ?? []), missKey]
    })
    return { ok: false, code: 'miss', message: args.miss, left: left(after.usage) }
  }
  const saved = await mutate(args.sub, args.runId, (r) => {
    r.usage[args.kind].used++
    args.save?.(r, data)
  })
  return { ok: true, data, left: left(saved.usage) }
}
