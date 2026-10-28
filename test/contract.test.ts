import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { startFakeServer, TOKEN } from "./fakeServer.ts";
import * as F from "./fixtures.ts";

const T3 = process.env.T3CODE_SRC ?? join(import.meta.dirname, "..", "..", "t3code");
const BB = join(T3, "packages", "source-control-bitbucket");
const present = existsSync(join(BB, "src", "server", "BitbucketApi.ts"));

const REPO = "proj/web-app";
const UPSTREAM_REPO = "/rest/api/1.0/projects/proj/repos/web-app";
const PR_URL = (n: number) => `${F.PR_BASE}/${n}`;
const BODY_FILE = "C:/tmp/pr-body.md";
const iso = (ms: number) => new Date(ms).toISOString();
const CONTEXT = {
  provider: { kind: "bitbucket", name: "Bitbucket Self-Hosted", baseUrl: "https://bitbucket.example" },
  remoteName: "origin",
  remoteUrl: "ssh://git@bitbucket.example:7999/proj/web-app.git",
};

const load = (path: string) => import(pathToFileURL(path).href);

describe("contract: T3 Bitbucket Cloud driver -> adapter -> fake Server", { skip: present ? false : `no T3 source at ${T3}` }, () => {
  const fake = startFakeServer();
  const logs: string[] = [];
  let adapter: Server;
  let runtime: any;
  let Effect: any;
  let Option: any;
  let provider: any;
  let scp: any;
  let discovery: any;

  const run = (effect: unknown): Promise<any> => runtime.runPromise(effect);
  const fail = (effect: unknown): Promise<any> => runtime.runPromise(Effect.flip(effect));
  const upstream = (method: string, path: string) => fake.requests.filter((r) => r.method === method && r.path.toLowerCase() === path.toLowerCase());
  const writes = () => fake.requests.filter((r) => r.method !== "GET");

  before(async () => {
    const upstreamUrl = await fake.listen();
    const { createAdapter } = await import(new URL("../src/adapter.ts", import.meta.url).href);
    adapter = createAdapter({ upstream: upstreamUrl, log: (line: string) => logs.push(line) });
    await new Promise<void>((resolve) => adapter.listen(0, "127.0.0.1", resolve));
    process.env.T3CODE_BITBUCKET_API_BASE_URL = `http://127.0.0.1:${(adapter.address() as AddressInfo).port}/2.0`;

    const effect = realpathSync(join(BB, "node_modules", "effect"));
    Effect = await load(join(effect, "dist", "Effect.js"));
    Option = await load(join(effect, "dist", "Option.js"));
    const Layer = await load(join(effect, "dist", "Layer.js"));
    const FileSystem = await load(join(effect, "dist", "FileSystem.js"));
    const ManagedRuntime = await load(join(effect, "dist", "ManagedRuntime.js"));
    const { FetchHttpClient } = await load(join(effect, "dist", "http", "index.js"));
    const contracts = await load(join(T3, "packages", "contracts", "src", "index.ts"));
    const TestHost = await load(join(T3, "packages", "source-control-testing", "src", "TestSourceControlHost.ts"));
    const server = join(BB, "src", "server");
    const BitbucketApi = await load(join(server, "BitbucketApi.ts"));
    const BitbucketPullRequestApi = await load(join(server, "BitbucketPullRequestApi.ts"));
    const BitbucketPullRequestProvider = await load(join(server, "BitbucketPullRequestProvider.ts"));
    const BitbucketSourceControlProvider = await load(join(server, "BitbucketSourceControlProvider.ts"));

    const host = TestHost.layer({
      settings: { ...contracts.DEFAULT_SERVER_SETTINGS, sourceControlHosts: { bitbucket: { accessToken: TOKEN } } },
    });
    const files = FileSystem.layerNoop({
      readFileString: (path: string) => (path === BODY_FILE ? Effect.succeed("Body from file") : Effect.die(`unexpected read of ${path}`)),
    });
    const api = BitbucketApi.layer.pipe(Layer.provide(Layer.mergeAll(host, files, FetchHttpClient.layer)));
    runtime = ManagedRuntime.make(BitbucketPullRequestApi.layer.pipe(Layer.provideMerge(api)));
    provider = await run(BitbucketPullRequestProvider.make);
    scp = await run(BitbucketSourceControlProvider.make);
    discovery = await run(BitbucketSourceControlProvider.makeDiscovery);
  });

  after(async () => {
    await runtime?.dispose();
    adapter?.closeAllConnections();
    await new Promise((resolve) => (adapter ? adapter.close(resolve) : resolve(undefined)));
    await fake.close();
  });

  beforeEach(() => {
    fake.reset();
    logs.length = 0;
  });

  test("1. viewer and probeAuth come from x-ausername", async () => {
    assert.equal(await run(provider.getViewer({ cwd: "C:/repo" })), "jdoe");
    const auth = await run(discovery.probeAuth);
    assert.equal(auth.status, "authenticated");
    assert.equal(Option.getOrNull(auth.account), "jdoe");
    assert.ok(upstream("GET", "/rest/api/1.0/users/jdoe").length > 0, "viewer resolved via /users/{x-ausername}");
  });

  test("2. Authorization is forwarded verbatim to upstream", async () => {
    await run(provider.getViewer({ cwd: "C:/repo" }));
    await run(provider.getChangeRequest({ repository: REPO, number: 1338 }));
    assert.ok(fake.requests.length > 1);
    for (const r of fake.requests) assert.equal(r.headers.authorization, `Bearer ${TOKEN}`, `${r.method} ${r.url}`);
  });

  test("3. listChangeRequests: states, paging via next, query, cursor", async () => {
    const list = (input: Record<string, unknown>) =>
      run(provider.listChangeRequests({ cwd: "C:/repo", repository: REPO, involvement: "all", viewer: "jdoe", limit: 50, ...input }));

    const open = await list({ state: "open" });
    assert.deepEqual(open.items.map((i: any) => i.number), [1338, 1335, 1334]);
    assert.equal(open.truncated, false);
    const first = open.items[0];
    assert.equal(first.title, "Fix viewer zoom reset");
    assert.equal(first.headBranch, "bugfix/zoom-reset");
    assert.equal(first.baseBranch, F.DEVELOP);
    assert.equal(first.headSha, F.SHA_1338);
    assert.equal(first.headRepositoryNameWithOwner, REPO);
    assert.equal(first.state, "open");
    assert.equal(first.url, PR_URL(1338));
    assert.equal(first.updatedAt, iso(1792053717798));
    assert.equal(first.createdAt, iso(1791986141952));
    assert.equal(first.author?.login, "jdoe");
    assert.equal(first.author?.name, "John Doe");
    assert.deepEqual(first.reviewRequestLogins, ["asmith", "bwong"]);
    assert.equal(open.items[2].isDraft, true);
    assert.equal(first.isDraft, false);
    const openCalls = upstream("GET", `${UPSTREAM_REPO}/pull-requests`);
    assert.equal(openCalls.length, 2, "followed adapter next to the second upstream page");
    for (const c of openCalls) {
      assert.equal(c.query.get("state"), "OPEN");
    }
    assert.equal(openCalls[1]!.query.get("start"), "2");

    fake.reset();
    const all = await list({ state: "all" });
    assert.deepEqual(all.items.map((i: any) => [i.number, i.state]), [
      [1338, "open"],
      [1337, "merged"],
      [1336, "closed"],
      [1335, "open"],
      [1334, "open"],
    ]);
    assert.deepEqual(upstream("GET", `${UPSTREAM_REPO}/pull-requests`).map((c) => [c.query.get("state"), c.query.get("start") ?? "0"]), [
      ["ALL", "0"],
      ["ALL", "2"],
      ["ALL", "4"],
    ]);

    fake.reset();
    const closed = await list({ state: "closed" });
    assert.deepEqual(closed.items.map((i: any) => [i.number, i.state]), [[1336, "closed"]]);
    assert.equal(upstream("GET", `${UPSTREAM_REPO}/pull-requests`)[0]!.query.get("state"), "DECLINED");

    fake.reset();
    const merged = await list({ state: "merged" });
    assert.deepEqual(merged.items.map((i: any) => [i.number, i.state]), [[1337, "merged"]]);
    assert.equal(upstream("GET", `${UPSTREAM_REPO}/pull-requests`)[0]!.query.get("state"), "MERGED");

    fake.reset();
    const searched = await list({ state: "open", query: "viewer zoom" });
    assert.deepEqual(searched.items.map((i: any) => i.number), [1338]);
    const searchCall = upstream("GET", `${UPSTREAM_REPO}/pull-requests`)[0]!;
    assert.equal(searchCall.query.get("filterText"), "viewer zoom");
    assert.equal(searchCall.query.get("state"), "OPEN");

    fake.reset();
    const continued = await list({ state: "open", cursor: { updatedBefore: iso(1792030000000) } });
    assert.deepEqual(continued.items.map((i: any) => i.number), [1335, 1334]);
    for (const c of upstream("GET", `${UPSTREAM_REPO}/pull-requests`)) {
      assert.equal(c.query.get("state"), "OPEN");
    }
  });

  test("4. source control provider lists by head branch and reads one PR", async () => {
    const found = await run(
      scp.listChangeRequests({ cwd: "C:/repo", context: CONTEXT, headSelector: "bugfix/zoom-reset", state: "open" }),
    );
    assert.equal(found.length, 1);
    assert.equal(found[0].number, 1338);
    assert.equal(found[0].headRefName, "bugfix/zoom-reset");
    assert.equal(found[0].baseRefName, F.DEVELOP);
    assert.equal(found[0].state, "open");
    assert.equal(found[0].url, PR_URL(1338));
    assert.equal(found[0].headRepositoryNameWithOwner, REPO);
    assert.equal(found[0].headRepositoryOwnerLogin, "proj");
    assert.equal(found[0].isCrossRepository, undefined);
    const call = upstream("GET", `${UPSTREAM_REPO}/pull-requests`)[0]!;
    assert.equal(call.query.get("at"), "refs/heads/bugfix/zoom-reset");
    assert.equal(call.query.get("direction"), "OUTGOING");
    assert.equal(call.query.get("state"), "OPEN");

    fake.reset();
    const any = await run(
      scp.listChangeRequests({ cwd: "C:/repo", context: CONTEXT, headSelector: "feature/toolbar", state: "all" }),
    );
    assert.deepEqual(any.map((c: any) => [c.number, c.state]), [[1337, "merged"]]);
    const anyCall = upstream("GET", `${UPSTREAM_REPO}/pull-requests`)[0]!;
    assert.equal(anyCall.query.get("state"), "ALL");
    assert.equal(anyCall.query.get("at"), "refs/heads/feature/toolbar");

    const one = await run(scp.getChangeRequest({ cwd: "C:/repo", context: CONTEXT, reference: "#1337" }));
    assert.equal(one.number, 1337);
    assert.equal(one.title, "Add toolbar");
    assert.equal(one.state, "merged");
    assert.equal(one.headRefName, "feature/toolbar");
  });

  test("5. getChangeRequest detail: stats, mergeability, checks, reviewers, states", async () => {
    const detail = await run(provider.getChangeRequest({ cwd: "C:/repo", repository: REPO, number: 1338 }));
    assert.equal(detail.number, 1338);
    assert.equal(detail.title, "Fix viewer zoom reset");
    assert.equal(detail.body, "Zoom resets on window resize.");
    assert.equal(detail.url, PR_URL(1338));
    assert.equal(detail.state, "open");
    assert.equal(detail.headSha, F.SHA_1338);
    assert.deepEqual([detail.additions, detail.deletions, detail.changedFiles], [3, 1, 2]);
    assert.equal(detail.mergeability, "mergeable");
    assert.deepEqual(
      detail.reviewers.map((r: any) => [r.login, r.name]),
      [
        ["asmith", "Alice Smith"],
        ["bwong", "Bob Wong"],
      ],
    );
    assert.deepEqual(
      detail.checks.toSorted((a: any, b: any) => a.name.localeCompare(b.name)),
      [
        { name: "CI build", status: "success", description: "Build #42 passed", url: "https://ci.example/build/42" },
        { name: "E2E", status: "pending", description: "Running", url: "https://ci.example/e2e/3" },
        { name: "Lint", status: "cancelled", description: "Aborted", url: "https://ci.example/lint/7" },
      ],
    );
    assert.deepEqual(detail.viewerPermissions.actions, ["merge", "close"]);
    assert.ok(upstream("GET", `/rest/build-status/1.0/commits/${F.SHA_1338}`).length > 0);
    const diffCall = upstream("GET", `${UPSTREAM_REPO}/pull-requests/1338.diff`)[0];
    assert.ok(diffCall, "diffstat read from .diff");

    const conflicted = await run(provider.getChangeRequest({ cwd: "C:/repo", repository: REPO, number: 1335 }));
    assert.equal(conflicted.mergeability, "conflicting");
    assert.deepEqual(conflicted.checks, []);

    const merged = await run(provider.getChangeRequest({ cwd: "C:/repo", repository: REPO, number: 1337 }));
    assert.equal(merged.state, "merged");
    assert.deepEqual([merged.additions, merged.deletions, merged.changedFiles], [1, 1, 1]);
    const declined = await run(provider.getChangeRequest({ cwd: "C:/repo", repository: REPO, number: 1336 }));
    assert.equal(declined.state, "closed");
    assert.equal(declined.body, "");
  });

  test("6. getChangeRequestActivity: comments, verdicts, threads, commits", async () => {
    const activity = await run(provider.getChangeRequestActivity({ cwd: "C:/repo", repository: REPO, number: 1338 }));
    const comments = activity.comments.map((c: any) => ({
      id: c.id,
      kind: c.kind,
      login: c.author?.login,
      body: c.body,
      createdAt: c.createdAt,
      path: c.path,
      reviewState: c.reviewState,
    }));
    assert.deepEqual(comments, [
      { id: "3001", kind: "issue-comment", login: "asmith", body: "Looks good overall.", createdAt: iso(F.T.general), path: null, reviewState: null },
      { id: "3002", kind: "issue-comment", login: "jdoe", body: "Will merge after CI.", createdAt: iso(F.T.generalReply), path: null, reviewState: null },
      { id: "3003", kind: "review-comment", login: "asmith", body: "Nice fix here.", createdAt: iso(F.T.inlineTo), path: F.FILE, reviewState: null },
      { id: "3004", kind: "review-comment", login: "jdoe", body: "Thanks!", createdAt: iso(F.T.inlineToReply), path: F.FILE, reviewState: null },
      { id: "3005", kind: "review-comment", login: "bwong", body: "Why was this removed?", createdAt: iso(F.T.inlineFrom), path: F.FILE, reviewState: null },
      { id: "1338:bwong", kind: "review", login: "bwong", body: "", createdAt: iso(F.T.reviewed), path: null, reviewState: "changes_requested" },
      { id: "1338:asmith", kind: "review", login: "asmith", body: "", createdAt: iso(F.T.approved), path: null, reviewState: "approved" },
    ]);
    assert.equal(activity.comments[0].url, `${PR_URL(1338)}/overview?commentId=3001`);
    assert.equal(activity.commentCount, 7);
    assert.equal(activity.commentsTruncated, false);

    const threads = activity.reviewThreads
      .map((t: any) => ({
        id: t.id,
        path: t.path,
        line: t.line,
        side: t.side,
        isResolved: t.isResolved,
        isOutdated: t.isOutdated,
        comments: t.comments.map((c: any) => [c.id, c.author?.login, c.body]),
      }))
      .toSorted((a: any, b: any) => a.id.localeCompare(b.id));
    assert.deepEqual(threads, [
      {
        id: "3003",
        path: F.FILE,
        line: 260,
        side: "right",
        isResolved: true,
        isOutdated: false,
        comments: [
          ["3003", "asmith", "Nice fix here."],
          ["3004", "jdoe", "Thanks!"],
        ],
      },
      { id: "3005", path: F.FILE, line: 260, side: "left", isResolved: false, isOutdated: false, comments: [["3005", "bwong", "Why was this removed?"]] },
    ]);

    assert.deepEqual(
      activity.commits.map((c: any) => [c.oid, c.messageHeadline, c.committedDate, c.authors.map((a: any) => a.login)]),
      [
        [F.COMMITS.c1, "Reset zoom on resize", iso(1792030500000), ["jdoe"]],
        [F.COMMITS.c2, "Review fixes", iso(1792040500000), ["Ext Dev <ext@example.com>"]],
        [F.COMMITS.c3, "Handle resize", iso(1792050500000), ["jdoe"]],
      ],
    );
  });

  test("7. getDiff normalises prefixes; getFileRevisions reads index", async () => {
    const diff = await run(provider.getDiff({ cwd: "C:/repo", repository: REPO, number: 1338 }));
    assert.equal(diff.truncated, false);
    assert.equal(diff.nextCursor, null);
    assert.equal(
      diff.patch,
      F.diff1338.replaceAll("src://", "a/").replaceAll("dst://", "b/"),
    );
    assert.match(diff.patch, /^diff --git a\/projects\/a\/file\.ts b\/projects\/a\/file\.ts$/m);
    assert.doesNotMatch(diff.patch, /src:\/\/|dst:\/\//);

    const revisions = await run(provider.getFileRevisions({ cwd: "C:/repo", repository: REPO, number: 1338, paths: [F.FILE, "missing.ts"] }));
    assert.equal(revisions.complete, true);
    assert.equal(revisions.revisions.get(F.FILE), "743400ba0");
    assert.equal(revisions.revisions.get(F.NEW_FILE), "1a2b3c4d5");
    assert.equal(revisions.revisions.get("missing.ts"), "");
  });

  test("8. default branch from branch model; clone urls from repo", async () => {
    assert.equal(await run(scp.getDefaultBranch({ cwd: "C:/repo", context: CONTEXT })), F.DEVELOP);
    assert.ok(upstream("GET", "/rest/branch-utils/1.0/projects/proj/repos/web-app/branchmodel").length > 0);
    const urls = await run(scp.getRepositoryCloneUrls({ cwd: "C:/repo", repository: REPO }));
    assert.deepEqual(urls, {
      nameWithOwner: REPO,
      url: "https://bitbucket.example:8443/scm/proj/web-app.git",
      sshUrl: "ssh://git@bitbucket.example:7999/proj/web-app.git",
    });
  });

  test("9. runAction merge (per method) and close send version and strategy", async () => {
    for (const [method, strategyId] of [
      ["squash", "squash"],
      ["merge", "no-ff"],
      ["rebase", "rebase-ff-only"],
    ] as const) {
      fake.reset();
      await run(provider.runAction({ cwd: "C:/repo", repository: REPO, number: 1338, action: "merge", mergeMethod: method }));
      const posted = writes();
      assert.equal(posted.length, 1, method);
      assert.equal(posted[0]!.method, "POST");
      assert.equal(posted[0]!.path.toLowerCase(), `${UPSTREAM_REPO}/pull-requests/1338/merge`);
      assert.equal(posted[0]!.query.get("version"), "2");
      assert.equal(posted[0]!.body?.strategyId, strategyId);
      assert.equal(fake.pullRequest(1338)!.state, "MERGED");
    }

    fake.reset();
    await run(provider.runAction({ cwd: "C:/repo", repository: REPO, number: 1335, action: "close" }));
    assert.deepEqual(writes().map((w) => [w.method, w.path.toLowerCase(), w.query.get("version")]), [
      ["POST", `${UPSTREAM_REPO}/pull-requests/1335/decline`, "5"],
    ]);
    assert.equal(fake.pullRequest(1335)!.state, "DECLINED");

    fake.reset();
    const refused = await fail(provider.runAction({ cwd: "C:/repo", repository: REPO, number: 1335, action: "merge", mergeMethod: "merge" }));
    assert.equal(refused._tag, "PullRequestProviderError");
    assert.equal(refused.reason, "failed");
    assert.equal(refused.cause?.status, 409);
  });

  test("10. submitReview posts anchored comments, then the verdict", async () => {
    await run(
      provider.submitReview({
        cwd: "C:/repo",
        repository: REPO,
        number: 1338,
        verdict: "approve",
        body: "Summary",
        comments: [
          { path: F.FILE, position: { kind: "added", newLine: 261 }, body: "nit" },
          { path: F.FILE, position: { kind: "deleted", oldLine: 260 }, body: "why removed?" },
        ],
      }),
    );
    const approve = writes();
    assert.deepEqual(approve.map((w) => [w.method, w.path.toLowerCase().replace(UPSTREAM_REPO, "")]), [
      ["POST", "/pull-requests/1338/comments"],
      ["POST", "/pull-requests/1338/comments"],
      ["POST", "/pull-requests/1338/comments"],
      ["PUT", "/pull-requests/1338/participants/jdoe"],
    ]);
    const anchorOf = (body: any) => ({
      text: body.text,
      path: body.anchor?.path,
      line: body.anchor?.line,
      lineType: body.anchor?.lineType,
      fileType: body.anchor?.fileType,
      diffType: body.anchor?.diffType,
    });
    assert.deepEqual(anchorOf(approve[0]!.body), { text: "nit", path: F.FILE, line: 261, lineType: "ADDED", fileType: "TO", diffType: "EFFECTIVE" });
    assert.deepEqual(anchorOf(approve[1]!.body), { text: "why removed?", path: F.FILE, line: 260, lineType: "REMOVED", fileType: "FROM", diffType: "EFFECTIVE" });
    assert.deepEqual(approve[2]!.body, { text: "Summary" });
    assert.equal(approve[3]!.body?.status, "APPROVED");

    fake.reset();
    await run(
      provider.submitReview({
        cwd: "C:/repo",
        repository: REPO,
        number: 1338,
        verdict: "request-changes",
        body: "",
        comments: [
          { path: F.FILE, position: { kind: "context", oldLine: 259, newLine: 259, side: "right" }, body: "ctx right" },
          { path: F.FILE, position: { kind: "context", oldLine: 261, newLine: 262, side: "left" }, body: "ctx left" },
        ],
      }),
    );
    const changes = writes();
    assert.equal(changes.length, 3);
    assert.deepEqual(anchorOf(changes[0]!.body), { text: "ctx right", path: F.FILE, line: 259, lineType: "CONTEXT", fileType: "TO", diffType: "EFFECTIVE" });
    assert.deepEqual(anchorOf(changes[1]!.body), { text: "ctx left", path: F.FILE, line: 261, lineType: "CONTEXT", fileType: "FROM", diffType: "EFFECTIVE" });
    assert.equal(changes[2]!.method, "PUT");
    assert.equal(changes[2]!.path.toLowerCase(), `${UPSTREAM_REPO}/pull-requests/1338/participants/jdoe`);
    assert.equal(changes[2]!.body?.status, "NEEDS_WORK");

    fake.reset();
    const offDiff = await fail(
      provider.submitReview({
        cwd: "C:/repo",
        repository: REPO,
        number: 1338,
        verdict: "approve",
        body: "",
        comments: [{ path: F.FILE, position: { kind: "added", newLine: 999 }, body: "nowhere" }],
      }),
    );
    assert.equal(offDiff.cause?.status, 400);
    assert.deepEqual(writes(), [], "nothing written for a line outside the diff, and no approval");
  });

  test("11. comment and reply", async () => {
    await run(provider.comment({ cwd: "C:/repo", repository: REPO, number: 1338, body: "Hello" }));
    await run(provider.replyToThread({ cwd: "C:/repo", repository: REPO, number: 1338, threadId: "3003", body: "Agreed" }));
    assert.deepEqual(writes().map((w) => [w.method, w.path.toLowerCase(), w.body]), [
      ["POST", `${UPSTREAM_REPO}/pull-requests/1338/comments`, { text: "Hello" }],
      ["POST", `${UPSTREAM_REPO}/pull-requests/1338/comments`, { text: "Agreed", parent: { id: 3003 } }],
    ]);
  });

  test("12. updateChangeRequest sends version and keeps reviewers", async () => {
    await run(provider.updateChangeRequest({ cwd: "C:/repo", repository: REPO, number: 1338, title: "Fix zoom reset on resize" }));
    const put = writes();
    assert.equal(put.length, 1);
    assert.equal(put[0]!.method, "PUT");
    assert.equal(put[0]!.path.toLowerCase(), `${UPSTREAM_REPO}/pull-requests/1338`);
    assert.equal(put[0]!.body.version, 2);
    assert.equal(put[0]!.body.title, "Fix zoom reset on resize");
    assert.deepEqual(put[0]!.body.reviewers.map((r: any) => r.user.name), ["asmith", "bwong"]);
    const after = fake.pullRequest(1338)!;
    assert.equal(after.title, "Fix zoom reset on resize");
    assert.equal(after.description, "Zoom resets on window resize.");
    assert.deepEqual(after.reviewers.map((r) => [r.user.name, r.status]), [
      ["asmith", "APPROVED"],
      ["bwong", "NEEDS_WORK"],
    ]);

    fake.reset();
    await run(provider.updateChangeRequest({ cwd: "C:/repo", repository: REPO, number: 1338, body: "New description" }));
    assert.equal(writes()[0]!.body.description, "New description");
    assert.equal(fake.pullRequest(1338)!.title, "Fix viewer zoom reset");
  });

  test("13. createChangeRequest posts refs/heads refs", async () => {
    await run(
      scp.createChangeRequest({
        cwd: "C:/repo",
        context: CONTEXT,
        baseRefName: F.DEVELOP,
        headSelector: "feature/new-thing",
        title: "New thing",
        bodyFile: BODY_FILE,
      }),
    );
    const posted = writes();
    assert.equal(posted.length, 1);
    assert.equal(posted[0]!.path.toLowerCase(), `${UPSTREAM_REPO}/pull-requests`);
    const body = posted[0]!.body;
    assert.equal(body.title, "New thing");
    assert.equal(body.description, "Body from file");
    assert.equal(body.fromRef.id, "refs/heads/feature/new-thing");
    assert.equal(body.toRef.id, `refs/heads/${F.DEVELOP}`);
    for (const side of [body.fromRef, body.toRef]) {
      assert.equal(side.repository.slug, F.SLUG);
      assert.equal(String(side.repository.project?.key).toUpperCase(), F.PROJECT);
    }
  });

  test("14. unsupported routes surface as failures; upstream errors keep status", async () => {
    for (const [name, effect] of [
      ["listReviewerCandidates", () => provider.listReviewerCandidates({ cwd: "C:/repo", repository: REPO, number: 1338 })],
      ["setThreadResolution", () => provider.setThreadResolution({ cwd: "C:/repo", repository: REPO, number: 1338, threadId: "3003", resolved: true })],
      ["updateComment", () => provider.updateComment({ cwd: "C:/repo", repository: REPO, number: 1338, commentId: "3001", body: "x" })],
      ["setReviewerRequest", () => provider.setReviewerRequest({ cwd: "C:/repo", repository: REPO, number: 1338, reviewers: [{ id: "asmith" }], requested: true })],
    ] as const) {
      fake.reset();
      const error = await fail(effect());
      assert.equal(error._tag, "PullRequestProviderError", name);
      assert.equal(error.reason, "failed", name);
      assert.equal(error.cause?.status, 501, name);
      assert.deepEqual(writes(), [], `${name} wrote nothing upstream`);
    }
    assert.ok(logs.some((line) => line.includes("501")), "501 logged");

    const missing = await fail(provider.getChangeRequest({ cwd: "C:/repo", repository: REPO, number: 9999 }));
    assert.equal(missing.reason, "not-found");

    fake.fail(`${UPSTREAM_REPO}/pull-requests/1338/activities`, 503);
    const unavailable = await fail(provider.getChangeRequest({ cwd: "C:/repo", repository: REPO, number: 1338 }));
    assert.equal(unavailable.cause?.status, 503);
  });
});
