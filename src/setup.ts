import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { CONFIG, findApp, LAUNCH, ROOT } from "./config.ts";

const NAME = "T3 Code (Bitbucket)";

if (existsSync(CONFIG)) {
  console.log(`Using existing ${CONFIG} (delete it and run setup again to change it).`);
} else {
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question: string, valid: (answer: string) => boolean, fallback = "") => {
    for (;;) {
      process.stdout.write(question);
      const line = await lines.next();
      if (line.done) throw new Error("Setup cancelled.");
      const answer = line.value.trim() || fallback;
      if (valid(answer)) return answer;
    }
  };

  const upstream = (
    await ask("Bitbucket URL, the part before /scm/ in HTTPS clone URLs (e.g. https://bitbucket.example.com): ", (a) =>
      URL.canParse(a),
    )
  ).replace(/\/+$/, "");
  const defaultSsh = `ssh://git@${new URL(upstream).hostname}:7999/`;
  const ssh = await ask(`SSH clone URL prefix [${defaultSsh}]: `, (a) => a.startsWith("ssh://"), defaultSsh);
  const app = findApp()
    ? undefined
    : await ask(
        process.platform === "linux" ? "Path to the T3 Code AppImage: " : "T3 Code not found. Path to its executable: ",
        existsSync,
      );
  rl.close();

  writeFileSync(CONFIG, `${JSON.stringify({ upstream, ssh, ...(app ? { app } : {}) }, null, 2)}\n`);
  console.log(`Wrote ${CONFIG}`);
}

const app = JSON.parse(readFileSync(CONFIG, "utf8")).app ?? findApp();
const where = createShortcut(app);

console.log(`
Done. Next:
1. Quit T3 completely (tray icon -> Quit).
2. Start "${NAME}" from ${where}. Always start T3 this way from now on.
3. T3 -> Settings -> Source Control -> Bitbucket: paste a Bitbucket HTTP access token.
4. If your clones use HTTPS, set up an SSH key (README, step "SSH key").`);

function createShortcut(app: string | undefined): string {
  if (process.platform === "win32") {
    const script = [
      "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK)",
      "$s.TargetPath = $env:NODE",
      "$s.Arguments = '\"' + $env:LAUNCH + '\"'",
      "$s.WorkingDirectory = $env:ROOT",
      "$s.WindowStyle = 7",
      "if ($env:ICON) { $s.IconLocation = $env:ICON }",
      "$s.Save()",
    ].join("; ");
    run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      LNK: join(process.env.APPDATA!, "Microsoft", "Windows", "Start Menu", "Programs", `${NAME}.lnk`),
      NODE: process.execPath,
      LAUNCH,
      ROOT,
      ICON: app ?? "",
    });
    return "the Start menu (pin it to the taskbar from there)";
  }
  if (process.platform === "darwin") {
    const dir = join(homedir(), "Applications");
    mkdirSync(dir, { recursive: true });
    run("osacompile", ["-o", join(dir, `${NAME}.app`), "-e", `do shell script "'${process.execPath}' '${LAUNCH}'"`]);
    return "~/Applications (drag it to the Dock)";
  }
  const dir = join(homedir(), ".local", "share", "applications");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "t3code-bitbucket.desktop"),
    ["[Desktop Entry]", "Type=Application", `Name=${NAME}`, `Exec="${process.execPath}" "${LAUNCH}"`, "Terminal=false", ""].join("\n"),
  );
  return "your app menu";
}

function run(command: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? result.error?.message}).`);
}
