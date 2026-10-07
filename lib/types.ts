export interface Profile {
  headline: string
  titles: string[]
  country_code: string
  remote: boolean | null
  years: number | null
}

export interface Job {
  id: string
  title: string
  company: string
  company_domain: string | null
  /** ISO country code of the posting, when the source states it. */
  country: string | null
  location: string
  remote: boolean
  salary: string | null
  posted: string
  url: string
  description: string
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
