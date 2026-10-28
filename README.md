# t3code-bitbucket-dc-adapter

Use [T3 Code](https://github.com/pingdotgg/t3code) with a self-hosted Bitbucket Data Center
(or Server), without changing T3.

T3 only speaks Bitbucket **Cloud**. This repo has a small local server (the **adapter**) that
translates between T3 and Bitbucket Data Center, plus a launcher that points T3 at it.

```
T3 Code  --->  adapter (127.0.0.1:8787)  --->  your Bitbucket Data Center
```

Windows only for now (the launcher and setup steps). Needs Node 24+. No dependencies, no build.

Design details: [SPEC.md](SPEC.md).

## How it fits together

Two things must be true whenever you use T3 with Bitbucket:

1. **The adapter is running.** It starts at Windows logon, so you set this up once.
2. **T3 was started with `launch-t3.cmd`.** The launcher tells T3 where the adapter is. It does
   not start the adapter.

Git inside T3 also needs an SSH key (step 5).

Nothing else on your machine changes. Git outside T3, your repos and `~/.gitconfig` are untouched.

## Setup (once)

The examples use `https://bitbucket.example.com` (HTTPS clone URLs `https://bitbucket.example.com/scm/...`)
and SSH on port `7999` (Bitbucket's default). Replace them with your server's values. Your
server's clone dialog shows both URLs.

### 1. Point the launcher at your server

Edit the first two lines of `launch-t3.cmd`:

```bat
set BITBUCKET_HTTPS=https://bitbucket.example.com/scm/
set BITBUCKET_SSH=ssh://git@bitbucket.example.com:7999/
```

### 2. Start the adapter at logon

In PowerShell, from this repo's folder:

```powershell
$upstream = "https://bitbucket.example.com"
$a = New-ScheduledTaskAction -Execute conhost.exe -Argument "--headless `"$((Get-Command node).Source)`" `"$((Resolve-Path src\main.ts).Path)`" --upstream $upstream"
Register-ScheduledTask -TaskName t3code-bitbucket-dc-adapter -Action $a -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0)
Start-ScheduledTask t3code-bitbucket-dc-adapter
```

Check it: `curl http://127.0.0.1:8787/2.0/user` should return `401` (no token sent, so that's
expected).

To watch its log instead, run it in a terminal: `node src\main.ts --upstream https://bitbucket.example.com`.
Each request prints one line with its status, its duration and Bitbucket's error message, if any.

### 3. Start T3 through the launcher

Quit T3, then run `launch-t3.cmd`. Pin a shortcut to it and use it instead of the normal one.

- If T3 is already open, the launcher just brings it to the front without applying anything.
  Quit T3 first.
- After T3 auto-updates and restarts itself, quit it and start it with the launcher again.

### 4. Add your token in T3

T3 → Settings → Source Control → Bitbucket:

- **Access token**: a Bitbucket HTTP access token (Bitbucket → your avatar → Manage account →
  HTTP access tokens, with *Repository write* permission).
- Leave **Atlassian account email** and **API token** empty; those are for Bitbucket Cloud.
- Turn on the Bitbucket toggle.

### 5. SSH key (needed if your clones use HTTPS)

T3 needs the repo name as `project/repo`. An HTTPS remote (`.../scm/proj/repo.git`) doesn't
give that, so inside T3 the launcher rewrites HTTPS remotes to SSH
(`ssh://git@bitbucket.example.com:7999/proj/repo.git`). Git in T3, including T3's terminals,
therefore fetches and pushes over SSH, even though your clones are HTTPS. Without a key, every
fetch, pull and push in T3 fails. Git outside T3 keeps using HTTPS.

1. `ssh-keygen -t ed25519` and press Enter at every prompt (no passphrase).
2. Bitbucket → avatar → Manage account → SSH keys → Add key, and paste the whole line from
   `~/.ssh/id_ed25519.pub`.
3. Run `ssh -p 7999 git@bitbucket.example.com` and answer `yes` to the host-key prompt.

What step 3 prints:

| Output | Meaning |
| --- | --- |
| `shell request failed on channel 0` | Works. Bitbucket accepted the key and just doesn't allow shells. |
| `Permission denied (publickey)` | The key isn't in Bitbucket yet (step 2). |
| `Host key verification failed` | You haven't accepted the host key yet. Run step 3 in a terminal and answer `yes`. |

Inside T3, `git remote -v` shows the SSH URL. That's the rewrite at work, not a change to the
repo's config.

## Troubleshooting

| You see | Meaning |
| --- | --- |
| Projects marked *Unavailable* | Adapter isn't running, or no token is set. |
| *Bitbucket returned HTTP 409* on merge | Bitbucket refused the merge, e.g. failed builds or missing approvals. T3 doesn't show the reason; the adapter log does. |
| *HTTP 501* | T3 used a feature the adapter doesn't support yet (reviewers, editing or resolving comments). |
| *HTTP 502* | The adapter can't reach Bitbucket (VPN?). |
| Fetch, pull or push in T3 fails with `Permission denied (publickey)` or `Host key verification failed` | SSH key isn't set up. See step 5. |

## Tests

`npm test`. Unit tests always run. The contract tests run T3's real Bitbucket code from a t3code
clone (`T3CODE_SRC`, default `../t3code` next to this repo) and are skipped if it's missing.

## License

[MIT](LICENSE)
