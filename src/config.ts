import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..");
export const CONFIG = join(ROOT, "config.json");
export const LAUNCH = join(import.meta.dirname, "launch.ts");

export function findApp(): string | undefined {
  const find = (dir: string, pattern: RegExp) => (existsSync(dir) ? readdirSync(dir).find((name) => pattern.test(name)) : undefined);
  if (process.platform === "win32") {
    const dir = join(process.env.LOCALAPPDATA ?? "", "Programs", "t3code");
    const exe = find(dir, /^T3 Code.*\.exe$/);
    if (exe) return join(dir, exe);
  }
  if (process.platform === "darwin") {
    for (const dir of ["/Applications", join(homedir(), "Applications")]) {
      const app = find(dir, /^T3 Code.*\.app$/);
      if (!app) continue;
      const macos = join(dir, app, "Contents", "MacOS");
      return join(macos, readdirSync(macos)[0]!);
    }
  }
  return undefined;
}
