# t3code-bitbucket-dc-adapter

- [SPEC.md](SPEC.md) is the source of truth for routes, mappings and limits. Read it before changing `src/`; update it in the same change when behaviour changes.
- Contract tests import T3's real Bitbucket driver from a t3code clone (`T3CODE_SRC`, default `../t3code`). `ERR_MODULE_NOT_FOUND` from the clone means its dependencies aren't installed: run its package manager's install there.
- When T3 was started by `src/launch.ts`, your shell inherits its `GIT_CONFIG_*` env, which rewrites the Bitbucket HTTPS remotes to SSH. For the user's own view of git: `env -u GIT_CONFIG_COUNT -u GIT_CONFIG_KEY_0 -u GIT_CONFIG_VALUE_0 git ...`.
