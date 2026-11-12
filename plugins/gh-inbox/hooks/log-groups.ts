// How the log pane shows the notices of the one repository it is narrowed to: together by the pull request (or issue)
// each is on, under a heading with its number, title and where a pull request stands now, and what is on none (a push,
// a branch, a run) together too.
import type { GhEvent } from "../types"

import { MERGE_INFO_PREVIEW, object, type PullState, parseStanding, type Standing, standingFields, text } from "./github"
import { repoOfEvent } from "./history"

/** Headings asked for in one GraphQL request at most. */
const HEADINGS_AT_ONCE = 50

// What a terminal draws two cells wide: East Asian wide and fullwidth letters (kana, kanji, hangul, fullwidth forms) and
// most emoji. Anything else is taken for one, a combining mark too, so a heading is never taken for shorter than it is.
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u

/** How many cells a terminal draws `text` in, as near as can be told without drawing it. */
export const cells = (text: string) => [...text].reduce((sum, char) => sum + (WIDE.test(char) ? 2 : 1), 0)

// A URL on a repository's own pages: its host, `owner/repo`, and the pull request's or issue's page it points into, if
// it does (a comment, a review, a commit of it).
const ON_REPO = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)(?:\/(pull|issues)\/(\d+))?(?:[/?#]|$)/

/** The host of `repo`'s own pages that `url` is on; undefined for a URL anywhere else (an outside CI's details). */
function hostOn(url: string, repo: string): string | undefined {
  const match = ON_REPO.exec(url)
  return match !== null && match[2]?.toLowerCase() === repo.toLowerCase() ? match[1] : undefined
}

/** The page of pull request or issue `number` of `repo` that `url` points into; undefined for any other URL. */
function pageOn(url: string, repo: string, number: number): string | undefined {
  const [, host, named, kind, at] = ON_REPO.exec(url) ?? []
  if (named?.toLowerCase() !== repo.toLowerCase() || kind === undefined || Number(at) !== number) return undefined
  return `https://${host}/${named}/${kind}/${at}`
}

/** The number of the pull request or issue a notice is on; undefined for one on the repository alone (a push, a branch). */
export function numberOf(event: Pick<GhEvent, "pull">): number | undefined {
  const match = /#(\d+)$/.exec(event.pull)
  return match === null ? undefined : Number(match[1])
}

/** `list` with each pull request's notices together, in the order of each one's first; within each, in the order they came. */
export function byPull(list: readonly GhEvent[]): GhEvent[] {
  const groups = new Map<string, GhEvent[]>()
  for (const event of list) {
    const group = groups.get(event.pull)
    if (group === undefined) groups.set(event.pull, [event])
    else group.push(event)
  }

  return [...groups.values()].flat()
}

/** One heading of the narrowed log: the notices on one pull request or issue, or on none (`number` undefined). */
export type PullGroup = {
  /** `owner/repo#number`, or `owner/repo` for those on none. */
  pull: string
  number: number | undefined
  /** `host/owner/repo#number`, by which its heading is known; undefined for those on none. */
  key: string | undefined
  /** Where its heading links to; "" for those on none. */
  url: string
  events: GhEvent[]
}

/**
 * `shown`, a page in the order `byPull` put them, as the headings it shows: one a run of notices on the same pull
 * request. The host is that of the repository's own pages its notices link to, else those `around` it (the rest of
 * the log); a CI notice, which links to its check's details (an outside CI's, maybe), is taken last. github.com where
 * none links to one.
 */
export function pullGroups(shown: readonly GhEvent[], around: readonly GhEvent[] = shown): PullGroup[] {
  const groups: PullGroup[] = []
  for (const event of shown) {
    const last = groups.at(-1)
    if (last !== undefined && last.pull === event.pull) last.events.push(event)
    else groups.push({ pull: event.pull, number: numberOf(event), key: undefined, url: "", events: [event] })
  }

  return groups.map(group => {
    const { number } = group
    if (number === undefined) return group
    const repo = repoOfEvent(group)
    const ciLast = (events: readonly GhEvent[]) => [...events.filter(event => event.kind !== "ci"), ...events.filter(event => event.kind === "ci")]
    const host =
      ciLast([...group.events, ...around].filter(event => repoOfEvent(event) === repo))
        .map(event => hostOn(event.url, repo))
        .find(one => one !== undefined) ?? "github.com"
    // A notice that links into the page of its pull request or issue on that host gives the heading its link; else the
    // pull request's page.
    const page = ciLast(group.events)
      .map(event => pageOn(event.url, repo, number))
      .find(url => url?.startsWith(`https://${host}/`))
    return { ...group, key: `${host}/${group.pull}`, url: page ?? `https://${host}/${repo}/pull/${number}` }
  })
}

/** The numbers of `groups` whose headings `known` holds nothing for, by `host/owner/repo`. */
export function headingsWanted(groups: readonly PullGroup[], known: ReadonlySet<string>): Map<string, number[]> {
  const wanted = new Map<string, number[]>()
  for (const group of groups) {
    if (group.key === undefined || group.number === undefined || known.has(group.key)) continue
    const repo = group.key.replace(/#\d+$/, "")
    const numbers = wanted.get(repo) ?? []
    if (!numbers.includes(group.number)) wanted.set(repo, [...numbers, group.number])
  }

  return wanted
}

/** What a narrowed log's heading says of a pull request or issue: its title, and of a pull request, where it stands now. */
export type LogHeading = { title: string; pull?: Standing & { state: PullState } }

/**
 * Asks the headings of the pull requests or issues `numbers` of the repository `host/owner/repo`, in one GraphQL
 * request: each one's title, and where a pull request stands, its checks asked only how each went; `teams` as
 * `reviewersFields` takes it.
 */
export function logHeadingsArgv(repo: string, numbers: readonly number[], teams = true): string[] {
  const [host = "", owner = "", name = ""] = repo.split("/")
  const fields = numbers
    .slice(0, HEADINGS_AT_ONCE)
    .filter(number => Number.isInteger(number) && number > 0)
    .map(number => `n${number}: issueOrPullRequest(number: ${number}) { __typename ... on PullRequest { title state ${standingFields(teams)} } ... on Issue { title } }`)
    .join(" ")
  return [
    "gh",
    "api",
    ...(host === "github.com" ? [] : ["--hostname", host]),
    "-H",
    MERGE_INFO_PREVIEW,
    "graphql",
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${name}`,
    "-f",
    `query=query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${fields} } }`,
  ]
}

/**
 * Reads `logHeadingsArgv`'s answer, by number: a number GitHub answered with nothing (no such pull request or issue)
 * has the title "", so it is not asked again; a repository it did not answer for at all leaves every number out, to be
 * asked again.
 */
export function parseLogHeadings(answer: string): Map<number, LogHeading> {
  const repository = object(object(object(JSON.parse(answer)).data).repository)
  const headings = new Map<number, LogHeading>()
  for (const [alias, value] of Object.entries(repository)) {
    const number = Number(alias.slice(1))
    if (!alias.startsWith("n") || !Number.isInteger(number)) continue
    const node = object(value)
    const state = text(node.state)
    const title = text(node.title)
    const pull: LogHeading["pull"] =
      node.__typename === "PullRequest" ? { state: state === "MERGED" || state === "CLOSED" ? state : "OPEN", ...parseStanding(node) } : undefined
    headings.set(number, pull === undefined ? { title } : { title, pull })
  }

  return headings
}
