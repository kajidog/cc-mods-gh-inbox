// The pull requests the band above the prompt shows: the open ones the person opened, and those they are asked to
// review, each with where it stands, found by one request a host.

import { login, MERGE_INFO_PREVIEW, object, parsePullUrl, parseStanding, type PullRef, type Standing, standingFields, text } from "./github"
import { type Language, MESSAGES } from "./i18n"

/** Pull requests found at most by each search on a host: those updated last. */
export const MINE_LISTED = 10

/** What each search finds: the open pull requests the person opened, and those asked of them to review. */
const SEARCHES = {
  opened: "is:pr is:open author:@me archived:false sort:updated-desc",
  requested: "is:pr is:open review-requested:@me archived:false sort:updated-desc",
} as const
export type MineGroup = keyof typeof SEARCHES

/**
 * Both searches in one request a host, one point however many they find: each found is asked where it stands, its
 * checks only how each went; `teams` as `reviewersFields` takes it.
 */
export const mineQuery = (teams = true) => `query {
  viewer { login }
  ${Object.entries(SEARCHES)
    .map(
      ([alias, query]) => `${alias}: search(type: ISSUE, first: ${MINE_LISTED}, query: "${query}") {
    issueCount
    nodes { ... on PullRequest { number title url updatedAt author { login } ${standingFields(teams)} } }
  }`,
    )
    .join("\n  ")}
}`

/** The argv that searches one host for the person's open pull requests and those asked of them, `teams` as `reviewersFields` takes it. */
export const mineArgv = (host: string, teams = true) => [
  "gh",
  "api",
  ...(host === "github.com" ? [] : ["--hostname", host]),
  "-H",
  MERGE_INFO_PREVIEW,
  "graphql",
  "-f",
  `query=${mineQuery(teams)}`,
]

/** One pull request found: where it is, what it is called, who opened it, and where it stands. */
export type MinePull = Standing & { ref: PullRef; title: string; url: string; updatedAt: string; author: string | null }

/** What one search found: those listed, updated last first, and how many there are in all. */
export type MineFound = { pulls: MinePull[]; total: number }

/** Reads `mineQuery`'s answer, by search; throws with GitHub's own words when it carries errors. */
export function parseMine(answer: string, language: Language = "en"): Record<MineGroup, MineFound> {
  const json = object(JSON.parse(answer))
  if (Array.isArray(json.errors) && json.errors.length > 0) throw new Error(text(object(json.errors[0]).message) || MESSAGES[language].githubError)
  const data = object(json.data)
  const read = (group: MineGroup): MineFound => {
    const search = object(data[group])
    const found = Array.isArray(search.nodes) ? search.nodes.map(object) : []
    const pulls = found.flatMap((node): MinePull[] => {
      const ref = parsePullUrl(text(node.url))
      if (ref === null) return []
      const pull = { ref: { ...ref, host: ref.host.toLowerCase() }, title: text(node.title), url: text(node.url), updatedAt: text(node.updatedAt) }
      return [{ ...pull, author: login(node.author), ...parseStanding(node) }]
    })
    return { pulls, total: Math.max(pulls.length, Number(search.issueCount) || 0) }
  }

  return { opened: read("opened"), requested: read("requested") }
}
