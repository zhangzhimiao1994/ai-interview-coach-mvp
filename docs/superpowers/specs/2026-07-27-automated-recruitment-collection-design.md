# Automated Recruitment Collection Design

Status: approved for planning
Date: 2026-07-27
Project display name: 开发面试数字人

This design supersedes `2026-07-27-job-posting-clipboard-import-design.md` for the recruitment information workflow. Manual import remains a supported source for job postings, but automated collection is the primary acquisition mechanism.

## Goal

The platform needs to automatically collect job requirements for interview training tasks from recruitment sources, while still allowing admins to manually import, edit, or add missing details. The collected or imported job information must feed the existing training task and interview room context so the AI interviewer can ask role-specific follow-up questions.

The implementation must not add product mock behavior. Tests can use controlled local fixtures for deterministic parser coverage, but runtime flows must be built around real APIs, public pages, or user-authorized browser sessions.

## Source Types

The recruitment workflow supports four source types.

1. Aggregated job APIs

   Examples: Adzuna and Jooble. These are preferred when available because they return structured job data and avoid brittle browser automation. Admins configure provider credentials, target countries or regions, rate limits, and enabled status.

2. Official or public job sources

   Examples: Greenhouse, Lever, and USAJOBS. These are used through official APIs, structured public endpoints, or stable public posting pages.

3. Authorized browser collection

   Examples: Boss直聘, 猎聘, 智联招聘, LinkedIn, and other login-gated websites. This mode only uses an admin-authorized browser session. It does not store account passwords and does not bypass captcha, access controls, or anti-abuse systems.

4. Manual import

   Admins can directly create a job posting by pasting or typing title, company, region, job description, requirements, salary, source URL, and notes. Manual import is treated as a first-class source in the job library with provider `manual`, so it can participate in review, deduplication, editing, and training task creation.

Initial implementation should prioritize Adzuna, Jooble, Greenhouse, Lever, and USAJOBS. Domestic and login-gated websites should be added through the same connector contract after the admin authorization flow is in place.

## Admin Workflow

The admin area adds four recruitment management pages.

1. Recruitment Sources

   Super-admins can add, enable, disable, verify, and delete recruitment sources. Each source has a provider, display name, source type, credential/session status, last verification time, and last successful sync time.

   Aggregated API sources store encrypted API credentials. Browser sources store encrypted browser session state, not usernames or passwords. On Windows debug machines, authorization opens a visible browser for the admin to log in. On Linux deployment, the same authorization flow is exposed as a controlled temporary reauthorization step.

2. Search Templates

   Admins define reusable search templates with keywords, role type, city, country or region, experience range, salary range, language, remote preference, enabled sources, and optional candidate binding. Search templates can be used for manual immediate sync and scheduled sync.

3. Job Library

   The job library stores normalized postings from all sources, including manual imports. Admins can filter, review, edit, merge duplicates, add manual notes, manually import postings, and create training tasks from selected postings. The library keeps original source metadata and the edited training-ready description separately.

4. Sync Runs

   Admins can trigger immediate syncs, configure schedules, inspect run history, and see actionable failures such as `AUTH_REQUIRED`, `RATE_LIMITED`, `SOURCE_UNAVAILABLE`, or `PARSER_CHANGED`. Logs must redact credentials, cookies, tokens, API keys, and browser session content.

## Data Model

The design adds the following domain entities.

- `RecruitmentSource`: provider, source type, display name, enabled status, encrypted credential reference, encrypted session reference, verification status, last verified time, last sync time.
- `RecruitmentSearchTemplate`: keywords, region fields, experience range, salary range, language, remote mode, selected providers, enabled status.
- `RecruitmentTemplateCandidate`: many-to-many binding between candidates and search templates.
- `RecruitmentSyncSchedule`: template, frequency, next run time, enabled status, lock state.
- `RecruitmentSyncRun`: source, template, status, counts, failure reason, redacted logs, started and finished timestamps.
- `RecruitmentJobPosting`: title, company, location, salary, description, requirements, source provider, source URL, external job ID, publish date, first seen time, last seen time, normalized hash, edited notes, manual import flag.

Existing `TrainingTask` data continues to store the selected job source URL, job description, and manual notes. When a task is created from the job library, including a manually imported posting, it copies the normalized and admin-edited fields into the training task snapshot so later job edits do not silently mutate old interview sessions.

## Connector Contract

Each connector implements the same high-level operations.

- `verify`: check whether credentials or sessions are usable.
- `search`: execute one search template against the source.
- `fetchDetail`: retrieve full posting details when the search result only includes a snippet.
- `normalize`: convert provider-specific fields into the shared `RecruitmentJobPosting` shape.
- `classifyFailure`: map provider failures into platform statuses.

Deduplication uses `provider + externalJobId` when available. If no stable external ID exists, it falls back to canonical source URL and then normalized content hash.

## Execution Flow

The recruitment collector runs separately from the interview room and training task APIs.

Manual sync starts immediately from the admin UI. Scheduled sync uses the same collector path and adds a per-template lock so the same template cannot run twice concurrently. Each run is idempotent: existing postings are updated with `lastSeenAt` and changed fields, while new postings are inserted.

Manual import bypasses the collector queue and writes directly to the job library through validation and deduplication. If a source URL is provided, it participates in the same canonical URL duplicate checks as automated postings.

Aggregated API and official API connectors run first because they are more stable and cheaper operationally. Browser connectors run only when the source is enabled and the encrypted session verifies successfully.

If a browser connector hits captcha, login expiry, access denial, or unusual traffic challenge, it stops the run, marks the source as `AUTH_REQUIRED` or `PAUSED`, and asks a super-admin to reauthorize. The system must not attempt automated captcha solving, hidden credential replay, or anti-abuse bypass.

## Security

Recruitment credentials and sessions use a dedicated `RECRUITMENT_SESSION_SECRET`, separate from `AI_CONFIG_SECRET`. This avoids coupling AI provider configuration encryption with browser session or recruitment API credential encryption.

Security rules:

- Store API keys and browser sessions encrypted at rest.
- Do not store recruitment website passwords.
- Do not log cookies, tokens, API keys, browser storage, or full session JSON.
- Allow only super-admins to add sources, authorize sessions, delete sessions, or reveal credential status.
- Allow normal admins to use synchronized job postings but not manage source credentials.
- Keep outbound requests server-side and validate URLs for public-source fetches.
- Respect each source's API terms and access controls. If a website prohibits automation or blocks collection, the connector remains disabled until an official or permitted channel is available.

## Testing

Testing follows the project's no-product-mock rule.

- Domain tests cover deduplication, normalization, search template matching, status transitions, and training task snapshot creation.
- Connector parser tests can use sanitized real page snapshots or official example payloads to keep parsing deterministic. These tests do not create product mock behavior.
- Live smoke tests cover Adzuna, Jooble, Greenhouse, Lever, and USAJOBS with real credentials or public endpoints when available.
- Login-gated browser source smoke tests are manual/admin-authorized because they require real sessions and may need human reauthorization.
- Manual import tests cover validation, deduplication, editing, and training task creation without external network calls.
- End-to-end validation covers search template sync, job library review, training task creation, and interview room context injection.
- Docker can be used for deployment parity testing only when needed. After any Docker debugging run, Docker must be stopped.

Each completed implementation phase must be tested, committed, and pushed to GitHub. Docker and source versions must stay synchronized.

## References

- Adzuna API overview: https://developer.adzuna.com/overview
- Jooble REST API documentation: https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation
- USAJOBS Search API: https://developer.usajobs.gov/api-reference/get-api-search
