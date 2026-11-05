# AGENTS.md

Guidance for AI agents working in the `yvyty/.github` repository.

## What this repository is

This is the GitHub **organization profile** repo for the `yvyty` org
(`git@github.com:yvyty/.github.git`). It ships no product code; its job is the
org profile page plus the automation that keeps it current.

| Path | Role |
| --- | --- |
| `profile/README.md` | The profile rendered at <https://github.com/yvyty>. The project showcase lives between `<!-- PROJECTS:START -->` and `<!-- PROJECTS:END -->`. |
| `README.md` | This repo's own landing page. Not the org profile. |
| `scripts/sync-projects.mjs` | Regenerates the PROJECTS block from the org's public repos. |
| `.github/workflows/sync-profile.yml` | Runs that script nightly, on dispatch, and on relevant pushes, then commits the result. |

`.crush/` is local agent state (self-ignored via `.crush/.gitignore`); never
commit it.

## Workspace layout: sibling product repos

This checkout sits next to the org's product repositories in the parent
directory. They are **independent git repositories with their own remotes**;
there is no umbrella repo, no submodules, and no shared build. A change to a
product must be committed in that product's repo, not here.

| Sibling | What it is | Build system | Its own AGENTS.md |
| --- | --- | --- | --- |
| `../anthill` | C11 CLI that enumerates bindable TCP/UDP ports ("squadrons") | CMake + CTest | `../anthill/AGENTS.md` |
| `../guara` | Rust workspace: filesystem search, tracking, light-security CLI | Cargo | `../guara/AGENTS.md` |
| `../yvyty.github.io` | The YVYTY landing page (React 19 + Vite + Tailwind v4) | npm | `../yvyty.github.io/AGENTS.md` |

Those per-repo AGENTS.md files are authoritative for their projects: read the
one you are about to edit. Do not copy their detail into this file.

## Commands (quick reference)

```sh
# anthill (from ../anthill)
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release
ctest --test-dir build --output-on-failure      # test_net is labeled "network"

# guara (from ../guara)
cargo build -p guara && cargo test && cargo clippy --all-targets -- -D warnings

# yvyty.github.io (from ../yvyty.github.io)
npm ci && npm run dev        # npm run build runs `tsc -b && vite build` + a GitHub-API prebuild
```

## Org profile showcase sync

`scripts/sync-projects.mjs` fetches `api.github.com/orgs/yvyty/repos`, drops
forks, archived/disabled repos, private repos, and the `EXCLUDED` meta-repos
(`.github`, `yvyty.github.io`), then rewrites **only** the text between the
PROJECTS markers in `profile/README.md`. Everything outside the markers is
hand-written and safe to edit. Top-level `await` is used, so the file needs the
`.mjs` extension.

```sh
node scripts/sync-projects.mjs     # update the block in place
git diff profile/README.md         # inspect the result
```

- **Fail-open**: on an API error it warns and leaves the committed block
  untouched, so a rate limit never blanks the profile.
- **Idempotent**: it writes nothing when the rendered block is unchanged (a
  second run prints `README is already up to date`). There is no timestamp in
  the block on purpose, so quiet days produce no commit.
- `GITHUB_TOKEN`/`GH_TOKEN` are used when present for a higher rate limit.
- Private repos cannot be discovered by the public API, so list them in
  `MANUAL_PROJECTS`. A manual entry is skipped automatically once the repo goes
  public. Set `url: null` for a private repo: it renders unlinked with a 🔒
  instead of a link that would 404 for visitors.
- A leading emoji in a repo description is promoted into the linked title; add
  one to the `EMOJI` map otherwise.
- `PINNED_ORDER` controls which repos come first; the rest follow by stars, then
  name.
- `renderProjects` and `injectProjects` are exported for quick local checks
  (import the file directly instead of running it).

`main` is protected by a ruleset that requires pull requests (0 approvals), so
the workflow never pushes to `main` directly: it commits to the
`automation/profile-sync` branch, opens a PR with
`peter-evans/create-pull-request`, and squash-merges it with `gh pr merge`.
Everything uses `GITHUB_TOKEN`, which does **not** re-trigger workflows, so the
merge cannot loop. It needs `contents: write` and `pull-requests: write`, plus
the repo setting *Settings → Actions → General → Allow GitHub Actions to create
and approve pull requests*; without it the PR step fails.
GitHub also disables scheduled workflows after 60 days without repo activity,
which a manual `workflow_dispatch` run resets.

## Org-wide conventions

- **Commit messages are Conventional Commits** (`feat:`, `fix:`, `refactor:`,
  `chore:`), one logical change per commit, explain the why.
- **Product names are Guarani-derived**: "YVYTY" evokes land/foundation/origin;
  `guara` is the maned wolf. Anthill's ant/squadron/colony vocabulary is
  intentional branding, not filler. Preserve it when editing user-facing text.
- **`AGENTS.md` must exist at each repo root.** `guara`'s integration test
  `the_checked_in_tree_contains_no_executable_payload` asserts it, so do not
  delete or move it.
- **License is MIT** for the products. `yvyty.github.io` is a site, not a
  licensed library.
- **Do not commit build output**: `/target` (guara), `build/` and the compiled
  `anthill` binary (anthill), `node_modules/` and `dist/` (site).
- `anthill` uses a plan-driven workflow in `.plan/` (git-ignored, so it is not in
  history); development happens on `plan/branch-<N>` branches.

## How the landing page consumes the org

`../yvyty.github.io` builds its "Our Projects" grid from the org itself, which is
why repo visibility and naming here have site-visible effects:

- The site has its **own** `scripts/sync-projects.mjs`, unrelated to this repo's
  script of the same name. It runs as the site's `prebuild` hook and nightly via
  `.github/workflows/deploy.yml`, queries `api.github.com/orgs/yvyty/repos`, and
  writes `src/data/projects.generated.json`.
- It **drops** forks, archived/disabled repos, private repos, and the meta-repos
  listed in its `EXCLUDED` set: `.github` and `yvyty.github.io`. This repo is
  therefore never shown as a project.
- `src/data/projects.ts` overlays hand-maintained copy and metadata:
  `OVERRIDES` (per-repo taglines, e.g. anthill's and guara's descriptions) and
  `MANUAL_PROJECTS` (private repos invisible to the public API; currently
  empty). A private entry renders as an unlinked card with a "Private" badge;
  do not add a `url` to it.
- Consequence: publishing or renaming a public repo under `yvyty` makes it
  appear on the site automatically at the next build or nightly cron. When a
  private repo goes public, delete its `MANUAL_PROJECTS` entry in **both** this
  repo's script and the site, and move any copy worth keeping into `OVERRIDES`
  (site) or `TITLES`/`EMOJI` (profile).

## Gotchas

- **Never trust a sibling AGENTS.md blindly.** `../anthill/AGENTS.md` is stale:
  it claims "two source files total" and "no test suite", but the repo now has
  `src/args.c`, `src/scan.c`, `src/main.c` and a CTest suite in `tests/`
  (`add_test(NAME args|port_set|scan|cli|net ...)`). Verify against the actual
  source before acting on a documented claim.
- **The root `README.md` is not the org profile.** Only `profile/README.md`
  renders at <https://github.com/yvyty>; editing the root file changes the repo
  landing page, not the org page.
- **Do not add cross-repo references or shared code here.** The three products
  have deliberately no build coupling; coordinate by convention, not by
  importing across checkouts.