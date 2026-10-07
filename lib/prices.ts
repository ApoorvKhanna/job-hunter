// What the user pays, in US cents. One run = one job search. Its price is
// checked before the search and charged only when at least one job comes
// back; a search that finds nothing is free. Reading a resume is free.
export const RUN_CENTS = 250

// What one run includes. `used` counts lookups that returned something;
// `tries` bounds attempts that came back empty. An empty lookup never uses up
// the allowance, but it still costs a backend call, so tries are capped too.
export const RUN_ALLOWANCE = {
  contacts: { used: 3, tries: 5 },
  emails: { used: 3, tries: 5 },
  drafts: { used: 15, tries: 18 },
} as const
export type AllowanceKind = keyof typeof RUN_ALLOWANCE

/** Job titles one search sends, and jobs one search returns. */
export const MAX_SEARCH_TITLES = 3
export const MAX_JOBS = 10

/** Card top-ups offered in the add-funds sheet, in whole US dollars. */
export const TOP_UP_USD = [5, 10, 25] as const

/** "$2.50", "$10" */
export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`
}
