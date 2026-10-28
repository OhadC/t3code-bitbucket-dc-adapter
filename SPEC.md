# t3code-bitbucket-dc-adapter — spec

Make the **official** T3 Code desktop build work with self-hosted Bitbucket Server/Data Center
(built against 9.4) by putting a tiny local adapter in front of it that speaks the subset of
Bitbucket **Cloud** REST 2.0 that T3's Cloud driver uses.

Reference T3: [pingdotgg/t3code](https://github.com/pingdotgg/t3code) @ `339179f50a` (`packages/source-control-bitbucket`).

## Constraints

- Official T3 builds only. No fork, no patch.
- Work repos untouched (no tracked files, no `.git/config`). No global `~/.gitconfig` changes.
  Git outside T3 keeps https.
- Zero runtime dependencies. TypeScript run directly by Node 24 type stripping. No build step.
- Adapter runs as its own background process, not tied to T3's lifecycle.
- Windows, macOS and Linux. One config file (`config.json`), one entry point (the launcher).
- Adapter stores no secret.

## Pieces

1. **Adapter** — `node src/main.ts --upstream https://bitbucket.example.com [--port 8787]`.
   HTTP on `127.0.0.1` only. `/2.0/*` (Cloud shape) → Server REST (`/rest/api/1.0`,
   `/rest/build-status/1.0`, `/rest/branch-utils/1.0`).
2. **T3 env** — `T3CODE_BITBUCKET_API_BASE_URL=http://127.0.0.1:8787/2.0` (set by the launcher;
   read once at T3 server start). Token: Bitbucket Server HTTP access token (PAT) in T3 Settings → Source
   Control → Bitbucket → *Access token*; T3 sends it as `Authorization: Bearer`, adapter forwards it.
3. **Git identity rewrite (T3 only)** — env injected into T3's process only:
   ```
   GIT_CONFIG_COUNT=1
   GIT_CONFIG_KEY_0=url.ssh://git@bitbucket.example.com:7999/.insteadOf
   GIT_CONFIG_VALUE_0=https://bitbucket.example.com/scm/
   ```
   `git remote -v` then reports `ssh://git@…:7999/proj/repo.git` → T3 identity `proj/repo`
   (2 segments, which T3's Bitbucket driver requires). T3 appends its own `core.longpaths` as
   `KEY_1`. Delivery: see *Launcher*.
4. **SSH** — ed25519 key without passphrase (T3 fetches with `SSH_ASKPASS_REQUIRE=never`), pubkey in
   Bitbucket profile, `ssh -p 7999 git@bitbucket.example.com` once for `known_hosts`.

## Launcher

T3 has no setting that injects env into its server or its git calls (verified: no env files; the
Windows PowerShell-profile capture only takes `PATH`/`FNM_*`, the macOS/Linux login-shell capture
only a fixed allowlist (`PATH`, `SSH_AUTH_SOCK`, …); provider-instance `environment` only reaches
agents). Backend and git inherit the Electron process env (`extendEnv`, `process.env` read per git
call), and the shell capture only fills gaps, never drops inherited vars.

So: `node src/launch.ts` reads `config.json` (`upstream`, `ssh`, optional `app`, `port`), then:
1. If nothing answers on `127.0.0.1:<port>`, starts `src/main.ts` detached (log in the OS temp dir,
   `t3code-bitbucket-dc-adapter.log`). It outlives the launcher and T3.
2. Starts T3 detached with `T3CODE_BITBUCKET_API_BASE_URL` + the `GIT_CONFIG_*` trio
   (`<ssh>` insteadOf `<upstream>/scm/`). T3 executable: `app`, else
   `%LOCALAPPDATA%\Programs\t3code\T3 Code*.exe` (Windows) or
   `/Applications|~/Applications/T3 Code*.app/Contents/MacOS/*` (macOS). Linux (AppImage, any
   path) needs `app`.

`src/setup.ts` (via `setup-windows.cmd` / `setup-macos.command` / `setup-linux.sh`, which check
Node 24+) prompts for `config.json` if missing and creates the OS shortcut to the launcher: Start
menu `.lnk` (Windows), `osacompile` app in `~/Applications` (macOS), `.desktop` file (Linux).
Nothing user-wide.

Caveats (documented, not engineered around):
- Single-instance: if T3 already runs, the launcher only focuses it → quit T3 first.
- Auto-update relaunches T3 without the launcher → env likely lost → quit + relaunch via launcher
  after an update. Settings-driven `app.relaunch` keeps env.
- A running adapter is reused as-is; after changing `upstream`/`port`, stop it (the `node` process
  running `src/main.ts`) and relaunch.
- Only tested on Windows.
- The env also reaches T3's integrated terminals and agents (git there uses SSH too). Intended.
- Started any other way → PR features fail (identity `scm/proj/repo`), nothing breaks.

## Adapter behaviour

### General

- `{ws}` = Server project key (T3 sends it lowercase, Server accepts it), `{slug}` = repo slug.
  `{p}` = `/2.0/repositories/{ws}/{slug}` ↔ `/rest/api/1.0/projects/{ws}/repos/{slug}`.
- `Authorization` forwarded verbatim, only to the configured upstream. No other inbound headers.
- Upstream non-2xx → same status, body `{"type":"error","error":{"message":…}}` (Server's first
  error message), `Retry-After` kept. T3 only reads the status (401/404/429 matter).
- Unknown route/method → **501** + one log line. Unsupported shapes of known routes (e.g. PUT with
  `reviewers`) → 501 too. So T3 changes surface instead of silently misbehaving.
- Log: one line per request (`method path → status ms`) to stdout.
- **Paging**: Server `start/limit/isLastPage/nextPageStart` ↔ Cloud `values/pagelen/next`.
  `pagelen` → `limit`. When not last page, `next` = same adapter URL (origin taken from the
  request's `Host`, so it always matches T3's base URL origin) with `start=<nextPageStart>`.
  On the last page `next` is **absent** (not null — T3's branch lookup decodes it strictly).
- Identity strings: repository `full_name` = `<projectKey lowercased>/<slug>` (matches the SSH
  remote → T3 identity). User → `{uuid: name, nickname: name, display_name: displayName,
  account_id: name}`. Times: epoch ms → ISO.
- PR `links.html.href` = Server `links.self[0].href` (real Server URL; T3 opens it in the browser).
  Comment `links.html.href` = `<pr url>/overview?commentId=<id>`.

### Routes (v1)

| Cloud (T3 calls) | Server | Notes |
|---|---|---|
| `GET /user` | `x-ausername` from `GET /rest/api/1.0/profile/recent/repos?limit=1`, then `GET /rest/api/1.0/users/{name}` | `{username,nickname,display_name,account_id,uuid}` |
| `GET {p}` | repo + `GET …/default-branch` | `full_name`, `links.html`, `links.clone` (`http`→`https`, `ssh`), `mainbranch` (null if none) |
| `GET {p}/branching-model` | `GET /rest/branch-utils/1.0/projects/{ws}/repos/{slug}/branchmodel` | `development.branch.name` = dev `displayId` (`gitflow/1.2/develop`); none → `use_mainbranch:true` |
| `GET {p}/pullrequests` | `GET …/pull-requests?order=NEWEST` | see *PR list* |
| `POST {p}/pullrequests` | `POST …/pull-requests` | `fromRef/toRef` = `refs/heads/<name>` (+ source repo from `full_name` if given) → returns Cloud PR |
| `GET {p}/pullrequests/{n}` | `GET …/pull-requests/{n}` (+ `/activities` first page) | see *PR mapping* |
| `PUT {p}/pullrequests/{n}` | GET (version, reviewers) → `PUT` | `title`/`description` only; reviewers kept as-is; `reviewers` in body → 501 |
| `GET …/{n}/diff` | `GET …/pull-requests/{n}.diff` (`Accept: text/plain`) | `src://`→`a/`, `dst://`→`b/` in `diff --git`, `---`, `+++`, `rename from/to`; `text/plain` |
| `GET …/{n}/diffstat` | `.diff` parsed | one page, one value per file `{lines_added, lines_removed}` |
| `GET …/{n}/conflicts` | `GET …/pull-requests/{n}/merge` | `conflicted` → one value, else `values: []` |
| `GET …/{n}/commits` | `GET …/pull-requests/{n}/commits` | `{hash, message, date (committerTimestamp), author:{raw:"Name <email>", user}}` (`user` null when Server links no account), newest first (as both hosts) |
| `GET …/{n}/statuses` | PR `fromRef.latestCommit` → `GET /rest/build-status/1.0/commits/{sha}` | `{key,name,state,description,url}`; `CANCELLED`→`STOPPED`; sorted oldest `dateAdded` first (T3 keeps the later duplicate) |
| `GET …/{n}/comments` | `GET …/pull-requests/{n}/activities` | see *Comments* |
| `POST …/{n}/comments` | `POST …/pull-requests/{n}/comments` | see *Comments* |
| `POST …/{n}/approve` | `PUT …/participants/{mySlug}` `{status:APPROVED}` | `mySlug` from `/users/{x-ausername}` |
| `POST …/{n}/request-changes` | `PUT …/participants/{mySlug}` `{status:NEEDS_WORK}` | |
| `POST …/{n}/merge` `{merge_strategy}` | GET version → `POST …/merge?version=` `{strategyId}` | `merge_commit`→`no-ff`, `squash`→`squash`, `rebase_fast_forward`→`rebase-ff-only`; Server's refusal (vetoes, disabled strategy) passes through |
| `POST …/{n}/decline` | GET version → `POST …/decline?version=` | |
| `GET /user/workspaces/{ws}/permissions/repositories` | — | `{values: []}` (T3 reads empty as "may write"; Server refuses if not) |

Not supported (501): `POST {p}` (create repo — never), `GET /workspaces/{ws}/members`,
`PUT …/comments/{id}`, `POST|DELETE …/comments/{id}/resolve`, `GET {p}/diff/{sha}`.

### PR list

T3 sends `state=` (repeatable), `pagelen`, `sort=-updated_on`, `fields=` (ignored) and `q=` built
only from these ANDed clauses:

- `source.branch.name = "<b>"` → `at=refs/heads/<b>&direction=OUTGOING`
- `state = "X"` / `(state = "X" OR …)` → ignored (same info as `state=` params)
- `(title ~ "<t>" OR description ~ "<t>")` → `filterText=<t>`
- `updated_on <= <iso>` → filtered in the adapter per page (Server's `NEWEST` is `updatedDate`
  desc, verified); `next` kept

Any other clause → 501. States: `{OPEN}`→`OPEN`, `{MERGED}`→`MERGED`, `{DECLINED[,SUPERSEDED]}`→
`DECLINED`, more than one of OPEN/MERGED/DECLINED → `ALL` + local filter.

### PR mapping (Server → Cloud)

`id`, `title`, `description`, `state` (`OPEN|MERGED|DECLINED` same words), `draft`,
`created_on`/`updated_on`, `author` (user), `source`/`destination` =
`{branch:{name: displayId}, commit:{hash: latestCommit}, repository:{full_name, workspace:{slug}}}`,
`reviewers` (users), `participants` = reviewers + participants with
`role`, `approved`, `state` (`APPROVED`→`approved`, `NEEDS_WORK`→`changes_requested`, else null),
and on the single-PR GET `participated_on` = time of that user's newest `APPROVED`/`REVIEWED`
activity on the first activities page (else PR `updatedDate`). T3 only shows a verdict in the
timeline when `participated_on` is set. `links.html.href` as above.

### Comments

Read: activities with `action=COMMENTED, commentAction=ADDED` carry a root comment with nested
replies. Flatten to Cloud's flat list: `{id, content:{raw:text}, user, created_on,
parent:{id}|null, inline, resolution, links.html}`; `inline` = `{path, from|to, outdated:
anchor.orphaned}` (`fileType TO` → `to=line`, `FROM` → `from=line`; no fileType → `REMOVED` means
`from`); `resolution` = `{}` when `threadResolved` or `state=RESOLVED`, else null. Inline anchor
taken from the root (replies inherit). Paging over activities as usual.

Write: `{content:{raw}, parent?:{id}, inline?:{path, to|from}}` → `{text, parent?, anchor?}`.
Server needs `lineType`, which Cloud doesn't send: fetch the PR `.diff`, find the line in that file
(`to` → new-side line: `+` ADDED or ` ` CONTEXT, fileType TO; `from` → old-side: `-` REMOVED or
` ` CONTEXT, fileType FROM), `srcPath` for renames, `diffType: EFFECTIVE`. Line not in diff → 400.

## Tests (`node --test`)

- **Contract (primary)**: run T3's real `BitbucketApi` + `BitbucketPullRequestApi` +
  `BitbucketPullRequestProvider` (imported from the t3code clone, `T3CODE_SRC` env, default
  `../t3code`; skipped if absent) against the adapter, with a fake Server (local
  HTTP, JSON fixtures shaped like real 9.4 responses). Assert what T3 ends up with (PR fields,
  states, comments/threads, checks, diffstat, mergeability, default branch, viewer) and what the
  fake Server received (paths, `version`, anchors, strategyId). This catches shape drift, the
  `next` origin rule, and repo-segment rules.
- **Unit**: diff normalisation, diff parse (stats + anchors), `q` parsing. Paging `next` is covered by the contract tests.
- Tests must fail on a real mapping bug (e.g. wrong `full_name`, dropped `version`).

## Known limitations

- `mergedAt`/`closedAt` null (T3 Cloud driver doesn't read them).
- No delete-branch after merge; no reopen; no reviewers/members, comment edit/resolve, per-commit
  diff (v2).
- Server PR URLs pasted in chat don't parse as Bitbucket PR links → link by repo + number.
- PR watch is T3's 2-minute polling.
- `version` races: adapter reads version immediately before writing; a concurrent edit → Server
  409 surfaces as a failed action.
- Inline comments only on lines present in Server's diff.
- If T3 is started without the launcher env, git identity is `scm/proj/repo` → PR features break
  (no data damage).

## Later (v2)

Reviewers/members (`uuid` = username; `/rest/api/1.0/users?permission.1=REPO_READ…`), comment
edit (`version`) / resolve (`threadResolved`), `diff/{sha}` (`/commits/{sha}/diff`).
