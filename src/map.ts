type J = any;

const iso = (millis: number): string => new Date(millis).toISOString();

export const prUrl = (pr: J): string => pr.links.self[0].href;

export function user(u: J): J {
  const name = u?.name ?? null;
  if (name === null) return null;
  return {
    type: "user",
    uuid: name,
    account_id: name,
    nickname: name,
    username: name,
    display_name: u.displayName ?? name,
  };
}

function repositoryRef(repo: J): J {
  if (!repo?.project?.key || !repo.slug) return null;
  const workspace = String(repo.project.key).toLowerCase();
  return {
    type: "repository",
    full_name: `${workspace}/${repo.slug}`,
    name: repo.name ?? repo.slug,
    workspace: { slug: workspace },
  };
}

function side(ref: J): J {
  return {
    branch: { name: ref.displayId },
    commit: ref.latestCommit ? { hash: ref.latestCommit } : null,
    repository: repositoryRef(ref.repository),
  };
}

const VERDICT: Record<string, string> = { APPROVED: "approved", NEEDS_WORK: "changes_requested" };

export function votedAt(activities: readonly J[]): Map<string, number> {
  const times = new Map<string, number>();
  for (const activity of activities) {
    const name = activity.user?.name;
    if (!name || times.has(name)) continue;
    if (activity.action === "APPROVED" || activity.action === "REVIEWED") {
      times.set(name, activity.createdDate);
    }
  }
  return times;
}

export function pullRequest(pr: J, votes?: Map<string, number>): J {
  const participants = [...(pr.reviewers ?? []), ...(pr.participants ?? [])].map((p: J) => {
    const state = VERDICT[p.status] ?? null;
    const votedOn = votes && state ? (votes.get(p.user?.name) ?? pr.updatedDate) : null;
    return {
      type: "participant",
      user: user(p.user),
      role: p.role,
      approved: p.approved === true,
      state,
      participated_on: votedOn === null ? null : iso(votedOn),
    };
  });
  return {
    type: "pullrequest",
    id: pr.id,
    title: pr.title,
    description: pr.description ?? "",
    state: pr.state,
    draft: pr.draft === true,
    author: user(pr.author?.user),
    source: side(pr.fromRef),
    destination: side(pr.toRef),
    created_on: iso(pr.createdDate),
    updated_on: iso(pr.updatedDate),
    reviewers: (pr.reviewers ?? []).map((r: J) => user(r.user)).filter(Boolean),
    participants,
    links: { html: { href: prUrl(pr) } },
  };
}

export function repository(repo: J, defaultBranch: J): J {
  return {
    ...repositoryRef(repo),
    links: {
      html: { href: repo.links.self[0].href },
      clone: (repo.links.clone ?? []).map((c: J) => ({
        name: c.name === "http" ? "https" : c.name,
        href: c.href,
      })),
    },
    mainbranch: defaultBranch?.displayId ? { type: "branch", name: defaultBranch.displayId } : null,
  };
}

export function branchingModel(model: J): J {
  const dev = model?.development;
  return {
    type: "branching_model",
    development: dev?.displayId
      ? { name: dev.displayId, branch: { name: dev.displayId }, use_mainbranch: false, is_valid: true }
      : { use_mainbranch: true },
  };
}

export function commit(c: J): J {
  const a = c.author ?? {};
  const name = a.displayName ?? a.name ?? "";
  return {
    type: "commit",
    hash: c.id,
    message: c.message ?? "",
    date: iso(c.committerTimestamp ?? c.authorTimestamp),
    author: { raw: a.emailAddress ? `${name} <${a.emailAddress}>` : name, user: a.slug ? user(a) : null },
  };
}

export function statuses(values: readonly J[]): J[] {
  return [...values]
    .sort((x, y) => (x.dateAdded ?? 0) - (y.dateAdded ?? 0))
    .map((s) => ({
      type: "build",
      key: s.key,
      name: s.name ?? s.key,
      state: s.state === "CANCELLED" ? "STOPPED" : s.state,
      description: s.description ?? "",
      url: s.url,
    }));
}

function toInline(anchor: J): J {
  if (!anchor?.path) return null;
  const line = typeof anchor.line === "number" ? anchor.line : null;
  const from =
    anchor.fileType === "FROM" || (anchor.fileType !== "TO" && anchor.lineType === "REMOVED");
  return {
    path: anchor.path,
    from: from ? line : null,
    to: from ? null : line,
    outdated: anchor.orphaned === true,
  };
}

function comment(c: J, url: string, parentId: number | null, inline: J, resolved: boolean): J {
  return {
    type: "pullrequest_comment",
    id: c.id,
    content: { raw: c.text ?? "" },
    user: user(c.author),
    created_on: iso(c.createdDate),
    parent: parentId === null ? null : { id: parentId },
    inline,
    resolution: resolved ? { type: "comment_resolution" } : null,
    links: { html: { href: `${url}/overview?commentId=${c.id}` } },
  };
}

export function commentThread(root: J, url: string, parentId: number | null = null): J[] {
  const inline = toInline(root.anchor);
  const resolved = root.threadResolved === true || root.state === "RESOLVED";
  const out: J[] = [];
  const walk = (c: J, parent: number | null) => {
    out.push(comment(c, url, parent, inline, parent === null && resolved));
    for (const reply of c.comments ?? []) walk(reply, c.id);
  };
  walk(root, parentId);
  return out;
}

export function comments(activities: readonly J[], url: string): J[] {
  return activities
    .filter((a) => a.action === "COMMENTED" && a.commentAction === "ADDED" && a.comment)
    .flatMap((a) => commentThread(a.comment, url));
}

export interface ListQuery {
  branch?: string;
  search?: string;
  updatedBefore?: number;
}

const LITERAL = String.raw`"((?:[^"\\]|\\.)*)"`;
const unescape = (value: string) => value.replace(/\\(.)/g, "$1");

export function parseListQuery(q: string | null): ListQuery | null {
  const out: ListQuery = {};
  let rest = (q ?? "").trim();
  const clauses: Array<[RegExp, (m: RegExpExecArray) => boolean]> = [
    [
      new RegExp(`^source\\.branch\\.name = ${LITERAL}`),
      (m) => {
        out.branch = unescape(m[1]!);
        return true;
      },
    ],
    [/^state = "\w+"/, () => true],
    [/^\(state = "\w+"(?: OR state = "\w+")*\)/, () => true],
    [
      new RegExp(`^\\(title ~ ${LITERAL} OR description ~ ${LITERAL}\\)`),
      (m) => {
        if (m[1] !== m[2]) return false;
        out.search = unescape(m[1]!);
        return true;
      },
    ],
    [
      /^updated_on <= (\S+)/,
      (m) => {
        const at = Date.parse(m[1]!);
        if (Number.isNaN(at)) return false;
        out.updatedBefore = at;
        return true;
      },
    ],
  ];
  while (rest.length > 0) {
    const hit = clauses.find(([re]) => re.test(rest));
    if (hit === undefined) return null;
    const m = hit[0].exec(rest)!;
    if (!hit[1](m)) return null;
    rest = rest.slice(m[0].length);
    if (rest.length === 0) break;
    if (!rest.startsWith(" AND ")) return null;
    rest = rest.slice(5);
  }
  return out;
}
