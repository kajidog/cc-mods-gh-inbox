import { type Language, MESSAGES } from "./i18n"

export type PullRef = { host: string; owner: string; repo: string; number: number }
export type PullState = "OPEN" | "CLOSED" | "MERGED"

export type Comment = { id: string; author: string | null; body: string; at: string; url: string }
export type ReviewComment = {
  id: string
  author: string | null
  at: string
  path: string
  line: number | null
  hunk: string
  body: string
  url: string
}
export type Review = {
  id: string
  author: string | null
  state: string
  body: string
  at: string
  url: string
  comments: ReviewComment[]
}
export type Commit = {
  oid: string
  author: string | null
  title: string
  additions: number
  deletions: number
  at: string
  url: string
}
/** Where a check run points in the code, as its annotation says. */
export type Annotation = { path: string; line: number | null; level: string; title: string; message: string }
export type Check = {
  id: string
  name: string
  isFailed: boolean
  failedStep: string | null
  url: string
  isPending: boolean
  /** How it ended, in GitHub's word (`SUCCESS`, `FAILURE`, `SKIPPED`, a status's `ERROR` …); "" while it runs. */
  conclusion: string
  /** The GitHub Actions run and job it is, whose log `gh run view` reads; null for another app's check or a status. */
  actions: { runId: number; jobId: number | null } | null
  /** What it says of itself: a check run's title, a status's description; "" with none. */
  summary: string
  /** Where it points in the code, as far as they were asked for; empty where they were not. */
  annotations: Annotation[]
  /** How many annotations it has, those not asked for too. */
  annotationCount: number
}
/** Someone a review is asked of: a person by their login, or a team by `org/team`. */
export type Reviewer = { login: string; isTeam: boolean }
/** A reviewer's last approving or change-requesting review: its state, and who gave it (null for a deleted account). */
export type Verdict = { state: string; author: string | null }
export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
/**
 * What GitHub says of merging it now, branch protection and all: `CLEAN` (mergeable, checks passing), `HAS_HOOKS`
 * (so, with pre-receive hooks), `UNSTABLE` (mergeable, a check not required failing), `BLOCKED` (a required review or
 * check missing), `BEHIND` (the base must be merged in first), `DIRTY` (conflicts), `DRAFT`, `UNKNOWN`.
 */
export type MergeState = "CLEAN" | "HAS_HOOKS" | "UNSTABLE" | "BLOCKED" | "BEHIND" | "DIRTY" | "DRAFT" | "UNKNOWN"
const MERGE_STATES: ReadonlySet<string> = new Set(["CLEAN", "HAS_HOOKS", "UNSTABLE", "BLOCKED", "BEHIND", "DIRTY", "DRAFT", "UNKNOWN"])

export type Pull = {
  ref: PullRef
  viewer: string
  /** Who opened it; null where GitHub names no one (a deleted account). */
  author: string | null
  title: string
  url: string
  state: PullState
  mergedBy: string | null
  /** Who closed it last; null while open, or for a merge. */
  closedBy: string | null
  closedAt: string | null
  comments: Comment[]
  reviews: Review[]
  commits: Commit[]
  /** The newest commit, whose checks `checks` are; "" where GitHub gave none. */
  head: string
  /** The checks of the newest commit. */
  checks: Check[]
  /** How many checks the newest commit has, those not listed in `checks` too. */
  checksTotal: number
  /** The newest commit's checks together, as GitHub rolls them up; null with none. */
  ciState: string | null
  /** Whether it merges into its base cleanly; UNKNOWN while GitHub works it out. */
  mergeable: Mergeable
  /** What GitHub says of merging it now; null where it said nothing (an answer kept from before it was asked for). */
  mergeState: MergeState | null
  /** Whether it is a draft. */
  isDraft: boolean
  /** How it merges once it can, where auto-merge is turned on for it (`MERGE`, `SQUASH`, `REBASE`); null where it is not. */
  autoMerge: string | null
  /** `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED`; null where the base asks for no review. */
  reviewDecision: string | null
  /** Each reviewer's last approving or change-requesting review. */
  verdicts: Verdict[]
  /** Those whose review is asked for and not given yet, people and teams; empty in an answer kept from before it was asked for. */
  requested: Reviewer[]
}

/** What where a pull request stands is read from, who wrote last aside: its CI, its reviews, whether it merges cleanly. */
export type Standing = Pick<Pull, "checks" | "ciState" | "verdicts" | "requested" | "reviewDecision" | "mergeable" | "mergeState" | "isDraft" | "autoMerge">

// Checks listed at most of a commit.
const CHECKS_LISTED = 100

/**
 * What a commit's checks are asked for by: how each went, its failed step, and where to read more; with
 * `annotations`, where each check run points in the code too, that many at most. Its words are its own
 * (scalars), so they cost nothing; annotations are a connection a check run, which costs.
 */
export const checksFields = (annotations: number) => `oid statusCheckRollup { state contexts(first: ${CHECKS_LISTED}) { totalCount nodes { __typename
  ... on CheckRun { databaseId name status conclusion detailsUrl title
    checkSuite { workflowRun { databaseId workflow { name } } }
    steps(first: 100) { nodes { name conclusion } }${
      annotations > 0 ? `\n    annotations(first: ${annotations}) { totalCount nodes { path annotationLevel title message location { start { line } } } }` : ""
    } }
  ... on StatusContext { id context state description targetUrl } } } }`

/**
 * Who a pull request's reviews are from and asked of: each reviewer's last say, and those asked who have not answered.
 * With `teams`, a team asked is named by `org/team`. Reading it takes the organization's teams (the `read:org` scope,
 * which `gh auth login` asks for): a token that may not makes GitHub refuse the whole request, so it is asked again
 * without them, a team asked then left out.
 */
export const reviewersFields = (teams = true) => `latestOpinionatedReviews(first: 50) { nodes { state author { login } } }
      reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login }${teams ? " ... on Team { combinedSlug }" : ""} } } }`

/**
 * What a pull request is asked for where it stands, as the line under the prompt tells it, `latest` its newest commit;
 * `teams` as `reviewersFields` takes it. The commit's checks are asked only how each went, so many pull requests cost
 * one point between them.
 */
export const standingFields = (teams = true) => `isDraft mergeable reviewDecision mergeStateStatus
      autoMergeRequest { mergeMethod }
      ${reviewersFields(teams)}
      latest: commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: ${CHECKS_LISTED}) { totalCount nodes { __typename
        ... on CheckRun { status conclusion }
        ... on StatusContext { state } } } } } } }`

/**
 * Whether `stdout` is GitHub's answer refusing a GraphQL request, rather than no answer at all (no network): one asking
 * for the teams asked to review is asked again without them.
 */
export function isRefused(stdout: string) {
  try {
    const errors = object(JSON.parse(stdout)).errors
    return Array.isArray(errors) && errors.length > 0
  } catch {
    return false
  }
}

// One request a check: GraphQL costs one point of the 5000 an hour. `teams` as `reviewersFields` takes it.
export const pullQuery = (teams = true) => `query($owner: String!, $repo: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title url state closedAt mergeable reviewDecision isDraft mergeStateStatus
      author { login }
      mergedBy { login }
      autoMergeRequest { mergeMethod }
      ${reviewersFields(teams)}
      closed: timelineItems(itemTypes: [CLOSED_EVENT], last: 1) { nodes { ... on ClosedEvent { actor { login } } } }
      comments(last: 50) { nodes { id author { login } body createdAt url } }
      reviews(last: 50) { nodes { id author { login } state body submittedAt url
        comments(first: 50) { nodes { id author { login } createdAt path line originalLine diffHunk body url } } } }
      commits(last: 50) { nodes { commit { oid messageHeadline additions deletions committedDate url
        author { name user { login } } } } }
      latest: commits(last: 1) { nodes { commit { ${checksFields(0)} } } }
    }
  }
}`

const FAILED_RUN = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE"])
const FAILED_STATUS = new Set(["FAILURE", "ERROR"])
const PENDING_STATUS = new Set(["PENDING", "EXPECTED"])

/** Reads `owner/repo#number` and its host off a pull request's URL. */
export function parsePullUrl(url: string): PullRef | null {
  const match = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url.trim())
  if (match === null) return null
  const [, host = "", owner = "", repo = "", number = ""] = match

  return { host, owner, repo, number: Number(number) }
}

export const pullName = (ref: PullRef) => `${ref.owner}/${ref.repo}#${ref.number}`

/**
 * What `mergeStateStatus` is asked with: GitHub keeps it under the merge info preview, which this media type asks for;
 * once the preview ends it is let be.
 */
export const MERGE_INFO_PREVIEW = "Accept: application/vnd.github.merge-info-preview+json"

/** The argv that fetches a pull request with `pullQuery`, `teams` as it takes it. */
export function pullArgv(ref: PullRef, teams = true): string[] {
  return [
    "gh",
    "api",
    ...(ref.host === "github.com" ? [] : ["--hostname", ref.host]),
    "-H",
    MERGE_INFO_PREVIEW,
    "graphql",
    "-f",
    `owner=${ref.owner}`,
    "-f",
    `repo=${ref.repo}`,
    "-F",
    `number=${ref.number}`,
    "-f",
    `query=${pullQuery(teams)}`,
  ]
}

export type Json = Record<string, unknown>
export const object = (value: unknown): Json => (typeof value === "object" && value !== null ? (value as Json) : {})
const nodes = (value: unknown): Json[] => {
  const list = object(value).nodes
  return Array.isArray(list) ? list.map(object) : []
}
export const text = (value: unknown) => (typeof value === "string" ? value : "")
export const login = (value: unknown) => {
  const name = object(value).login
  return typeof name === "string" ? name : null
}

// A GitHub Actions job's page, as a check run's details link it: the run and the job, whose logs `gh run view` reads.
const ACTIONS_JOB = /\/actions\/runs\/(\d+)\/job\/(\d+)/

/** Which run and job of GitHub Actions a check run is; null for another app's. */
function actionsOf(node: Json): Check["actions"] {
  const run = object(object(node.checkSuite).workflowRun)
  const linked = ACTIONS_JOB.exec(text(node.detailsUrl))
  const runId = linked === null ? Number(run.databaseId) : Number(linked[1])
  if (!Number.isInteger(runId) || runId <= 0) return null
  return { runId, jobId: linked === null ? null : Number(linked[2]) }
}

/** Each reviewer's last say, as `reviewersFields` asks for it. */
export const parseVerdicts = (value: unknown): Verdict[] => nodes(value).map(node => ({ state: text(node.state), author: login(node.author) }))

/** Those asked to review who have not answered, as `reviewersFields` asks for them: people by login, teams by `org/team` (none asked without them). */
export function parseRequested(value: unknown): Reviewer[] {
  return nodes(value).flatMap((node): Reviewer[] => {
    const asked = object(node.requestedReviewer)
    const name = asked.__typename === "Team" ? text(asked.combinedSlug) : text(asked.login)
    return name === "" ? [] : [{ login: name, isTeam: asked.__typename === "Team" }]
  })
}

/** A commit as `checksFields` asks for it: its id, its checks, GitHub's rollup of them, and how many there are, those not listed too. */
export function parseChecks(value: unknown): { oid: string; state: string | null; checks: Check[]; total: number } {
  const commit = object(value)
  const rollup = object(commit.statusCheckRollup)
  const contexts = object(rollup.contexts)
  const checks = nodes(contexts).flatMap((node): Check[] => {
    if (node.__typename === "CheckRun") {
      const workflow = text(object(object(object(node.checkSuite).workflowRun).workflow).name)
      const name = text(node.name)
      const failedStep = nodes(node.steps).find(step => FAILED_RUN.has(text(step.conclusion)))
      const annotations = nodes(node.annotations).map(one => {
        const line = object(object(one.location).start).line
        return { path: text(one.path), line: typeof line === "number" ? line : null, level: text(one.annotationLevel), title: text(one.title), message: text(one.message) }
      })
      return [
        {
          id: `run:${String(node.databaseId)}`,
          name: workflow && workflow !== name ? `${workflow} / ${name}` : name,
          isFailed: FAILED_RUN.has(text(node.conclusion)),
          failedStep: failedStep === undefined ? null : text(failedStep.name),
          url: text(node.detailsUrl),
          isPending: node.status !== undefined && text(node.status) !== "COMPLETED",
          conclusion: text(node.conclusion),
          actions: actionsOf(node),
          summary: text(node.title),
          annotations,
          annotationCount: Math.max(annotations.length, Number(object(node.annotations).totalCount) || 0),
        },
      ]
    }
    if (node.__typename === "StatusContext") {
      const state = text(node.state)
      return [
        {
          id: `status:${text(node.id)}`,
          name: text(node.context),
          isFailed: FAILED_STATUS.has(state),
          failedStep: null,
          url: text(node.targetUrl),
          isPending: PENDING_STATUS.has(state),
          conclusion: PENDING_STATUS.has(state) ? "" : state,
          actions: null,
          summary: text(node.description),
          annotations: [],
          annotationCount: 0,
        },
      ]
    }
    return []
  })

  return { oid: text(commit.oid), state: text(rollup.state) || null, checks, total: Math.max(checks.length, Number(contexts.totalCount) || 0) }
}

/** Whether it merges into its base cleanly, as GitHub says it; UNKNOWN for anything else. */
export const parseMergeable = (value: unknown): Mergeable => (value === "MERGEABLE" || value === "CONFLICTING" ? value : "UNKNOWN")

/** What GitHub says of merging it now; null where it said nothing it is known to say. */
export const parseMergeState = (value: unknown): MergeState | null => (MERGE_STATES.has(text(value)) ? (text(value) as MergeState) : null)

/** Where a pull request stands, as `standingFields` asks for it. */
export function parseStanding(node: Json): Standing {
  const ci = parseChecks(nodes(node.latest)[0]?.commit)
  return {
    checks: ci.checks,
    ciState: ci.state,
    verdicts: parseVerdicts(node.latestOpinionatedReviews),
    requested: parseRequested(node.reviewRequests),
    reviewDecision: text(node.reviewDecision) || null,
    mergeable: parseMergeable(node.mergeable),
    mergeState: parseMergeState(node.mergeStateStatus),
    isDraft: node.isDraft === true,
    autoMerge: text(object(node.autoMergeRequest).mergeMethod) || null,
  }
}

/** Reads `pullQuery`'s answer; throws with GitHub's own words when it carries errors. */
export function parsePull(ref: PullRef, answer: string, language: Language = "en"): Pull {
  const t = MESSAGES[language]
  const json = object(JSON.parse(answer))
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(text(object(json.errors[0]).message) || t.githubError)
  }
  const data = object(json.data)
  const pull = object(object(data.repository).pullRequest)
  if (Object.keys(pull).length === 0) throw new Error(t.notFound(pullName(ref)))

  const state = text(pull.state)
  const commits = nodes(pull.commits).map(node => {
    const commit = object(node.commit)
    const author = object(commit.author)
    return {
      oid: text(commit.oid),
      author: login(author.user) ?? (text(author.name) || null),
      title: text(commit.messageHeadline),
      additions: Number(commit.additions) || 0,
      deletions: Number(commit.deletions) || 0,
      at: text(commit.committedDate),
      url: text(commit.url),
    }
  })
  const latest = parseChecks(nodes(pull.latest)[0]?.commit)

  return {
    ref,
    viewer: login(data.viewer) ?? "",
    author: login(pull.author),
    title: text(pull.title),
    url: text(pull.url),
    state: state === "MERGED" || state === "CLOSED" ? state : "OPEN",
    mergedBy: login(pull.mergedBy),
    closedBy: login(object(nodes(pull.closed).at(-1)).actor),
    closedAt: text(pull.closedAt) || null,
    comments: nodes(pull.comments).map(node => ({
      id: text(node.id),
      author: login(node.author),
      body: text(node.body),
      at: text(node.createdAt),
      url: text(node.url),
    })),
    reviews: nodes(pull.reviews).map(node => ({
      id: text(node.id),
      author: login(node.author),
      state: text(node.state),
      body: text(node.body),
      at: text(node.submittedAt),
      url: text(node.url),
      comments: nodes(node.comments).map(comment => ({
        id: text(comment.id),
        author: login(comment.author),
        at: text(comment.createdAt),
        path: text(comment.path),
        line: typeof comment.line === "number" ? comment.line : typeof comment.originalLine === "number" ? comment.originalLine : null,
        hunk: text(comment.diffHunk),
        body: text(comment.body),
        url: text(comment.url),
      })),
    })),
    commits,
    head: latest.oid,
    checks: latest.checks,
    checksTotal: latest.total,
    ciState: latest.state,
    mergeable: parseMergeable(pull.mergeable),
    mergeState: parseMergeState(pull.mergeStateStatus),
    isDraft: pull.isDraft === true,
    autoMerge: text(object(pull.autoMergeRequest).mergeMethod) || null,
    reviewDecision: text(pull.reviewDecision) || null,
    verdicts: parseVerdicts(pull.latestOpinionatedReviews),
    requested: parseRequested(pull.reviewRequests),
  }
}
