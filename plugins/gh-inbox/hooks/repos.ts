// The registered repositories and what is kept for them in the shared store.
// Every session reads the same registration, answers and titles.

import { isKind, type Kind, type RepoEvent, type RepoRef, type Run, type Title, type Titles } from "./repo-events"

/** `{ "host/owner/repo": RepoEntry }`. */
export const REPOS_KEY = "repos"
/** `repo-cache:host/owner/repo`: the last answers, shared with their ETags. */
export const REPO_CACHE_PREFIX = "repo-cache:"
/** `titles:host/owner/repo`: pull request titles, so each is asked for once. */
export const TITLES_PREFIX = "titles:"
export const TITLES_KEPT = 500
export const DEFAULT_POLL_SECONDS = 60

export type RepoEntry = {
  kinds: Kind[]
  alias?: string
  /** GitHub's id of the repository, which a rename keeps. */
  id?: number
}
export type Repos = Record<string, RepoEntry>

export type RepoCache = {
  at: number
  etag: string | null
  /** GitHub's `X-Poll-Interval`: the repository is not asked again sooner. */
  poll: number
  events: RepoEvent[]
  runsEtag: string | null
  runs: Run[]
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

export function toRepos(value: unknown): Repos {
  if (!isObject(value)) return {}
  const repos: Repos = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isObject(entry) || !Array.isArray(entry.kinds)) continue
    const kinds = entry.kinds.filter((kind): kind is Kind => typeof kind === "string" && isKind(kind))
    repos[key] = {
      kinds,
      ...(typeof entry.alias === "string" && entry.alias !== "" ? { alias: entry.alias } : {}),
      ...(typeof entry.id === "number" ? { id: entry.id } : {}),
    }
  }

  return repos
}

/** The `RepoRef` of a `host/owner/repo` key. */
export function refOfKey(key: string): RepoRef {
  const [host = "", owner = "", repo = ""] = key.split("/")
  return { host, owner, repo }
}

/** What a repository's notices start with: its alias, or its name without the owner. */
export const repoLabel = (key: string, entry: RepoEntry) => entry.alias ?? refOfKey(key).repo

export function toRepoCache(value: unknown): RepoCache | undefined {
  if (!isObject(value) || typeof value.at !== "number" || !Array.isArray(value.events) || !Array.isArray(value.runs)) return undefined
  return {
    at: value.at,
    etag: typeof value.etag === "string" ? value.etag : null,
    poll: typeof value.poll === "number" ? value.poll : DEFAULT_POLL_SECONDS,
    events: value.events as RepoEvent[],
    runsEtag: typeof value.runsEtag === "string" ? value.runsEtag : null,
    runs: value.runs as Run[],
  }
}

/** `next` with what was looked up for `previous` kept: the commits of a push, the failed step of a run. */
export function carryOver(previous: RepoCache | undefined, next: { events: RepoEvent[]; runs: Run[] }) {
  const changes = new Map(previous?.events.flatMap(event => (event.type === "push" && event.changes !== undefined ? [[event.id, event.changes]] : [])))
  const failures = new Map(previous?.runs.flatMap(run => (run.failure !== undefined ? [[run.id, run.failure]] : [])))
  return {
    events: next.events.map(event => {
      const found = event.type === "push" ? changes.get(event.id) : undefined
      return found === undefined ? event : { ...event, changes: found }
    }),
    runs: next.runs.map(run => {
      const found = failures.get(run.id)
      return found === undefined ? run : { ...run, failure: found }
    }),
  }
}

export function toTitles(value: unknown): Titles {
  if (!isObject(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Title] => isObject(entry[1]) && typeof entry[1].title === "string"),
  )
}

/** `held` with `fresh` added, the `TITLES_KEPT` highest numbers kept (an object lists number keys in order). */
export function addTitles(held: Titles, fresh: Titles): Titles {
  return Object.fromEntries(Object.entries({ ...held, ...fresh }).slice(-TITLES_KEPT))
}
