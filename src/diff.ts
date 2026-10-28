export type LineType = "ADDED" | "REMOVED" | "CONTEXT";

export interface DiffLine {
  readonly type: LineType;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  added: number;
  removed: number;
  readonly lines: DiffLine[];
}

export interface Anchor {
  readonly path: string;
  readonly srcPath?: string;
  readonly line: number;
  readonly lineType: LineType;
  readonly fileType: "FROM" | "TO";
  readonly diffType: "EFFECTIVE";
}

export function normalizeDiff(patch: string): string {
  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("diff --git ")) {
        return line.replace(" src://", " a/").replace(" dst://", " b/");
      }
      if (line.startsWith("--- src://")) return `--- a/${line.slice(10)}`;
      if (line.startsWith("+++ dst://")) return `+++ b/${line.slice(10)}`;
      if (line.startsWith("rename from src://")) return `rename from ${line.slice(18)}`;
      if (line.startsWith("rename to dst://")) return `rename to ${line.slice(16)}`;
      return line;
    })
    .join("\n");
}

function sidePath(value: string, prefix: string): string | null {
  const path = value.replace(/\t.*$/, "");
  if (path === "/dev/null") return null;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function headerPaths(rest: string): [string | null, string | null] {
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half)) {
    const left = rest.slice(0, half);
    const right = rest.slice(half + 1);
    if (left.startsWith("a/") && right.startsWith("b/") && left.slice(2) === right.slice(2)) {
      return [left.slice(2), right.slice(2)];
    }
  }
  const split = rest.indexOf(" b/");
  if (rest.startsWith("a/") && split > 0) return [rest.slice(2, split), rest.slice(split + 3)];
  return [null, null];
}

export function parseDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldAt = 0;
  let newAt = 0;

  for (const raw of normalizeDiff(patch).split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (file !== null && (oldLeft > 0 || newLeft > 0)) {
      const mark = line[0];
      if (mark === "+") {
        file.lines.push({ type: "ADDED", oldLine: null, newLine: newAt++ });
        file.added += 1;
        newLeft -= 1;
        continue;
      }
      if (mark === "-") {
        file.lines.push({ type: "REMOVED", oldLine: oldAt++, newLine: null });
        file.removed += 1;
        oldLeft -= 1;
        continue;
      }
      if (mark === " " || line === "") {
        file.lines.push({ type: "CONTEXT", oldLine: oldAt++, newLine: newAt++ });
        oldLeft -= 1;
        newLeft -= 1;
        continue;
      }
      if (mark === "\\") continue;
      oldLeft = 0;
      newLeft = 0;
    }
    if (line.startsWith("diff --git ")) {
      const [oldPath, newPath] = headerPaths(line.slice(11));
      file = { oldPath, newPath, added: 0, removed: 0, lines: [] };
      files.push(file);
      continue;
    }
    if (file === null) continue;
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldAt = Number(hunk[1]);
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newAt = Number(hunk[3]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
    } else if (line.startsWith("--- ")) {
      file.oldPath = sidePath(line.slice(4), "a/");
    } else if (line.startsWith("+++ ")) {
      file.newPath = sidePath(line.slice(4), "b/");
    } else if (line.startsWith("rename from ")) {
      file.oldPath = line.slice(12);
    } else if (line.startsWith("rename to ")) {
      file.newPath = line.slice(10);
    } else if (line.startsWith("new file mode")) {
      file.oldPath = null;
    } else if (line.startsWith("deleted file mode")) {
      file.newPath = null;
    }
  }
  return files;
}

export function findAnchor(
  files: readonly DiffFile[],
  path: string,
  side: "from" | "to",
  line: number,
): Anchor | null {
  const file = files.find((f) => f.newPath === path) ?? files.find((f) => f.oldPath === path);
  if (file === undefined) return null;
  const hit = file.lines.find((l) => (side === "to" ? l.newLine : l.oldLine) === line);
  if (hit === undefined) return null;
  const newPath = file.newPath ?? file.oldPath ?? path;
  return {
    path: newPath,
    ...(file.oldPath !== null && file.oldPath !== newPath ? { srcPath: file.oldPath } : {}),
    line,
    lineType: hit.type,
    fileType: side === "to" ? "TO" : "FROM",
    diffType: "EFFECTIVE",
  };
}
