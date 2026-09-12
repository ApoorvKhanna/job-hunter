export interface Profile {
  headline: string
  titles: string[]
  seniority: 'junior' | 'mid_level' | 'senior' | 'staff' | 'c_level' | null
  country_code: string
  remote: boolean | null
  technologies: string[]
  years: number | null
}

export interface Job {
  id: string
  title: string
  company: string
  company_domain: string | null
  company_linkedin: string | null
  location: string
  remote: boolean
  salary: string | null
  seniority: string | null
  posted: string
  url: string
  description: string
  hiring_team: Array<{ name: string; title: string | null; linkedin_url: string | null }>
}

export interface Person {
  name: string
  title: string
  headline: string | null
  location: string | null
  linkedin_url: string
  has_work_email: boolean
  has_personal_email: boolean
}

export type ApiOk<T> = { ok: true; data: T; charged_cents: number; balance_cents: number | null }
export type ApiErr = { ok: false; code: string; message: string; url?: string }
export type Api<T> = ApiOk<T> | ApiErr
