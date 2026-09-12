# Security Statement — dsh-campus-hunt

> The full text of the [README security section](../README.md). It applies to the
> plugin's host tools, the runtime skill (collection workflow instructions), the
> GUI cards, and the data layer.

## 1. Collection scope (domain whitelist)

- Only pages whose domain is in the `allowedDomains` whitelist are collected,
  matched by host suffix (e.g. `nowcoder.com` covers `www.nowcoder.com`).
- The whitelist defaults to `nowcoder.com`, the only channel v0.1 supports.
- Entries whose URL falls outside the whitelist are enforced by the tools at
  execution time (the tools themselves perform no network I/O):
  - `campus_job_search`: the entry is skipped, never stored, and the skip count
    is reported (`rejectedDomains`, present only when > 0);
  - `campus_job_detail`: an immediate error return (a hint for the model), never
    stored;
  - `campus_schedule`: the entry's URL is validated when present; entries
    without a URL pass through.
- Domains can be added/removed in the GUI settings card; changes take effect
  from the next tool run (the settings section is restart-scoped, and tools
  read the current config on execution).

## 2. Read-only promise

- The plugin is read-only: it collects job lists, JD details, and the campus
  schedule (JD detail pages are public without login).
- No auto-apply: it never clicks an "apply" button, fills a form, sends a
  message, or registers an account.
- Operations that require login (like applying) come back as manual steps plus
  a direct link, left to the user's own decision.
- The browser is driven by the agent via dsh-ego-browser; the plugin's host
  tools perform no network I/O.

## 3. No login / CAPTCHA bypass

- When a login popup appears on the page (Nowcoder's `.v-modal` /
  `.login-dialog` overlay): it is dismissed with Escape only, and that fact is
  recorded. No login, no account information is entered.
- When a login wall or CAPTCHA blocks the content: stop immediately and tell
  the user what's there. No retries, no bypass attempts.
- Collection takes only the first screen (~40 cards on the activity page; the
  schedule page is the same): no paging, no "load more" clicks, no
  scroll-triggered loading.

## 4. Credentials are never requested

- The plugin never asks the user for an account, password, cookie, token, or
  any credential (consistent with DSH's secrets ban).
- No credentials are stored: the three data files hold only job / tracking /
  schedule data; the job profile lives solely in the settings section (no
  workspace copy, no file produced).

## 5. Rate red lines (only tighten, never loosen)

| Red line | Default | Settings range | Semantics |
|---|---|---|---|
| Items per run `maxItemsPerRun` | 50 | 1–50 | When the returned array exceeds N items, only the first N are stored; the truncation count is reported (`truncated`, present only when > 0) |
| Navigation interval `minIntervalMs` | 1000 ms (1 s) | 1000–600000 ms (1 s–10 min) | The agent waits at least N ms between page navigations |
| JD detail collection | one at a time | not adjustable | the user picks which entry; no batch loops |

- The settings card can only tighten these red lines, never loosen them (the
  navigation interval floor is fixed at 1 s, the per-run item ceiling at 50).
- These red lines are written into the runtime skill's text (built from the
  current config); tool-side truncation / skipping takes effect from the next
  run.

## 6. Local-first: data never leaves the workspace

- All three data files (`jobs.json` / `track.json` / `schedule.json`) are
  written to the root of the current session workspace (the workspace the
  conversation lives in); no fixed personal directory, no cloud services, no
  network upload; the job profile produces no file (it lives only in the
  settings section and is supplied to the model through the profile line
  returned by `campus_job_search`).
- Apart from these three data files, the plugin reads and writes no other
  local user files. The resume file path recorded in the settings
  (`resumePath`) stores only the path string: v0.1 does not parse, read, or
  upload the resume file itself.
- For the file structures, schema version, and backup convention, see
  [workspace data files](./workspace-output.en.md).

## 7. Boundaries of this statement

- The above is v0.1's default behavior. When the user tightens the whitelist or
  rate red lines via the settings page, behavior only becomes stricter; "no
  apply / no bypass / no credential requests / data never leaves the workspace"
  are hard constraints unaffected by settings.
- If you observe any behavior inconsistent with this statement, report it to the
  maintainers (it is a bug, not a feature).
