// Every knob the app reads. VAAYA_CLIENT_ID comes from one POST to
// https://vaaya.ai/oauth/register (see README); APP_URL must match the
// redirect_uri registered there exactly.
export const ISSUER = (process.env.VAAYA_ISSUER ?? 'https://vaaya.ai').replace(/\/$/, '')
export const CLIENT_ID = process.env.VAAYA_CLIENT_ID ?? ''
export const APP_URL = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
export const SESSION_SECRET = process.env.SESSION_SECRET ?? ''
export const REDIRECT_URI = `${APP_URL}/api/auth/callback`
export const SCOPES = 'vaaya:pay vaaya:read'

export function assertConfigured(): string | null {
  if (!CLIENT_ID) return 'VAAYA_CLIENT_ID is not set'
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) return 'SESSION_SECRET must be at least 32 chars'
  return null
}
