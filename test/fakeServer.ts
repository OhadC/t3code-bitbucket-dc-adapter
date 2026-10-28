import http from "node:http";
import type { AddressInfo } from "node:net";
import * as F from "./fixtures.ts";

export const TOKEN = "test-token";
const LIST_PAGE_CAP = 2;

export interface Recorded {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  body: any;
}

type Reply = { status: number; body?: unknown; text?: string; headers?: Record<string, string> };

const error = (status: number, message: string, extra: Record<string, unknown> = {}): Reply => ({
  status,
  body: { errors: [{ context: null, message, exceptionName: null, ...extra }] },
});

function paged(values: unknown[], query: URLSearchParams, cap = 1000) {
  const start = Number(query.get("start") ?? 0);
  const limit = Math.min(Number(query.get("limit") ?? 25), cap);
  const slice = values.slice(start, start + limit);
  const isLastPage = start + slice.length >= values.length;
  return {
    size: slice.length,
    limit,
    isLastPage,
    start,
    ...(isLastPage ? {} : { nextPageStart: start + slice.length }),
    values: slice,
  };
}

export function startFakeServer() {
  const requests: Recorded[] = [];
  let prs = F.pullRequests();
  let nextCommentId = 5000;

  const failures = new Map<string, number>();
  const reset = () => {
    requests.length = 0;
    failures.clear();
    prs = F.pullRequests();
    nextCommentId = 5000;
  };

  const route = (method: string, path: string, query: URLSearchParams, headers: http.IncomingHttpHeaders, body: any): Reply => {
    const user = /^\/rest\/api\/1\.0\/users\/([^/]+)$/.exec(path);
    if (user && method === "GET") {
      const found = (F.users as Record<string, F.User>)[decodeURIComponent(user[1]!)];
      return found ? { status: 200, body: found } : error(404, "User does not exist");
    }

    if (path === "/rest/api/1.0/profile/recent/repos" && method === "GET") return { status: 200, body: paged([F.repository], query) };

    const build = /^\/rest\/build-status\/1\.0\/commits\/([0-9a-f]+)$/.exec(path);
    if (build && method === "GET") return { status: 200, body: paged(F.statuses[build[1]!] ?? [], query) };

    const model = /^\/rest\/branch-utils\/1\.0\/projects\/([^/]+)\/repos\/([^/]+)\/branchmodel$/.exec(path);
    if (model && method === "GET") {
      if (!isRepo(model[1]!, model[2]!)) return error(404, "Repository does not exist");
      return { status: 200, body: F.branchModel };
    }

    const repo = /^\/rest\/api\/1\.0\/projects\/([^/]+)\/repos\/([^/]+)(\/.*)?$/.exec(path);
    if (!repo) return error(404, "No such resource");
    if (!isRepo(repo[1]!, repo[2]!)) return error(404, `Repository ${repo[1]}/${repo[2]} does not exist.`);
    const rest = repo[3] ?? "";

    if (rest === "" && method === "GET") return { status: 200, body: F.repository };
    if (rest === "/default-branch" && method === "GET") return { status: 200, body: F.defaultBranch };

    if (rest === "/pull-requests" && method === "GET") return { status: 200, body: paged(listPullRequests(query), query, LIST_PAGE_CAP) };
    if (rest === "/pull-requests" && method === "POST") return createPullRequest(body);

    const diff = /^\/pull-requests\/(\d+)\.diff$/.exec(rest);
    if (diff && method === "GET") {
      const pr = find(diff[1]!);
      if (!pr) return error(404, "Pull request does not exist");
      const accept = String(headers.accept ?? "");
      if (accept.includes("application/json") && !accept.includes("text/plain") && !accept.includes("*/*")) {
        return { status: 406, text: "" };
      }
      return { status: 200, text: pr.id === 1338 ? F.diff1338 : F.defaultDiff, headers: { "content-type": "text/plain;charset=UTF-8" } };
    }

    const pull = /^\/pull-requests\/(\d+)(\/.*)?$/.exec(rest);
    if (!pull) return error(404, "No such resource");
    const pr = find(pull[1]!);
    if (!pr) return error(404, `Pull request ${pull[1]} does not exist in ${repo[1]}/${repo[2]}.`);
    const sub = pull[2] ?? "";

    if (sub === "" && method === "GET") return { status: 200, body: pr };
    if (sub === "" && method === "PUT") {
      const stale = checkVersion(pr, body?.version);
      if (stale) return stale;
      if (typeof body.title === "string") pr.title = body.title;
      if (typeof body.description === "string") pr.description = body.description;
      const names: string[] = Array.isArray(body.reviewers) ? body.reviewers.map((r: any) => r.user?.name) : [];
      pr.reviewers = names.map(
        (name) =>
          pr.reviewers.find((r) => r.user.name === name) ??
          F.participant((F.users as Record<string, F.User>)[name]!, "REVIEWER", "UNAPPROVED"),
      );
      bump(pr);
      return { status: 200, body: pr };
    }
    if (sub === "/merge" && method === "GET") return { status: 200, body: F.mergeStatus[pr.id] ?? F.defaultMergeStatus };
    if ((sub === "/merge" || sub === "/decline") && method === "POST") {
      const stale = checkVersion(pr, query.get("version") === null ? undefined : Number(query.get("version")));
      if (stale) return stale;
      if (sub === "/merge" && (F.mergeStatus[pr.id] as any)?.conflicted) {
        return error(409, "The pull request has conflicts and cannot be merged.", {
          exceptionName: "com.atlassian.bitbucket.pull.PullRequestMergeVetoedException",
          conflicted: true,
          vetoes: [],
        });
      }
      pr.state = sub === "/merge" ? "MERGED" : "DECLINED";
      pr.open = false;
      pr.closed = true;
      bump(pr);
      return { status: 200, body: pr };
    }
    if (sub === "/activities" && method === "GET") return { status: 200, body: paged(pr.id === 1338 ? F.activities1338 : [], query) };
    if (sub === "/commits" && method === "GET") return { status: 200, body: paged(pr.id === 1338 ? F.commits1338 : [], query) };
    if (sub === "/comments" && method === "POST") {
      if (typeof body?.text !== "string" || body.text.length === 0) return error(400, "Comment text is required");
      const now = Date.now();
      return {
        status: 201,
        body: {
          id: nextCommentId++,
          version: 0,
          text: body.text,
          author: F.users.jdoe,
          createdDate: now,
          updatedDate: now,
          comments: [],
          threadResolved: false,
          severity: "NORMAL",
          state: "OPEN",
          ...(body.anchor ? { anchor: { ...body.anchor, orphaned: false } } : {}),
        },
      };
    }
    const part = /^\/participants\/([^/]+)$/.exec(sub);
    if (part && method === "PUT") {
      const slug = decodeURIComponent(part[1]!);
      const who = (F.users as Record<string, F.User>)[slug];
      if (!who) return error(404, "User does not exist");
      const status = body?.status;
      if (!["APPROVED", "NEEDS_WORK", "UNAPPROVED"].includes(status)) return error(400, "Invalid status");
      const entry = F.participant(who, "REVIEWER", status);
      const at = pr.reviewers.findIndex((r) => r.user.slug === slug);
      if (at >= 0) pr.reviewers[at] = entry;
      else pr.participants.push({ ...entry, role: "PARTICIPANT" });
      return { status: 200, body: entry };
    }
    return error(404, "No such resource");
  };

  const isRepo = (key: string, slug: string) => key.toUpperCase() === F.PROJECT && slug === F.SLUG;
  const find = (id: string) => prs.find((pr) => pr.id === Number(id));
  const bump = (pr: F.PullRequest) => {
    pr.version += 1;
    pr.updatedDate += 1000;
  };
  const checkVersion = (pr: F.PullRequest, version: unknown): Reply | null =>
    version === pr.version
      ? null
      : error(409, `You are attempting to modify a pull request based on out-of-date information.`, {
          exceptionName: "com.atlassian.bitbucket.pull.PullRequestOutOfDateException",
          currentVersion: pr.version,
        });

  const listPullRequests = (query: URLSearchParams) => {
    const state = (query.get("state") ?? "OPEN").toUpperCase();
    const text = query.get("filterText")?.toLowerCase();
    const at = query.get("at");
    const direction = (query.get("direction") ?? "INCOMING").toUpperCase();
    const order = (query.get("order") ?? "NEWEST").toUpperCase();
    return prs
      .filter((pr) => state === "ALL" || pr.state === state)
      .filter((pr) => !text || pr.title.toLowerCase().includes(text) || (pr.description ?? "").toLowerCase().includes(text))
      .filter((pr) => !at || (direction === "OUTGOING" ? pr.fromRef.id : pr.toRef.id) === at)
      .toSorted((a, b) => (order === "OLDEST" ? a.updatedDate - b.updatedDate : b.updatedDate - a.updatedDate));
  };

  const createPullRequest = (body: any): Reply => {
    const from = body?.fromRef?.id;
    const to = body?.toRef?.id;
    if (typeof body?.title !== "string" || typeof from !== "string" || typeof to !== "string") {
      return error(400, "title, fromRef.id and toRef.id are required");
    }
    const template = F.pullRequests()[0]!;
    const created: F.PullRequest = {
      ...template,
      id: 1400,
      version: 0,
      title: body.title,
      description: body.description,
      createdDate: Date.now(),
      updatedDate: Date.now(),
      fromRef: { ...template.fromRef, id: from, displayId: from.replace(/^refs\/heads\//, "") },
      toRef: { ...template.toRef, id: to, displayId: to.replace(/^refs\/heads\//, "") },
      author: F.participant(F.users.jdoe, "AUTHOR", "UNAPPROVED"),
      reviewers: [],
      links: { self: [{ href: `${F.PR_BASE}/1400` }] },
    };
    prs.push(created);
    return { status: 201, body: created };
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://fake");
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: any = raw;
      try {
        body = raw.length === 0 ? undefined : JSON.parse(raw);
      } catch {}
      requests.push({ method: req.method ?? "", url: req.url ?? "", path: url.pathname, query: url.searchParams, headers: req.headers, body });
      const reply: Reply =
        failures.has(url.pathname)
          ? error(failures.get(url.pathname)!, "Injected failure")
          : req.headers.authorization === `Bearer ${TOKEN}`
          ? route(req.method ?? "", url.pathname, url.searchParams, req.headers, body)
          : error(401, "Authentication failed. Please check your credentials and try again.", {
              exceptionName: "com.atlassian.bitbucket.auth.IncorrectPasswordAuthenticationException",
            });
      const headers: Record<string, string> = { ...(reply.headers ?? {}) };
      if (reply.status !== 401) headers["x-ausername"] = "jdoe";
      if (reply.text !== undefined) {
        res.writeHead(reply.status, { "content-type": "text/plain;charset=UTF-8", ...headers });
        res.end(reply.text);
      } else if (reply.body !== undefined) {
        res.writeHead(reply.status, { "content-type": "application/json;charset=UTF-8", ...headers });
        res.end(JSON.stringify(reply.body));
      } else {
        res.writeHead(reply.status, headers);
        res.end();
      }
    });
  });

  return {
    requests,
    reset,
    fail: (path: string, status: number) => failures.set(path, status),
    pullRequest: (id: number) => prs.find((pr) => pr.id === id),
    listen: () =>
      new Promise<string>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
      ),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
