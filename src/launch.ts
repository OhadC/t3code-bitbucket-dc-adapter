import { spawn } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG, findApp } from "./config.ts";

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const port = String(config.port ?? 8787);
const upstream = config.upstream.replace(/\/+$/, "");
const ssh = config.ssh.replace(/\/*$/, "/");
const app = config.app ?? findApp();
if (!app) throw new Error('T3 Code not found. Set "app" in config.json to its executable (on Linux: the AppImage).');

const adapterRunning = await fetch(`http://127.0.0.1:${port}/2.0/user`, { signal: AbortSignal.timeout(2000) }).then(
  () => true,
  () => false,
);
if (!adapterRunning) {
  const log = openSync(join(tmpdir(), "t3code-bitbucket-dc-adapter.log"), "a");
  spawn(process.execPath, [join(import.meta.dirname, "main.ts"), "--upstream", upstream, "--port", port], {
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
  }).unref();
}

spawn(app, [], {
  detached: true,
  stdio: "ignore",
  env: {
    ...process.env,
    T3CODE_BITBUCKET_API_BASE_URL: `http://127.0.0.1:${port}/2.0`,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${ssh}.insteadOf`,
    GIT_CONFIG_VALUE_0: `${upstream}/scm/`,
  },
}).unref();
