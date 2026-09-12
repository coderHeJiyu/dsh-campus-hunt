# Installation Guide — dsh-campus-hunt

> The expanded version of the [README installation section](../README.md),
> covering the five steps: prerequisites, install, verify, update, uninstall.

## Prerequisites

1. **DSH (DeepSeek Harness) installed**, with an initialized `web` profile (the
   plugin is installed into that profile: `--profile web`).
2. **Node.js ≥ 22** (the plugin package declares `node >= 22`).
3. **pnpm**. `dsh plugin` manages plugins through pnpm, so it must be
   installed; the from-source path additionally uses `pnpm install` /
   `pnpm build` for dependencies and the build.
4. **The dsh-ego-browser collection backend**. Required for Nowcoder page
   collection: the agent uses its `ego_*` tools to open and extract the Nowcoder
   pages (the job list page is JS-rendered, so plain HTTP fetching returns
   nothing). It requires DSH ≥ 0.1.2-rc.1. On Windows the ego browser runs
   headed (a visible browser window during collection is normal); human
   verification (CAPTCHA) must be completed by the user in the watch window
   (the headed browser window / the Agent Browser watch panel). Install it with:

   ```powershell
   dsh plugin --profile web add github:Fisfzy/dsh-ego-browser#master
   ```

## Installation

### From GitHub directly (recommended)

```powershell
dsh plugin --profile web add github:coderHeJiyu/dsh-campus-hunt
```

Installs straight from the GitHub repository, pulling the HEAD of the default
branch. The repo ships the prebuilt `lib/` artifacts, so no `prepare` build
script runs at install and pnpm ≥10 needs no `allowBuilds` allowance.

### From source (trial / development)

Best for trying the plugin from source or keeping it mounted while developing.
Clone the repo, install dependencies, build, then mount:

```powershell
git clone https://github.com/coderHeJiyu/dsh-campus-hunt.git
cd dsh-campus-hunt
pnpm install
pnpm build
dsh plugin --profile web add .
```

`pnpm build` produces `lib/` (the package's `files` field references it, so it
must exist before installation); the final `add .` runs in the repo root and
installs the current directory. For local development you can instead install
as a `link:` symlink (run `pnpm dev` to watch the build: client-side changes
hot-reload, host-side changes need a `dsh web` restart):

```powershell
dsh plugin --profile web add link:/path/to/checkout
```

## Verification

```powershell
dsh plugin --profile web list
dsh web --dump-config | Select-String campus-hunt
```

Check each item:

1. `dsh plugin --profile web list` shows `dsh-campus-hunt`, meaning the plugin
   is registered in the web profile;
2. `dsh web --dump-config | Select-String campus-hunt` hits the `campus-hunt`
   section. This is the plugin's settings section (where the GUI settings card
   is persisted), and the defaults should be `allowedDomains: [nowcoder.com]`,
   `maxItemsPerRun: 50`, `minIntervalMs: 1000`, empty profile arrays, and an
   empty `resumePath`;
3. **Restart the DSH Web GUI**. The settings section takes effect on restart,
   and so does the runtime skill registration;
4. In the GUI, start a session and ask the agent "show me Nowcoder's fall
   recruitment jobs":
   - the agent should run the campus-hunt workflow (the ego browser opens the Nowcoder
     pages → extracts → stores via `campus_job_search`);
   - the job card (job list / detail / application tracking tabs) appears at
     the end of the turn's answer;
   - `jobs.json` is created in the session workspace.

## Updating

- **GitHub install**: re-run the install command, which re-resolves to the
  latest commit of the default branch:

  ```powershell
  dsh plugin --profile web add github:coderHeJiyu/dsh-campus-hunt
  ```

- **From source**: refresh the repo (e.g. `git pull`), rebuild (`pnpm build`),
  and re-run from the repo root:

  ```powershell
  dsh plugin --profile web add .
  ```

  A `link:` symlink install needs no re-install: with `pnpm dev` watching the
  build, client-side changes hot-reload, and the host side takes effect on a
  `dsh web` restart.

- After updating, restart the GUI to apply.
- The three workspace data files (`jobs.json` / `track.json` /
  `schedule.json`) do not depend on the plugin version; updates never delete
  or overwrite them. The schema version and the `.pre-schema-<version>.bak`
  backup convention are documented in
  [workspace data files](./workspace-output.en.md).

## Uninstalling

```powershell
dsh plugin --profile web remove dsh-campus-hunt
```

After uninstalling:

- the plugin's 4 tools, the answer-area card, the settings card, and the
  `campus-hunt` skill all disappear;
- the three workspace data files are not removed automatically; back them up
  first if needed, then delete them manually.

## Related documentation

- [Security statement](./security.en.md)
- [Workspace data files](./workspace-output.en.md)
- [Back to README](../README.md)
