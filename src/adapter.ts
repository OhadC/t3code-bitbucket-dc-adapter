import http from "node:http";
import { findAnchor, normalizeDiff, parseDiff } from "./diff.ts";
import * as map from "./map.ts";

type J = any;

class HttpError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  constructor(status: number, message: string, retryAfter: string | null = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

interface Reply {
  readonly status?: number;
  readonly json?: unknown;
  readonly text?: string;
}

interface Ctx {
  readonly url: URL;
  readonly origin: string;
  readonly auth: string | undefined;
  readonly body: J;
  readonly params: string[];
}

type Handler = (ctx: Ctx) => Promise<Reply>;

const API = "/rest/api/1.0";
const MERGE_STRATEGY: Record<string, string> = {
  merge_commit: "no-ff",
  squash: "squash",
  rebase_fast_forward: "rebase-ff-only",
};
const SERVER_STATE: Record<string, string> = {
  OPEN: "OPEN",
  MERGED: "MERGED",
  DECLINED: "DECLINED",
  SUPERSEDED: "DECLINED",
};

const enc = encodeURIComponent;
const REPO = String.raw`^/repositories/([^/]+)/([^/]+)`;
const PR = String.raw`${REPO}/pullrequests/(\d+)`;
const route = (pattern: string) => new RegExp(`${pattern}$`);
const EMPTY_PAGE: Reply = { json: { pagelen: 50, values: [] } };

export function createAdapter(opts: {
  upstream: string;
  log?: (line: string) => void;
}): http.Server {
  const upstream = opts.upstream.replace(/\/+$/, "");
  const log = opts.log ?? ((line: string) => console.log(line));

  async function send(
    auth: string | undefined,
    method: string,
    path: string,
    body?: unknown,
    accept = "application/json",
  ) {
    const response = await fetch(upstream + path, {
      method,
      headers: {
        accept,
        "x-atlassian-token": "no-check",
        ...(auth ? { authorization: auth } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(25_000),
    });
    const text = await response.text();
    if (response.status < 200 || response.status >= 300) {
      let message = `Bitbucket Server returned HTTP ${response.status}.`;
      try {
        message = JSON.parse(text).errors?.[0]?.message ?? message;
      } catch {}
      throw new HttpError(response.status, message, response.headers.get("retry-after"));
    }
    return { text, user: response.headers.get("x-ausername") };
  }

  const get = async (ctx: Ctx, path: string): Promise<J> => JSON.parse((await send(ctx.auth, "GET", path)).text);
  const write = async (ctx: Ctx, method: string, path: string, body: unknown): Promise<J> => {
    const { text } = await send(ctx.auth, method, path, body);
    return text.length > 0 ? JSON.parse(text) : {};
  };

  const repoPath = (ctx: Ctx, api = API) => `${api}/projects/${enc(ctx.params[0]!)}/repos/${enc(ctx.params[1]!)}`;
  const prPath = (ctx: Ctx) => `${repoPath(ctx)}/pull-requests/${enc(ctx.params[2]!)}`;
  const getPr = (ctx: Ctx) => get(ctx, prPath(ctx));

  const paging = (ctx: Ctx, extra: Record<string, string> = {}) =>
    new URLSearchParams({
      start: ctx.url.searchParams.get("start") ?? "0",
      limit: ctx.url.searchParams.get("pagelen") ?? "25",
      ...extra,
    }).toString();

  function page(ctx: Ctx, server: J, values: unknown[]): Reply {
    const out: J = { pagelen: server.limit, values };
    if (server.isLastPage === false && typeof server.nextPageStart === "number") {
      const next = new URL(ctx.url.href);
      next.searchParams.set("start", String(server.nextPageStart));
      out.next = `${ctx.origin}${next.pathname}${next.search}`;
    }
    return { json: out };
  }

  async function me(ctx: Ctx): Promise<J> {
    const { user: name } = await send(ctx.auth, "GET", `${API}/profile/recent/repos?limit=1`);
    if (!name) throw new HttpError(401, "Bitbucket Server did not name the token's account.");
    return get(ctx, `${API}/users/${enc(name)}`);
  }

  async function diffText(ctx: Ctx): Promise<string> {
    return normalizeDiff((await send(ctx.auth, "GET", `${prPath(ctx)}.diff`, undefined, "text/plain")).text);
  }

  async function vote(ctx: Ctx, status: string): Promise<Reply> {
    const self = await me(ctx);
    const participant = await write(ctx, "PUT", `${prPath(ctx)}/participants/${enc(self.slug ?? self.name)}`, {
      status,
    });
    return {
      json: {
        type: "participant",
        user: map.user(participant.user ?? self),
        role: participant.role ?? "PARTICIPANT",
        approved: status === "APPROVED",
        state: status === "APPROVED" ? "approved" : "changes_requested",
      },
    };
  }

  async function transition(ctx: Ctx, action: "merge" | "decline", body: unknown): Promise<Reply> {
    const current = await getPr(ctx);
    const pr = await write(ctx, "POST", `${prPath(ctx)}/${action}?version=${current.version}`, body);
    return { json: map.pullRequest(pr) };
  }

  const routes: Array<[string, RegExp, Handler]> = [
    [
      "GET",
      /^\/user$/,
      async (ctx) => {
        const u = await me(ctx);
        return { json: map.user(u) };
      },
    ],
    [
      "GET",
      /^\/user\/workspaces\/([^/]+)\/permissions\/repositories$/,
      async () => EMPTY_PAGE,
    ],
    [
      "GET",
      route(REPO),
      async (ctx) => {
        const [repo, branch] = await Promise.all([
          get(ctx, repoPath(ctx)),
          get(ctx, `${repoPath(ctx)}/default-branch`).catch((error) => {
            if (error instanceof HttpError && error.status === 404) return null;
            throw error;
          }),
        ]);
        return { json: map.repository(repo, branch) };
      },
    ],
    [
      "GET",
      route(`${REPO}/branching-model`),
      async (ctx) =>
        ({
          json: map.branchingModel(
            await get(ctx, `${repoPath(ctx, "/rest/branch-utils/1.0")}/branchmodel`),
          ),
        }),
    ],
    [
      "GET",
      route(`${REPO}/pullrequests`),
      async (ctx) => {
        const query = map.parseListQuery(ctx.url.searchParams.get("q"));
        if (query === null) throw new HttpError(501, `Unsupported q: ${ctx.url.searchParams.get("q")}`);
        const wanted = new Set(ctx.url.searchParams.getAll("state").map((s) => SERVER_STATE[s.toUpperCase()]));
        if (wanted.has(undefined)) throw new HttpError(501, "Unsupported state filter.");
        if (wanted.size === 0) wanted.add("OPEN");
        const extra: Record<string, string> = {
          state: wanted.size === 1 ? [...wanted][0]! : "ALL",
          order: "NEWEST",
        };
        if (query.branch !== undefined) {
          extra.at = `refs/heads/${query.branch}`;
          extra.direction = "OUTGOING";
        }
        if (query.search !== undefined) extra.filterText = query.search;
        const server = await get(ctx, `${repoPath(ctx)}/pull-requests?${paging(ctx, extra)}`);
        const values = (server.values as J[])
          .filter((pr) => wanted.has(pr.state))
          .filter((pr) => query.updatedBefore === undefined || pr.updatedDate <= query.updatedBefore)
          .map((pr) => map.pullRequest(pr));
        return page(ctx, server, values);
      },
    ],
    [
      "POST",
      route(`${REPO}/pullrequests`),
      async (ctx) => {
        const b = ctx.body ?? {};
        const ref = (branch: string, fullName: string | undefined) => {
          const [project, slug] = fullName?.split("/") ?? [ctx.params[0], ctx.params[1]];
          return { id: `refs/heads/${branch}`, repository: { slug, project: { key: project } } };
        };
        const pr = await write(ctx, "POST", `${repoPath(ctx)}/pull-requests`, {
          title: b.title,
          description: b.description ?? "",
          fromRef: ref(b.source?.branch?.name, b.source?.repository?.full_name),
          toRef: ref(b.destination?.branch?.name, undefined),
        });
        return { status: 201, json: map.pullRequest(pr) };
      },
    ],
    [
      "GET",
      route(PR),
      async (ctx) => {
        const [pr, activities] = await Promise.all([
          getPr(ctx),
          get(ctx, `${prPath(ctx)}/activities?limit=50`),
        ]);
        return { json: map.pullRequest(pr, map.votedAt(activities.values)) };
      },
    ],
    [
      "PUT",
      route(PR),
      async (ctx) => {
        const b = ctx.body ?? {};
        if (Object.keys(b).some((key) => key !== "title" && key !== "description")) {
          throw new HttpError(501, `Unsupported pull request update: ${Object.keys(b).join(", ")}`);
        }
        const current = await getPr(ctx);
        const pr = await write(ctx, "PUT", prPath(ctx), {
          version: current.version,
          title: b.title ?? current.title,
          description: b.description ?? current.description ?? "",
          reviewers: (current.reviewers ?? []).map((r: J) => ({ user: { name: r.user.name } })),
        });
        return { json: map.pullRequest(pr) };
      },
    ],
    [
      "GET",
      route(`${PR}/diff`),
      async (ctx) => ({ text: await diffText(ctx) }),
    ],
    [
      "GET",
      route(`${PR}/diffstat`),
      async (ctx) => ({
        json: {
          pagelen: 500,
          values: parseDiff(await diffText(ctx)).map((f) => ({
            lines_added: f.added,
            lines_removed: f.removed,
          })),
        },
      }),
    ],
    [
      "GET",
      route(`${PR}/conflicts`),
      async (ctx) => {
        const check = await get(ctx, `${prPath(ctx)}/merge`);
        return { json: { pagelen: 50, values: check.conflicted === true ? [{ type: "conflict" }] : [] } };
      },
    ],
    [
      "GET",
      route(`${PR}/commits`),
      async (ctx) => {
        const server = await get(ctx, `${prPath(ctx)}/commits?${paging(ctx)}`);
        return page(ctx, server, server.values.map(map.commit));
      },
    ],
    [
      "GET",
      route(`${PR}/statuses`),
      async (ctx) => {
        const sha = (await getPr(ctx)).fromRef?.latestCommit;
        if (!sha) return EMPTY_PAGE;
        const server = await get(ctx, `/rest/build-status/1.0/commits/${enc(sha)}?${paging(ctx)}`);
        return page(ctx, server, map.statuses(server.values));
      },
    ],
    [
      "GET",
      route(`${PR}/comments`),
      async (ctx) => {
        const [pr, server] = await Promise.all([getPr(ctx), get(ctx, `${prPath(ctx)}/activities?${paging(ctx)}`)]);
        return page(ctx, server, map.comments(server.values, map.prUrl(pr)));
      },
    ],
    [
      "POST",
      route(`${PR}/comments`),
      async (ctx) => {
        const b = ctx.body ?? {};
        const body: J = { text: b.content?.raw ?? "" };
        if (b.parent?.id !== undefined) body.parent = { id: b.parent.id };
        if (b.inline?.path) {
          const sideName = typeof b.inline.to === "number" ? "to" : typeof b.inline.from === "number" ? "from" : null;
          if (sideName === null) throw new HttpError(501, "File-level comments are not supported.");
          const anchor = findAnchor(parseDiff(await diffText(ctx)), b.inline.path, sideName, b.inline[sideName]);
          if (anchor === null) throw new HttpError(400, `Line ${b.inline[sideName]} of ${b.inline.path} is not in the diff.`);
          body.anchor = anchor;
        }
        const created = await write(ctx, "POST", `${prPath(ctx)}/comments`, body);
        const pr = await getPr(ctx);
        return { status: 201, json: map.commentThread(created, map.prUrl(pr), b.parent?.id ?? null)[0] };
      },
    ],
    ["POST", route(`${PR}/approve`), (ctx) => vote(ctx, "APPROVED")],
    ["POST", route(`${PR}/request-changes`), (ctx) => vote(ctx, "NEEDS_WORK")],
    [
      "POST",
      route(`${PR}/merge`),
      (ctx) => {
        const requested = ctx.body?.merge_strategy;
        const strategyId = requested === undefined ? undefined : MERGE_STRATEGY[requested];
        if (requested !== undefined && strategyId === undefined) {
          throw new HttpError(501, `Unsupported merge strategy: ${requested}`);
        }
        return transition(ctx, "merge", strategyId === undefined ? {} : { strategyId });
      },
    ],
    ["POST", route(`${PR}/decline`), (ctx) => transition(ctx, "decline", {})],
  ];

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const origin = `http://${req.headers.host ?? "127.0.0.1"}`;
    const url = new URL(req.url ?? "/", origin);
    let status = 500;
    let note = "";
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: J = undefined;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : undefined;
      } catch {
        throw new HttpError(400, "Request body is not JSON.");
      }
      const path = url.pathname.startsWith("/2.0/") ? url.pathname.slice(4) : null;
      let reply: Reply | null = null;
      for (const [method, pattern, handler] of routes) {
        const m = path === null ? null : pattern.exec(path);
        if (m === null || method !== req.method) continue;
        const params = m.slice(1).map((p) => decodeURIComponent(p));
        reply = await handler({ url, origin, auth: req.headers.authorization, body, params });
        break;
      }
      if (reply === null) throw new HttpError(501, "Not supported by the adapter.");
      status = reply.status ?? 200;
      if (reply.text !== undefined) {
        res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
        res.end(reply.text);
      } else {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.json));
      }
    } catch (error) {
      const failure =
        error instanceof HttpError
          ? error
          : new HttpError(502, `Bitbucket Server unreachable: ${(error as Error).message}`);
      status = failure.status;
      note = ` ${failure.message}`;
      res.writeHead(status, {
        "content-type": "application/json",
        ...(failure.retryAfter ? { "retry-after": failure.retryAfter } : {}),
      });
      res.end(JSON.stringify({ type: "error", error: { message: failure.message } }));
    } finally {
      log(`${req.method} ${url.pathname}${url.search} -> ${status} ${Date.now() - started}ms${note}`);
    }
  });
}
