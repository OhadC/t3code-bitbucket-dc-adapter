export const HOST = "https://bitbucket.example:8443";
export const PROJECT = "PROJ";
export const SLUG = "web-app";
export const PR_BASE = `${HOST}/projects/${PROJECT}/repos/${SLUG}/pull-requests`;

const user = (name: string, displayName: string, id: number) => ({
  name,
  emailAddress: `${name}@example.com`,
  active: true,
  displayName,
  id,
  slug: name,
  type: "NORMAL",
  links: { self: [{ href: `${HOST}/users/${name}` }] },
});

export const users = {
  jdoe: user("jdoe", "John Doe", 101),
  asmith: user("asmith", "Alice Smith", 102),
  bwong: user("bwong", "Bob Wong", 103),
};
export type User = (typeof users)["jdoe"];

export const repository = {
  slug: SLUG,
  id: 4242,
  name: SLUG,
  hierarchyId: "a1b2c3d4e5f6a7b8c9d0",
  scmId: "git",
  state: "AVAILABLE",
  statusMessage: "Available",
  forkable: true,
  project: {
    key: PROJECT,
    id: 34,
    name: "Project",
    public: false,
    type: "NORMAL",
    links: { self: [{ href: `${HOST}/projects/${PROJECT}` }] },
  },
  public: false,
  archived: false,
  links: {
    clone: [
      { href: `ssh://git@bitbucket.example:7999/proj/${SLUG}.git`, name: "ssh" },
      { href: `${HOST}/scm/proj/${SLUG}.git`, name: "http" },
    ],
    self: [{ href: `${HOST}/projects/${PROJECT}/repos/${SLUG}/browse` }],
  },
};

export const DEVELOP = "gitflow/1.2/develop";
const DEVELOP_SHA = "0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e";

export const defaultBranch = {
  id: `refs/heads/${DEVELOP}`,
  displayId: DEVELOP,
  type: "BRANCH",
  latestCommit: DEVELOP_SHA,
  latestChangeset: DEVELOP_SHA,
  isDefault: true,
};

export const branchModel = {
  development: { ...defaultBranch },
  types: [
    { id: "BUGFIX", displayName: "Bugfix", enabled: true, prefix: "bugfix/" },
    { id: "FEATURE", displayName: "Feature", enabled: true, prefix: "feature/" },
    { id: "HOTFIX", displayName: "Hotfix", enabled: true, prefix: "hotfix/" },
    { id: "RELEASE", displayName: "Release", enabled: true, prefix: "release/" },
  ],
};

type Status = "APPROVED" | "NEEDS_WORK" | "UNAPPROVED";
export const participant = (u: User, role: string, status: Status, lastReviewedCommit?: string) => ({
  user: u,
  role,
  approved: status === "APPROVED",
  status,
  ...(lastReviewedCommit === undefined ? {} : { lastReviewedCommit }),
});

const ref = (branch: string, latestCommit: string) => ({
  id: `refs/heads/${branch}`,
  displayId: branch,
  latestCommit,
  type: "BRANCH",
  repository,
});

const pullRequest = (input: {
  id: number;
  version: number;
  title: string;
  description?: string;
  state: "OPEN" | "MERGED" | "DECLINED";
  draft?: boolean;
  from: string;
  sha: string;
  author: User;
  reviewers: ReturnType<typeof participant>[];
  createdDate: number;
  updatedDate: number;
}) => ({
  id: input.id,
  version: input.version,
  title: input.title,
  ...(input.description === undefined ? {} : { description: input.description }),
  state: input.state,
  open: input.state === "OPEN",
  closed: input.state !== "OPEN",
  draft: input.draft ?? false,
  createdDate: input.createdDate,
  updatedDate: input.updatedDate,
  ...(input.state === "OPEN" ? {} : { closedDate: input.updatedDate }),
  fromRef: ref(input.from, input.sha),
  toRef: ref(DEVELOP, DEVELOP_SHA),
  locked: false,
  author: participant(input.author, "AUTHOR", "UNAPPROVED"),
  reviewers: input.reviewers,
  participants: [] as ReturnType<typeof participant>[],
  properties: { resolvedTaskCount: 0, commentCount: 3, openTaskCount: 0 },
  links: { self: [{ href: `${PR_BASE}/${input.id}` }] },
});
export type PullRequest = ReturnType<typeof pullRequest>;

export const SHA_1338 = "8a4f1e57c0de4b1a9e2f3d4c5b6a79881726354a";

export const pullRequests = () => [
  pullRequest({
    id: 1338,
    version: 2,
    title: "Fix viewer zoom reset",
    description: "Zoom resets on window resize.",
    state: "OPEN",
    from: "bugfix/zoom-reset",
    sha: SHA_1338,
    author: users.jdoe,
    reviewers: [
      participant(users.asmith, "REVIEWER", "APPROVED", SHA_1338),
      participant(users.bwong, "REVIEWER", "NEEDS_WORK", SHA_1338),
    ],
    createdDate: 1791986141952,
    updatedDate: 1792053717798,
  }),
  pullRequest({
    id: 1337,
    version: 4,
    title: "Add toolbar",
    description: "Adds the toolbar.",
    state: "MERGED",
    from: "feature/toolbar",
    sha: "1111111111111111111111111111111111111111",
    author: users.asmith,
    reviewers: [participant(users.jdoe, "REVIEWER", "APPROVED")],
    createdDate: 1791900000000,
    updatedDate: 1792050000000,
  }),
  pullRequest({
    id: 1336,
    version: 1,
    title: "Experiment: dark mode",
    state: "DECLINED",
    from: "feature/dark-mode",
    sha: "2222222222222222222222222222222222222222",
    author: users.bwong,
    reviewers: [],
    createdDate: 1791800000000,
    updatedDate: 1792040000000,
  }),
  pullRequest({
    id: 1335,
    version: 5,
    title: "Bump dependencies",
    description: "Routine bump.",
    state: "OPEN",
    from: "chore/deps",
    sha: "3333333333333333333333333333333333333333",
    author: users.bwong,
    reviewers: [participant(users.jdoe, "REVIEWER", "UNAPPROVED")],
    createdDate: 1791700000000,
    updatedDate: 1792030000000,
  }),
  pullRequest({
    id: 1334,
    version: 0,
    title: "Viewer telemetry",
    description: "WIP",
    state: "OPEN",
    draft: true,
    from: "feature/telemetry",
    sha: "4444444444444444444444444444444444444444",
    author: users.jdoe,
    reviewers: [],
    createdDate: 1791600000000,
    updatedDate: 1792020000000,
  }),
];

export const mergeStatus: Record<number, unknown> = {
  1338: {
    canMerge: false,
    conflicted: false,
    outcome: "CLEAN",
    vetoes: [
      {
        summaryMessage: "Not all required reviewers have approved yet",
        detailedMessage: "At least 2 approvals are required.",
      },
    ],
  },
  1335: { canMerge: false, conflicted: true, outcome: "CONFLICTED", vetoes: [] },
};
export const defaultMergeStatus = { canMerge: true, conflicted: false, outcome: "CLEAN", vetoes: [] };

export const FILE = "projects/a/file.ts";
export const NEW_FILE = "projects/b/new.ts";

export const diff1338 = [
  `diff --git src://${FILE} dst://${FILE}`,
  "index 1234567aa..89abcdeff 100644",
  `--- src://${FILE}`,
  `+++ dst://${FILE}`,
  "@@ -259,3 +259,4 @@ fn",
  " ctx",
  "-removed",
  "+added one",
  "+added two",
  " ctx",
  `diff --git src://${NEW_FILE} dst://${NEW_FILE}`,
  "new file mode 100644",
  "index 000000000..1a2b3c4d5",
  "--- /dev/null",
  `+++ dst://${NEW_FILE}`,
  "@@ -0,0 +1 @@",
  "+export const x = 1;",
  "",
].join("\n");

export const defaultDiff = [
  "diff --git src://README.md dst://README.md",
  "index 0123456789..9876543210 100644",
  "--- src://README.md",
  "+++ dst://README.md",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

export const statuses: Record<string, unknown[]> = {
  [SHA_1338]: [
    {
      key: "ci-build",
      name: "CI build",
      state: "SUCCESSFUL",
      url: "https://ci.example/build/42",
      description: "Build #42 passed",
      dateAdded: 1792053000000,
    },
    {
      key: "lint",
      name: "Lint",
      state: "CANCELLED",
      url: "https://ci.example/lint/7",
      description: "Aborted",
      dateAdded: 1792052000000,
    },
    {
      key: "ci-build",
      name: "CI build",
      state: "FAILED",
      url: "https://ci.example/build/41",
      description: "Build #41 failed",
      dateAdded: 1792051000000,
    },
    {
      key: "e2e",
      name: "E2E",
      state: "INPROGRESS",
      url: "https://ci.example/e2e/3",
      description: "Running",
      dateAdded: 1792053500000,
    },
  ],
};

const anchor = (line: number, lineType: string, fileType: string) => ({
  fromHash: DEVELOP_SHA,
  toHash: SHA_1338,
  line,
  lineType,
  fileType,
  path: FILE,
  diffType: "EFFECTIVE",
  orphaned: false,
});

const comment = (
  id: number,
  text: string,
  author: User,
  createdDate: number,
  extra: Record<string, unknown> = {},
) => ({
  properties: { repositoryId: 4242 },
  id,
  version: 0,
  text,
  author,
  createdDate,
  updatedDate: createdDate,
  comments: [] as unknown[],
  threadResolved: false,
  severity: "NORMAL",
  state: "OPEN",
  permittedOperations: { editable: false, transitionable: true, deletable: false },
  ...extra,
});

export const T = {
  opened: 1791986141952,
  oldApprove: 1792000000000,
  general: 1792053300000,
  generalReply: 1792053350000,
  inlineTo: 1792053400000,
  inlineToReply: 1792053450000,
  inlineFrom: 1792053500000,
  reviewed: 1792053600000,
  approved: 1792053700000,
  rescoped: 1792053710000,
};

export const activities1338 = [
  {
    id: 9009,
    createdDate: T.rescoped,
    user: users.jdoe,
    action: "RESCOPED",
    fromHash: SHA_1338,
    previousFromHash: "9999999999999999999999999999999999999999",
    previousToHash: DEVELOP_SHA,
    toHash: DEVELOP_SHA,
    added: { commits: [], total: 0 },
    removed: { commits: [], total: 0 },
  },
  { id: 9008, createdDate: T.approved, user: users.asmith, action: "APPROVED" },
  { id: 9007, createdDate: T.reviewed, user: users.bwong, action: "REVIEWED" },
  {
    id: 9006,
    createdDate: T.inlineFrom,
    user: users.bwong,
    action: "COMMENTED",
    commentAction: "ADDED",
    comment: comment(3005, "Why was this removed?", users.bwong, T.inlineFrom, {
      anchor: anchor(260, "REMOVED", "FROM"),
    }),
    commentAnchor: anchor(260, "REMOVED", "FROM"),
  },
  {
    id: 9005,
    createdDate: T.inlineTo,
    user: users.asmith,
    action: "COMMENTED",
    commentAction: "ADDED",
    comment: comment(3003, "Nice fix here.", users.asmith, T.inlineTo, {
      anchor: anchor(260, "ADDED", "TO"),
      state: "RESOLVED",
      threadResolved: true,
      threadResolvedDate: 1792053460000,
      threadResolver: users.jdoe,
      comments: [comment(3004, "Thanks!", users.jdoe, T.inlineToReply)],
    }),
    commentAnchor: anchor(260, "ADDED", "TO"),
  },
  {
    id: 9004,
    createdDate: T.general,
    user: users.asmith,
    action: "COMMENTED",
    commentAction: "ADDED",
    comment: comment(3001, "Looks good overall.", users.asmith, T.general, {
      comments: [comment(3002, "Will merge after CI.", users.jdoe, T.generalReply)],
    }),
  },
  { id: 9003, createdDate: T.oldApprove, user: users.asmith, action: "APPROVED" },
  { id: 9002, createdDate: T.opened, user: users.jdoe, action: "OPENED" },
];

const commit = (
  id: string,
  message: string,
  author: Pick<User, "name" | "emailAddress">,
  authorTimestamp: number,
  committerTimestamp: number,
  parent: string,
) => ({
  id,
  displayId: id.slice(0, 11),
  author,
  authorTimestamp,
  committer: author,
  committerTimestamp,
  message,
  parents: [{ id: parent, displayId: parent.slice(0, 11) }],
});

export const COMMITS = {
  c1: "c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1",
  c2: "c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2",
  c3: SHA_1338,
};

export const commits1338 = [
  commit(COMMITS.c3, "Handle resize\n\nDebounce the handler.", users.jdoe, 1792050000000, 1792050500000, COMMITS.c2),
  commit(COMMITS.c2, "Review fixes", { name: "Ext Dev", emailAddress: "ext@example.com" }, 1792040000000, 1792040500000, COMMITS.c1),
  commit(COMMITS.c1, "Reset zoom on resize", users.jdoe, 1792030000000, 1792030500000, DEVELOP_SHA),
];
