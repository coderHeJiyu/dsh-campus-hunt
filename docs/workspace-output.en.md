# Workspace Data Files — dsh-campus-hunt

> The plugin produces three data files: `jobs.json` / `track.json` /
> `schedule.json`. All are local-first: they live in the root of the current
> session workspace (the workspace the conversation lives in); no fixed
> personal directory, and the data never leaves the workspace. The job profile
> produces no file (it lives only in the settings section and is supplied to
> the model through the profile line returned by `campus_job_search`).

## Location and envelope format

- Location: the root of the current session workspace. Tools resolve the
  agent session's workspace path (session header cwd) at runtime; a call with
  no session workspace errors out (isError) and never falls back to the host
  process's cwd.
- Envelope: every file is `{ "schema": 0, "data": <payload> }`; the current
  schema version is v0.
- Write format: 2-space indentation and a trailing newline; writes go through
  a temp file plus rename, so no half-written file can remain.
- When a file does not exist, readers continue with their empty payload (empty
  job store / empty ledger / empty schedule) and do not create the file.

## jobs.json — job store

`data.jobs`: an array of job records, keyed by `id` (the Nowcoder job id).
Maintained by `campus_job_search` (list collection, deduplicated & merged by
id) and `campus_job_detail` (JD detail, one at a time, written into
`job.jd`).

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Nowcoder job id (`<id>` in the list-page href `/jobs/detail/<id>`); primary key; dedup/merge is by this |
| `company` | string | yes | Company name |
| `title` | string | yes | Job title |
| `city` | string | no | City (e.g. "Beijing") |
| `salary` | string | no | Salary verbatim (e.g. "40-70K·14薪") |
| `degree` | string | no | Degree requirement (e.g. "Master's") |
| `deadline` | string | no | Deadline (ISO `YYYY-MM-DD` recommended) |
| `graduationYear` | string | no | Graduation requirement verbatim (from the JD page) |
| `url` | string | no | JD detail page URL (`https://www.nowcoder.com/jobs/detail/<id>`) |
| `fetchedAt` | string | yes | Fetch time (ISO 8601) |
| `jd` | object | no | JD detail (written by `campus_job_detail`; jobs without a fetched detail have no such key): `description[]` responsibilities (line by line), `requirements[]` requirements (line by line), `bonus[]?` bonus items (omitted when absent on the page) |

Example:

```json
{
  "schema": 0,
  "data": {
    "jobs": [
      {
        "id": "123456",
        "company": "Kuaishou",
        "title": "LLM Application Engineer (Fall Recruitment)",
        "city": "Beijing",
        "salary": "40-70K·14薪",
        "degree": "Master's",
        "deadline": "2026-12-31",
        "graduationYear": "20XX届",
        "url": "https://www.nowcoder.com/jobs/detail/123456",
        "fetchedAt": "2026-09-04T12:30:00.000Z",
        "jd": {
          "description": ["Responsible for LLM application R&D"],
          "requirements": ["Master's degree or above", "Familiar with LLM inference and calling pipelines"]
        }
      }
    ]
  }
}
```

## track.json — application tracking ledger

`data.tracks`: an array of tracking records; `id` aligns with the job id in
`jobs.json` (jobs that were never collected get an id derived from
company+title). Maintained by `job_track` (list / add / update / status); it is
the data source of the GUI "application tracking" tab; pure local read/write,
no network.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Job id |
| `company` | string | yes | Company name |
| `title` | string | yes | Job title |
| `status` | string | yes | Application status; enum: `未处理` / `已投递` / `笔试` / `面试` / `已拒` / `offer` (Chinese direct values: model input, GUI display, and JSON storage all use the same values) |
| `note` | string | no | Free-form note (interview round, written-test link hint, etc.) |
| `deadline` | string | no | Deadline (ISO `YYYY-MM-DD` recommended) |
| `createdAt` | string | yes | Record creation time (ISO 8601) |
| `updatedAt` | string | yes | Last update time (ISO 8601) |

Example:

```json
{
  "schema": 0,
  "data": {
    "tracks": [
      {
        "id": "123456",
        "company": "Kuaishou",
        "title": "LLM Application Engineer (Fall Recruitment)",
        "status": "已投递",
        "note": "applied via Nowcoder on 9.5",
        "deadline": "2026-12-31",
        "createdAt": "2026-09-05T02:00:00.000Z",
        "updatedAt": "2026-09-05T02:00:00.000Z"
      }
    ]
  }
}
```

## schedule.json — campus schedule

`data.items`: an array of schedule entries, maintained by `campus_schedule`
(first screen of the Nowcoder schedule page), deduplicated & merged by
`company`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `company` | string | yes | Company name |
| `openDate` | string | no | Recording date (ISO `YYYY-MM-DD`, converted from the card's "MM.dd收录" by adding the current year; omitted when the card has no date) |
| `type` | string | yes | Batch label verbatim (e.g. "提前批" / "网申中"; "未知" when the card has no batch label) |
| `cities` | string | no | Location city string verbatim (e.g. "杭州、深圳、北京") |
| `source` | string | yes | Source URL (the Nowcoder schedule page) |

Example:

```json
{
  "schema": 0,
  "data": {
    "items": [
      {
        "company": "Kuaishou",
        "openDate": "2026-08-20",
        "type": "提前批",
        "cities": "北京、上海",
        "source": "https://www.nowcoder.com/jobs/school/schedule"
      }
    ]
  }
}
```

## schema v0 and the `.pre-schema-<version>.bak` convention

- All three files carry the schema version in the envelope's `schema` field;
  v0.1 reads and writes v0 only.
- Version mismatch → back up + continue with empty data (following
  dsh-job-hunting's data-file `.pre-schema-<version>.bak` practice): when a
  tool reads a file whose root is not an object, or whose `schema` does not
  match the current plugin version (for example a file written by a newer
  plugin version being read by an older one):
  1. the original file is backed up as `<filename>.pre-schema-<v>.bak` (v is
     the reading plugin's version; in v0.1 that is 0, e.g.
     `jobs.json.pre-schema-0.bak`);
  2. migration is refused and nothing crashes; the tool continues with empty
     data (empty job store / empty ledger / empty schedule).
- Corrupt JSON is not treated as a version mismatch: an unparseable byte
  stream produces a loud error (isError). The original file is left intact for
  manual inspection; no automatic backup, no automatic overwrite.

## Data is independent of the plugin version

- The three files are plain JSON, decoupled from the plugin's install state:
  updating / uninstalling the plugin never deletes or overwrites them
  automatically; back them up, move them, or delete them manually (see the
  [installation guide](./installation.en.md) for uninstall details).
- When a future plugin version bumps the schema version: older plugins reading
  the newer files follow the "version mismatch → back up + continue with empty
  data" rule above (the `.bak` preserves the scene); the new version's
  compatibility/migration policy will be documented with that release.
- The structures are authoritative in `src/nowcoder/types.ts` (types) and
  `src/data/store.ts` (envelope / read-write / backup).
