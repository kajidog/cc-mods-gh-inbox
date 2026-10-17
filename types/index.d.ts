export type GhEventKind = "comment" | "review" | "commit" | "ci" | "merge" | "close"

/** One part of an event a later request to the model may quote: a comment, an inline comment, a commit. */
export type GhEventItem = {
  body: string
  path?: string
  line?: number | null
  hunk?: string
  url?: string
}

/** One notice, kept with what it was made from. */
export type GhEvent = {
  /** The id of what it came from: a comment, a review, a commit, a check run. */
  id: string
  kind: GhEventKind
  /** `owner/repo#number`. */
  pull: string
  /** The GitHub login, or null where none applies (a CI run). */
  author: string | null
  /** ISO time it happened. */
  at: string
  /** The line shown. */
  text: string
  url: string
  items: GhEventItem[]
}

/** The pull request being watched, or why none is. */
export type GhWatch = {
  branch: string | null
  /** `owner/repo#number`; null when the branch has none. */
  pull: string | null
  title: string | null
  url: string | null
  state: "OPEN" | "CLOSED" | "MERGED" | null
  /** When the last check finished, ms since the epoch. */
  checkedAt: number | null
  /** The last check's error, one line. */
  error: string | null
}

declare module "claude-code" {
  interface PluginState {
    "gh-inbox": {
      /** Recent notices, oldest first. */
      events: GhEvent[]
      watch: GhWatch | null
      /** The ids this session has seen, by `host/owner/repo#number`. */
      seen: Record<string, string[]>
    }
  }
}
