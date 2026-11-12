// How the log pane shows the notices of the one repository it is narrowed to: together by the pull request (or issue)
// each is on, under a heading with its number and title, and what is on none (a push, a branch, a run) together too.
import type { GhEvent } from "../types"

import { object, text } from "./github"

/** Titles asked for in one GraphQL request at most. */
const TITLES_AT_ONCE = 50

const hostOf = (url: string) => /^https?:\/\/([^/]+)\//.exec(url)?.[1] ?? ""
// The page of a pull request or issue that a notice's URL points into: a comment, a review, a commit of it.
const PAGE = /^(https?:\/\/[^/]+\/[^/]+\/[^/]+\/(?:pull|issues)\/\d+)(?:[/?#]|$)/

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
  /** `host/owner/repo#number`, by which its title is known; undefined for those on none. */
  key: string | undefined
  /** Where its heading links to; "" for those on none. */
  url: string
  events: GhEvent[]
}

/** `shown`, a page in the order `byPull` put them, as the headings it shows: one a run of notices on the same pull request. */
export function pullGroups(shown: readonly GhEvent[]): PullGroup[] {
  const groups: PullGroup[] = []
  for (const event of shown) {
    const last = groups.at(-1)
    if (last !== undefined && last.pull === event.pull) last.events.push(event)
    else groups.push({ pull: event.pull, number: numberOf(event), key: undefined, url: "", events: [event] })
  }

  return groups.map(group => {
    if (group.number === undefined) return group
    // A notice that links into the page of its pull request or issue gives the heading its link; else the pull request's page.
    const page = group.events.map(event => PAGE.exec(event.url)?.[1]).find(url => url !== undefined)
    const host = group.events.map(event => hostOf(event.url)).find(one => one !== "") ?? "github.com"
    const repo = group.pull.replace(/#\d+$/, "")
    return { ...group, key: `${host}/${group.pull}`, url: page ?? `https://${host}/${repo}/pull/${group.number}` }
  })
}

/** The numbers of `groups` whose titles `known` holds nothing for, by `host/owner/repo`. */
export function titlesWanted(groups: readonly PullGroup[], known: ReadonlySet<string>): Map<string, number[]> {
  const wanted = new Map<string, number[]>()
  for (const group of groups) {
    if (group.key === undefined || group.number === undefined || known.has(group.key)) continue
    const repo = group.key.replace(/#\d+$/, "")
    const numbers = wanted.get(repo) ?? []
    if (!numbers.includes(group.number)) wanted.set(repo, [...numbers, group.number])
  }

  return wanted
}

/** Asks the titles of the pull requests or issues `numbers` of the repository `host/owner/repo`, in one GraphQL request. */
export function logTitlesArgv(repo: string, numbers: readonly number[]): string[] {
  const [host = "", owner = "", name = ""] = repo.split("/")
  const fields = numbers
    .slice(0, TITLES_AT_ONCE)
    .filter(number => Number.isInteger(number) && number > 0)
    .map(number => `n${number}: issueOrPullRequest(number: ${number}) { ... on PullRequest { title } ... on Issue { title } }`)
    .join(" ")
  return [
    "gh",
    "api",
    ...(host === "github.com" ? [] : ["--hostname", host]),
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
 * Reads `logTitlesArgv`'s answer, by number: a number GitHub answered with nothing (no such pull request or issue)
 * is "", so it is not asked again; a repository it did not answer for at all leaves every number out, to be asked again.
 */
export function parseLogTitles(answer: string): Map<number, string> {
  const repository = object(object(object(JSON.parse(answer)).data).repository)
  const titles = new Map<number, string>()
  for (const [alias, value] of Object.entries(repository)) {
    const number = Number(alias.slice(1))
    if (!alias.startsWith("n") || !Number.isInteger(number)) continue
    titles.set(number, text(object(value).title))
  }

  return titles
}
