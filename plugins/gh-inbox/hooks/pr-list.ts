// What `/inbox pr` reads and lists: its words (a pull request, what to do to it), the pull requests the log keeps
// notices of, each with the host and page its notices point into, and the headings (title, where it stands) asked of
// GitHub for those it lists whose standing is not known otherwise.
import type { GhEvent } from "../types"

import { isMethod, type Method } from "./act"
import { MERGE_INFO_PREVIEW, object, type PullState, parseStanding, type Standing, standingFields, text } from "./github"
import { repoOfEvent } from "./history"

/** What `/inbox pr [PR] <action>` does to a pull request: change it once confirmed in a pane, hand it to Claude, watch it. */
export const PR_ACTIONS = ["merge", "close", "draft", "approve", "unapprove", "pick", "watch", "unwatch"] as const
export type PrAction = (typeof PR_ACTIONS)[number]

export const isPrAction = (value: string): value is PrAction => PR_ACTIONS.includes(value as PrAction)

/** `/inbox pr`'s words read: the pull request ("" for the branch's), what to do to it (none: show it), a merge's method. */
export type PrWords = { pull: string; action: PrAction | undefined; method: Method | undefined }

/**
 * Reads `/inbox pr`'s words, in any order: one action, a merge's method, and the pull request (`12`, `owner/repo#12`,
 * its URL), "" where none is named; undefined where they say more than that.
 */
export function parsePrWords(words: readonly string[]): PrWords | undefined {
  const rest = [...words]
  const at = rest.findIndex(word => isPrAction(word.toLowerCase()))
  const action = at === -1 ? undefined : (rest.splice(at, 1)[0]?.toLowerCase() as PrAction)
  let method: Method | undefined
  // `merge` names the action first, then the method: `/inbox pr merge merge` merges with a merge commit.
  const named = action === "merge" ? rest.findIndex(word => isMethod(word.toUpperCase())) : -1
  if (named !== -1) method = rest.splice(named, 1)[0]?.toUpperCase() as Method
  if (rest.length > 1) return undefined

  return { pull: rest[0] ?? "", action, method }
}

/** Headings asked for in one GraphQL request at most. */
const HEADINGS_AT_ONCE = 50

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

/** The notices on one pull request or issue, or on none (`number` undefined). */
export type PullGroup = {
  /** `owner/repo#number`, or `owner/repo` for those on none. */
  pull: string
  number: number | undefined
  /** `host/owner/repo#number`, by which it is known; undefined for those on none. */
  key: string | undefined
  /** Its page: its notices' pull request's or issue's; "" for those on none. */
  url: string
  events: GhEvent[]
}

/**
 * `shown`, in the order `byPull` put them, a group each run of notices on the same pull request. The host is that of
 * the repository's own pages its notices link to, else those `around` it (the rest of the log); a CI notice, which
 * links to its check's details (an outside CI's, maybe), is taken last. github.com where none links to one.
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
    // A notice that links into the page of its pull request or issue on that host gives its page; else the pull request's.
    const page = ciLast(group.events)
      .map(event => pageOn(event.url, repo, number))
      .find(url => url?.startsWith(`https://${host}/`))
    return { ...group, key: `${host}/${group.pull}`, url: page ?? `https://${host}/${repo}/pull/${number}` }
  })
}

/**
 * The pull requests the log (`newest`, newest first) keeps notices of, the one with the newest notice first, each one's
 * notices newest first; an issue's, and those on no pull request (a push, a branch), left out.
 */
export function noticedPulls(newest: readonly GhEvent[]): PullGroup[] {
  return pullGroups(byPull(newest), newest).filter(group => group.number !== undefined && !/\/issues\/\d+$/.test(group.url))
}

/** The numbers of `pulls` (`host/owner/repo#number`) `known` holds nothing for, by `host/owner/repo`. */
export function headingsWanted(pulls: readonly string[], known: ReadonlySet<string>): Map<string, number[]> {
  const wanted = new Map<string, number[]>()
  for (const key of pulls) {
    const match = /^(.+)#(\d+)$/.exec(key)
    if (match === null || known.has(key)) continue
    const [, repo = "", at = ""] = match
    const numbers = wanted.get(repo) ?? []
    if (!numbers.includes(Number(at))) wanted.set(repo, [...numbers, Number(at)])
  }

  return wanted
}

/** What GitHub says of a number `/inbox pr` lists: its title, and of a pull request, where it stands. */
export type PrHeading = { title: string; pull?: Standing & { state: PullState } }

/**
 * Asks the headings of the pull requests or issues `numbers` of the repository `host/owner/repo`, in one GraphQL
 * request: each one's title, and where a pull request stands, its checks asked only how each went; `teams` as
 * `reviewersFields` takes it.
 */
export function headingsArgv(repo: string, numbers: readonly number[], teams = true): string[] {
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
 * Reads `headingsArgv`'s answer, by number: a number GitHub answered with nothing (no such pull request or issue) has
 * the title "", so it is not asked again; a repository it did not answer for at all leaves every number out, to be
 * asked again.
 */
export function parseHeadings(answer: string): Map<number, PrHeading> {
  const repository = object(object(object(JSON.parse(answer)).data).repository)
  const headings = new Map<number, PrHeading>()
  for (const [alias, value] of Object.entries(repository)) {
    const number = Number(alias.slice(1))
    if (!alias.startsWith("n") || !Number.isInteger(number)) continue
    const node = object(value)
    const state = text(node.state)
    const title = text(node.title)
    const pull: PrHeading["pull"] =
      node.__typename === "PullRequest" ? { state: state === "MERGED" || state === "CLOSED" ? state : "OPEN", ...parseStanding(node) } : undefined
    headings.set(number, pull === undefined ? { title } : { title, pull })
  }

  return headings
}
