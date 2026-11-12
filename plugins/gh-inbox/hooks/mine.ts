// The pull requests the person opened, as the band above the prompt shows them: each open one and where it stands,
// found by one search a host.

import { MERGE_INFO_PREVIEW, object, parsePullUrl, parseStanding, type PullRef, type Standing, standingFields, text } from "./github"
import { type Language, MESSAGES } from "./i18n"

/** Pull requests found at most a host: those updated last. */
export const MINE_LISTED = 10

/**
 * One search a host, one point however many it finds: each found is asked where it stands, its checks only how each
 * went; `teams` as `reviewersFields` takes it.
 */
export const mineQuery = (teams = true) => `query {
  viewer { login }
  search(type: ISSUE, first: ${MINE_LISTED}, query: "is:pr is:open author:@me archived:false sort:updated-desc") {
    issueCount
    nodes { ... on PullRequest { number title url updatedAt ${standingFields(teams)} } }
  }
}`

/** The argv that searches one host for the open pull requests the person opened, `teams` as `reviewersFields` takes it. */
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

/** One pull request the person opened: where it is, what it is called, and where it stands. */
export type MinePull = Standing & { ref: PullRef; title: string; url: string; updatedAt: string }

/** Reads `mineQuery`'s answer: those found, updated last first, and how many are open in all; throws with GitHub's own words when it carries errors. */
export function parseMine(answer: string, language: Language = "en"): { pulls: MinePull[]; total: number } {
  const json = object(JSON.parse(answer))
  if (Array.isArray(json.errors) && json.errors.length > 0) throw new Error(text(object(json.errors[0]).message) || MESSAGES[language].githubError)
  const search = object(object(json.data).search)
  const found = Array.isArray(search.nodes) ? search.nodes.map(object) : []
  const pulls = found.flatMap((node): MinePull[] => {
    const ref = parsePullUrl(text(node.url))
    if (ref === null) return []
    return [{ ref: { ...ref, host: ref.host.toLowerCase() }, title: text(node.title), url: text(node.url), updatedAt: text(node.updatedAt), ...parseStanding(node) }]
  })

  return { pulls, total: Math.max(pulls.length, Number(search.issueCount) || 0) }
}
