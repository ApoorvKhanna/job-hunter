// What each step costs the user, in paise. Debited only when the step succeeds.
export const PRICE_PAISE = {
  parse: 100,
  jobs: 2000,
  contact: 300,
  email: 1000,
  draft: 100,
} as const
export type Step = keyof typeof PRICE_PAISE

export function inr(paise: number): string {
  const rupees = paise / 100
  return Number.isInteger(rupees) ? `₹${rupees}` : `₹${rupees.toFixed(2)}`
}

export const RECHARGE_OPTIONS_INR = [49, 99, 199, 499] as const
