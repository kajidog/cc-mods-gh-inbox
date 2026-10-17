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
export type Check = { id: string; name: string; isFailed: boolean; failedStep: string | null; url: string }

export type Pull = {
  ref: PullRef
  viewer: string
  title: string
  url: string
  state: PullState
  mergedBy: string | null
  closedAt: string | null
  comments: Comment[]
  reviews: Review[]
  commits: Commit[]
  /** The checks of the newest commit. */
  checks: Check[]
}

// One request a check: GraphQL costs one point of the 5000 an hour.
export const PULL_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title url state closedAt
      mergedBy { login }
      comments(last: 50) { nodes { id author { login } body createdAt url } }
      reviews(last: 50) { nodes { id author { login } state body submittedAt url
        comments(first: 50) { nodes { id author { login } createdAt path line originalLine diffHunk body url } } } }
      commits(last: 50) { nodes { commit { oid messageHeadline additions deletions committedDate url
        author { name user { login } } } } }
      latest: commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { __typename
        ... on CheckRun { databaseId name conclusion detailsUrl
          checkSuite { workflowRun { workflow { name } } }
          steps(first: 100) { nodes { name conclusion } } }
        ... on StatusContext { id context state targetUrl } } } } } } }
    }
  }
}`

const FAILED_RUN = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE"])
const FAILED_STATUS = new Set(["FAILURE", "ERROR"])

/** Reads `owner/repo#number` and its host off a pull request's URL. */
export function parsePullUrl(url: string): PullRef | null {
  const match = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url.trim())
  if (match === null) return null
  const [, host = "", owner = "", repo = "", number = ""] = match

  return { host, owner, repo, number: Number(number) }
}

export const pullName = (ref: PullRef) => `${ref.owner}/${ref.repo}#${ref.number}`

/** The argv that fetches a pull request with `PULL_QUERY`. */
export function pullArgv(ref: PullRef): string[] {
  return [
    "gh",
    "api",
    ...(ref.host === "github.com" ? [] : ["--hostname", ref.host]),
    "graphql",
    "-f",
    `owner=${ref.owner}`,
    "-f",
    `repo=${ref.repo}`,
    "-F",
    `number=${ref.number}`,
    "-f",
    `query=${PULL_QUERY}`,
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

/** Reads `PULL_QUERY`'s answer; throws with GitHub's own words when it carries errors. */
export function parsePull(ref: PullRef, answer: string): Pull {
  const json = object(JSON.parse(answer))
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(text(object(json.errors[0]).message) || "GitHub answered with an error")
  }
  const data = object(json.data)
  const pull = object(object(data.repository).pullRequest)
  if (Object.keys(pull).length === 0) throw new Error(`${pullName(ref)} was not found`)

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
  const latest = object(nodes(pull.latest)[0]?.commit)
  const checks = nodes(object(object(latest.statusCheckRollup).contexts)).flatMap((node): Check[] => {
    if (node.__typename === "CheckRun") {
      const workflow = text(object(object(object(node.checkSuite).workflowRun).workflow).name)
      const name = text(node.name)
      const failedStep = nodes(node.steps).find(step => FAILED_RUN.has(text(step.conclusion)))
      return [
        {
          id: `run:${String(node.databaseId)}`,
          name: workflow && workflow !== name ? `${workflow} / ${name}` : name,
          isFailed: FAILED_RUN.has(text(node.conclusion)),
          failedStep: failedStep === undefined ? null : text(failedStep.name),
          url: text(node.detailsUrl),
        },
      ]
    }
    if (node.__typename === "StatusContext") {
      return [
        {
          id: `status:${text(node.id)}`,
          name: text(node.context),
          isFailed: FAILED_STATUS.has(text(node.state)),
          failedStep: null,
          url: text(node.targetUrl),
        },
      ]
    }
    return []
  })

  return {
    ref,
    viewer: login(data.viewer) ?? "",
    title: text(pull.title),
    url: text(pull.url),
    state: state === "MERGED" || state === "CLOSED" ? state : "OPEN",
    mergedBy: login(pull.mergedBy),
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
    checks,
  }
}
