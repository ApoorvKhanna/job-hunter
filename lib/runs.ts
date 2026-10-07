// A run: one paid job search and everything it allows afterwards. One private
// blob per run, written with the same ETag pattern as the ledger.
//
// Every step input is checked against what the run itself holds: a job id
// must be one of its jobs, a person one of the contacts it found. A client can
// never point a lookup at something the run did not produce.
import { BlobPreconditionFailedError, get, put } from '@vercel/blob'
import { type AllowanceKind, RUN_ALLOWANCE } from './prices'
import type { Job, Person } from './types'

export type Usage = Record<AllowanceKind, { used: number; tries: number }>
export type Emails = { work: string[]; personal: string[] }

export interface Run {
  id: string
  sub: string
  at: string
  cents: number
  jobs: Job[]
  usage: Usage
  /** People found per job id. */
  contacts: Record<string, Person[]>
  /** Emails found per LinkedIn profile (see linkedinKey). */
  emails: Record<string, Emails>
}

export const KINDS: AllowanceKind[] = ['contacts', 'emails', 'drafts']

const path = (sub: string, id: string) => `runs/${sub}/${id}.json`

export function linkedinKey(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
}

export function canTry(usage: Usage, kind: AllowanceKind): boolean {
  const cap = RUN_ALLOWANCE[kind]
  return usage[kind].used < cap.used && usage[kind].tries < cap.tries
}

/** Lookups left, as the app shows them. Out of tries reads as none left. */
export function left(usage: Usage): Record<AllowanceKind, number> {
  const out = {} as Record<AllowanceKind, number>
  for (const kind of KINDS) {
    const cap = RUN_ALLOWANCE[kind]
    out[kind] = usage[kind].tries >= cap.tries ? 0 : Math.max(0, cap.used - usage[kind].used)
  }
  return out
}

async function load(sub: string, id: string): Promise<{ run: Run; etag: string } | null> {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null
  const blob = await get(path(sub, id), { access: 'private', useCache: false })
  if (!blob) return null
  const run = JSON.parse(await new Response(blob.stream).text()) as Run
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
    usage: { contacts: { used: 0, tries: 0 }, emails: { used: 0, tries: 0 }, drafts: { used: 0, tries: 0 } },
    contacts: {},
    emails: {},
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
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
    }
  }
  throw new Error('run_contention')
}

export type StepOutcome<T> =
  | { ok: true; data: T; left: Record<AllowanceKind, number> }
  | { ok: false; code: string; message: string; left?: Record<AllowanceKind, number> }

/** One lookup inside a run. A cached answer is free. Otherwise a try is
 *  spent before the backend call, and a hit only when it returns something,
 *  so an empty lookup never uses up the allowance. */
export async function runStep<T>(args: {
  sub: string
  runId: string
  kind: AllowanceKind
  /** A reason the input does not belong to this run, or null. */
  check: (r: Run) => string | null
  cached?: (r: Run) => T | undefined
  /** Null means nothing came back. */
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

  let reserved: Run
  try {
    reserved = await mutate(args.sub, args.runId, (r) => {
      if (!canTry(r.usage, args.kind)) throw new AllowanceSpent()
      r.usage[args.kind].tries++
    })
  } catch (err) {
    if (err instanceof AllowanceSpent) {
      return { ok: false, code: 'allowance_spent', message: 'This run has none of those left. Start a new search for more', left: left(run.usage) }
    }
    throw err
  }

  const data = await args.work(reserved)
  if (data === null) return { ok: false, code: 'miss', message: args.miss, left: left(reserved.usage) }
  const saved = await mutate(args.sub, args.runId, (r) => {
    r.usage[args.kind].used++
    args.save?.(r, data)
  })
  return { ok: true, data, left: left(saved.usage) }
}
