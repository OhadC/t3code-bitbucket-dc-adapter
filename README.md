# t3code-bitbucket-dc-adapter

Use [T3 Code](https://github.com/pingdotgg/t3code) with a self-hosted Bitbucket Data Center
(or Server), without changing T3.

T3 only speaks Bitbucket **Cloud**. This repo has a small local server (the **adapter**) that
translates between T3 and Bitbucket Data Center, plus a launcher that starts T3 pointed at it.

```
T3 Code  --->  adapter (127.0.0.1:8787)  --->  your Bitbucket Data Center
```

Needs [Node.js](https://nodejs.org) 24+. No dependencies, no build. Windows, macOS and Linux
(only Windows is tested so far).

Design details: [SPEC.md](SPEC.md).

## How it fits together

Always start T3 with the **T3 Code (Bitbucket)** shortcut that setup creates. It starts the adapter
in the background if it isn't running yet, then starts T3 with the settings that point it at the
adapter.

Nothing else on your machine changes. Git outside T3, your repos and `~/.gitconfig` are untouched.

## Setup (once)

### 1. Run setup

Clone this repo, then run the setup file for your OS:

| OS | Run |
| --- | --- |
| Windows | Double-click `setup-windows.cmd` |
| macOS | Double-click `setup-macos.command` (or `sh setup-macos.command` in Terminal) |
| Linux | `sh setup-linux.sh` |

It asks for two things (your server's clone dialog shows both URLs):

- **Bitbucket URL**: the part before `/scm/` in HTTPS clone URLs, e.g. `https://bitbucket.example.com`.
- **SSH clone URL prefix**: the part before `<project>/<repo>.git` in SSH clone URLs. Press Enter to
  accept the suggested `ssh://git@<host>:7999/`.
- On Linux, also the path to the T3 Code AppImage. On Windows and macOS T3 is found automatically.

It saves your answers to `config.json` and creates a **T3 Code (Bitbucket)** shortcut: in the
Start menu (Windows), `~/Applications` (macOS) or your app menu (Linux).

### 2. Start T3 through the shortcut

Quit T3 completely (tray icon → Quit), then start **T3 Code (Bitbucket)**. Pin it to the taskbar
or Dock and use it instead of the normal T3 shortcut.

- If T3 is already open, the shortcut just brings it to the front without applying anything.
  Quit T3 first.
- After T3 auto-updates and restarts itself, quit it and start it with the shortcut again.

Check the adapter: `curl http://127.0.0.1:8787/2.0/user` should return `401` (no token sent, so
that's expected).

### 3. Add your token in T3

T3 → Settings → Source Control → Bitbucket:

- **Access token**: a Bitbucket HTTP access token (Bitbucket → your avatar → Manage account →
  HTTP access tokens, with *Repository write* permission).
- Leave **Atlassian account email** and **API token** empty; those are for Bitbucket Cloud.
- Turn on the Bitbucket toggle.

### 4. SSH key (needed if your clones use HTTPS)

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

## Config

`config.json` (written by setup, see `config.example.json`):

| Key | Meaning |
| --- | --- |
| `upstream` | Bitbucket URL. |
| `ssh` | SSH clone URL prefix. |
| `app` | Optional. Path to the T3 Code executable (on Linux: the AppImage). Found automatically on Windows and macOS. |
| `port` | Optional. Adapter port, default `8787`. |

Edit it directly, or delete it and run setup again. The adapter keeps running in the background
until you log out, so after changing `upstream` or `port`, stop it (end the `node` process running
`src/main.ts`) and start T3 with the shortcut again.

The adapter logs one line per request (status, duration, Bitbucket's error message) to
`t3code-bitbucket-dc-adapter.log` in your temp folder.

## Troubleshooting

| You see | Meaning |
| --- | --- |
| Shortcut does nothing | Run `node src/launch.ts` in this repo's folder to see the error (missing `config.json`, T3 not found). |
| Projects marked *Unavailable* | Adapter isn't running, or no token is set. |
| *Bitbucket returned HTTP 409* on merge | Bitbucket refused the merge, e.g. failed builds or missing approvals. T3 doesn't show the reason; the adapter log does. |
| *HTTP 501* | T3 used a feature the adapter doesn't support yet (reviewers, editing or resolving comments). |
| *HTTP 502* | The adapter can't reach Bitbucket (VPN?). |
| Fetch, pull or push in T3 fails with `Permission denied (publickey)` or `Host key verification failed` | SSH key isn't set up. See step 4. |
| Shortcut stopped working after switching Node versions | The shortcut stores Node's path. Run setup again. |

## Tests

`npm test`. Unit tests always run. The contract tests run T3's real Bitbucket code from a t3code
clone (`T3CODE_SRC`, default `../t3code` next to this repo) and are skipped if it's missing.

## License

[MIT](LICENSE)
