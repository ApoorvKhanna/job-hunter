// Flag + name for the country picker. Emoji flags are two regional indicators.
function flag(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
const LIST: Array<[string, string]> = [
  ['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'],
  ['DE', 'Germany'], ['NL', 'Netherlands'], ['SG', 'Singapore'], ['AE', 'United Arab Emirates'], ['IE', 'Ireland'],
  ['FR', 'France'], ['ES', 'Spain'], ['PT', 'Portugal'], ['SE', 'Sweden'], ['CH', 'Switzerland'], ['PL', 'Poland'],
  ['JP', 'Japan'], ['KR', 'South Korea'], ['HK', 'Hong Kong'], ['NZ', 'New Zealand'], ['BR', 'Brazil'], ['MX', 'Mexico'],
  ['SA', 'Saudi Arabia'], ['QA', 'Qatar'], ['ZA', 'South Africa'], ['NG', 'Nigeria'], ['KE', 'Kenya'], ['PH', 'Philippines'],
  ['ID', 'Indonesia'], ['MY', 'Malaysia'], ['VN', 'Vietnam'], ['IL', 'Israel'], ['IT', 'Italy'], ['BE', 'Belgium'],
  ['AT', 'Austria'], ['DK', 'Denmark'], ['NO', 'Norway'], ['FI', 'Finland'], ['CZ', 'Czech Republic'], ['RO', 'Romania'],
]
export const COUNTRIES = LIST.map(([code, name]) => ({ code, name, flag: flag(code) }))
export function countryFlag(code: string): string {
  return /^[A-Z]{2}$/i.test(code) ? flag(code) : ''
}
