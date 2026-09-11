---
name: jobhunt
description: Job hunt from a resume through Vaaya. Finds matching postings (TheirStack), the hiring manager or recruiter at each company (ContactOut), their email, and drafts the outreach note. Use when the user pastes a resume or asks to find jobs, hiring managers, or write outreach for a role.
---

# Job hunt through Vaaya

You run four Vaaya calls per company, in order, quoting the price before each.
All calls go through the Vaaya MCP `use` tool on the user's own credit.

## 1. Read the resume (free, you do it)

From the resume text, decide:
- 3 to 5 `titles` phrased the way employers post them
- `seniority`: one of `junior`, `mid_level`, `senior`, `staff`, `c_level`
- `country_code` (two letters), `remote` (true only if the resume says so)

Show the user these and let them edit before spending anything.

## 2. Postings (40¢ flat, up to 10)

```
use({ service: "theirstack", action: "jobs", max_cost_cents: 40, params: {
  job_title_or: <titles>, posted_at_max_age_days: 14, limit: 10,
  job_country_code_or: [<country_code>], remote: <true or omit>,
  job_seniority_or: [<seniority>]
}})
```

Read `data.data[]`: `job_title`, `company`, `company_domain`, `short_location`,
`salary_string`, `date_posted`, `url`, `description`, `hiring_team[]`.
Show a numbered list. If `hiring_team` is non-empty, name them for free.

## 3. Who is hiring (3¢ for 3 profiles)

For the posting the user picks:

```
use({ service: "contactout", action: "people-search", max_cost_cents: 3, params: {
  job_title: ["Engineering Manager OR Head of Engineering OR Technical Recruiter OR Talent Acquisition"],
  company: [<company>], current_titles_only: true, company_filter: "current", page_size: 3
}})
```

`data.profiles` is a map keyed by LinkedIn URL with `full_name`, `headline`,
`contact_availability.work_email`. Swap the title query for design or
product roles.

## 4. Email (10¢, billed only on a hit)

```
use({ service: "contactout", action: "linkedin-contacts", max_cost_cents: 10,
      params: { profile: <linkedin url>, include_phone: false }})
```

Read `data.profile.work_email[]` then `personal_email[]`.

## 5. The note (you write it)

90 to 130 words. `Subject:` line first. Open with one concrete thing from the
posting the candidate has actually done. One or two proof points with numbers
from the resume. Close with a five-word ask for a 15-minute call. No
em-dashes, no exclamation marks, never invent experience.

## Rules

- Quote the price and wait for a yes before every paid call.
- A refused call (`card_required`, `credits_required`) costs nothing: relay
  Vaaya's message and link verbatim.
- Never run `people-search` for a company the user did not pick.
