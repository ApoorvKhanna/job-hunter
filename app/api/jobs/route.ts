// Start a run: one job search. The balance must cover the run before we
// search; the run is charged only when at least one job comes back.
import { NextResponse } from 'next/server'
import { bucketFor, searchJobs } from '@/lib/jsearch'
import { InsufficientBalance, credit, debit } from '@/lib/ledger'
import { MAX_JOBS, MAX_SEARCH_TITLES, RUN_CENTS } from '@/lib/prices'
import { caller, readJson } from '@/lib/route'
import { createRun, left } from '@/lib/runs'
import { saveItems } from '@/lib/saved'
import type { Job } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Merge pages without showing the same posting twice. */
function mergeJobs(...lists: Job[][]): Job[] {
  const seen = new Set<string>()
  const out: Job[] = []
  for (const list of lists) {
    for (const j of list) {
      const k = `${j.company.trim().toLowerCase()}|${j.title.trim().toLowerCase()}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(j)
    }
  }
  return out
}

export async function POST(req: Request) {
  const who = await caller()
  if ('response' in who) return who.response
  const { session, account } = who

  const body = await readJson<{ titles?: string[]; country_code?: string; remote?: boolean | null; days?: number }>(req)
  const titles = (body.titles ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, MAX_SEARCH_TITLES)
  if (titles.length === 0) return NextResponse.json({ ok: false, code: 'invalid', message: 'Add at least one job title' })
  const days = Math.min(60, Math.max(1, Number(body.days ?? 14)))
  const country = body.country_code && /^[A-Z]{2}$/i.test(body.country_code) ? body.country_code.toUpperCase() : null
  const remote = body.remote === true

  if (account.balanceCents < RUN_CENTS) {
    return NextResponse.json({ ok: false, code: 'add_funds', message: 'Add funds to start a search', balance_cents: account.balanceCents, need_cents: RUN_CENTS })
  }

  const stats: Record<string, number> = {}
  const first = await searchJobs({ titles, countryCode: country, remoteOnly: remote, days, page: 0 }, account)
  if (!first.ok) {
    return NextResponse.json({ ok: false, code: first.code, message: 'Job search did not go through. Nothing was charged. Try again in a minute', balance_cents: account.balanceCents })
  }
  let jobs = first.jobs
  stats.first = jobs.length

  // Thin? Retry on the wider bucket. `week` is denser but nominally misses
  // days 8 to 14, so this catches those.
  if (jobs.length < MAX_JOBS && bucketFor(days) !== 'month') {
    const wider = await searchJobs({ titles, countryCode: country, remoteOnly: remote, days, page: 0, bucket: 'month' }, account)
    if (wider.ok && wider.jobs.length > 0) {
      stats.month = wider.jobs.length
      jobs = mergeJobs(jobs, wider.jobs).slice(0, MAX_JOBS)
    }
  }

  // Nothing at all? Widen to 30 days, then to any country, before giving up.
  if (jobs.length === 0) {
    for (const t of [{ days: 30, country }, { days: 30, country: null }]) {
      if (t.days === days && t.country === country) continue
      const wide = await searchJobs({ titles, countryCode: t.country, remoteOnly: remote, days: t.days, page: 0 }, account)
      if (!wide.ok) break
      if (wide.jobs.length > 0) {
        stats.widened = wide.jobs.length
        jobs = wide.jobs
        break
      }
    }
  }

  console.log('[jobs]', JSON.stringify({ ...stats, found: jobs.length, titles, days, country, remote }))

  if (jobs.length === 0) {
    return NextResponse.json({
      ok: false,
      code: 'no_jobs',
      message: 'No postings matched those titles, even after widening the search. Nothing was charged. Try simpler titles, like "Product Manager"',
      balance_cents: account.balanceCents,
    })
  }

  let balance = account.balanceCents
  try {
    balance = (await debit(session.sub, RUN_CENTS, `Search: ${titles[0]}`)).balanceCents
  } catch (err) {
    if (err instanceof InsufficientBalance) {
      return NextResponse.json({ ok: false, code: 'add_funds', message: 'Add funds to start a search', balance_cents: err.balanceCents, need_cents: RUN_CENTS })
    }
    // The search already ran. Never turn a ledger hiccup into a failed step:
    // open the run uncharged and log it.
    console.error('[ledger] debit failed after a search', session.sub, err)
  }

  let run
  try {
    run = await createRun(session.sub, RUN_CENTS, jobs)
  } catch (err) {
    console.error('[run] create failed, refunding', session.sub, err)
    if (balance !== account.balanceCents) await credit(session.sub, RUN_CENTS, 'Refund: search could not be saved').catch(() => {})
    return NextResponse.json({ ok: false, code: 'failed', message: 'That search could not be saved. Nothing was charged. Try again' })
  }

  await saveItems(
    session.sub,
    jobs.map((j) => ({
      kind: 'job' as const,
      at: new Date().toISOString(),
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      remote: j.remote,
      salary: j.salary,
      posted: j.posted,
      url: j.url,
    })),
  ).catch((e) => console.error('[saved] jobs', e))

  return NextResponse.json({ ok: true, data: { run_id: run.id, jobs, left: left(run.usage) }, balance_cents: balance, charged_cents: balance === account.balanceCents ? 0 : RUN_CENTS })
}
