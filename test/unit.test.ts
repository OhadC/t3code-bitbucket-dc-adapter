import assert from "node:assert/strict";
import { test } from "node:test";
import { findAnchor, normalizeDiff, parseDiff } from "../src/diff.ts";
import { parseListQuery } from "../src/map.ts";

const PATCH = [
  "diff --git src://a/file.ts dst://a/file.ts",
  "index 1234567aa..89abcdeff 100644",
  "--- src://a/file.ts",
  "+++ dst://a/file.ts",
  "@@ -10,4 +10,4 @@ fn",
  " keep src://x",
  "--- looks like a header",
  "+++ also looks like one",
  " ctx",
  "-old",
  "+new",
  "diff --git src://old name.ts dst://new name.ts",
  "similarity index 90%",
  "rename from src://old name.ts",
  "rename to dst://new name.ts",
  "index 1111111..2222222 100644",
  "--- src://old name.ts",
  "+++ dst://new name.ts",
  "@@ -1 +1 @@",
  "-a",
  "+b",
  "",
].join("\n");

test("normalizeDiff rewrites headers only", () => {
  const out = normalizeDiff(PATCH);
  assert.match(out, /^diff --git a\/a\/file\.ts b\/a\/file\.ts$/m);
  assert.match(out, /^--- a\/a\/file\.ts$/m);
  assert.match(out, /^\+\+\+ b\/a\/file\.ts$/m);
  assert.match(out, /^rename from old name\.ts$/m);
  assert.match(out, /^ keep src:\/\/x$/m);
  assert.doesNotMatch(out, /dst:\/\//);
});

test("parseDiff counts hunk lines, not header look-alikes", () => {
  const [file, renamed] = parseDiff(PATCH);
  assert.deepEqual([file!.oldPath, file!.newPath, file!.added, file!.removed], ["a/file.ts", "a/file.ts", 2, 2]);
  assert.deepEqual([renamed!.oldPath, renamed!.newPath, renamed!.added, renamed!.removed], ["old name.ts", "new name.ts", 1, 1]);
});

test("findAnchor derives lineType and fileType from the diff", () => {
  const files = parseDiff(PATCH);
  assert.deepEqual(findAnchor(files, "a/file.ts", "to", 11), {
    path: "a/file.ts",
    line: 11,
    lineType: "ADDED",
    fileType: "TO",
    diffType: "EFFECTIVE",
  });
  assert.equal(findAnchor(files, "a/file.ts", "to", 10)?.lineType, "CONTEXT");
  assert.equal(findAnchor(files, "a/file.ts", "from", 11)?.lineType, "REMOVED");
  assert.equal(findAnchor(files, "a/file.ts", "from", 13)?.lineType, "REMOVED");
  assert.equal(findAnchor(files, "a/file.ts", "to", 13)?.lineType, "ADDED");
  assert.equal(findAnchor(files, "a/file.ts", "from", 12)?.fileType, "FROM");
  assert.equal(findAnchor(files, "a/file.ts", "to", 99), null);
  assert.equal(findAnchor(files, "nope.ts", "to", 10), null);
  assert.deepEqual(findAnchor(files, "new name.ts", "from", 1), {
    path: "new name.ts",
    srcPath: "old name.ts",
    line: 1,
    lineType: "REMOVED",
    fileType: "FROM",
    diffType: "EFFECTIVE",
  });
});

test("parseListQuery understands exactly what T3 sends", () => {
  assert.deepEqual(parseListQuery(null), {});
  assert.deepEqual(parseListQuery('source.branch.name = "feat/a\\"b" AND state = "OPEN"'), { branch: 'feat/a"b' });
  assert.deepEqual(
    parseListQuery('(title ~ "fix AND x" OR description ~ "fix AND x") AND updated_on <= 2026-10-15T06:50:00.000Z'),
    { search: "fix AND x", updatedBefore: Date.parse("2026-10-15T06:50:00.000Z") },
  );
  assert.deepEqual(parseListQuery('source.branch.name = "b" AND (state = "DECLINED" OR state = "SUPERSEDED")'), { branch: "b" });
  assert.equal(parseListQuery('author.nickname = "x"'), null);
  assert.equal(parseListQuery('(title ~ "a" OR description ~ "b")'), null);
  assert.equal(parseListQuery('state = "OPEN" OR state = "MERGED"'), null);
});
