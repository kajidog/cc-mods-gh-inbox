export type GhEventKind = "comment" | "review" | "commit" | "ci" | "merge" | "close" | "branch" | "open" | "push"

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
  /** The id of what it came from: a comment, a review, a commit, a check run, a repository event. */
  id: string
  kind: GhEventKind
  /** `owner/repo#number`; `owner/repo` for a repository's event with no pull request (a push, a branch). */
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

/** The repository whose kinds the picker pane toggles. */
export type GhPicker = {
  /** `host/owner/repo`. */
  repo: string
  kinds: string[]
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

/** An open pull request `/inbox pick` lists to choose from. */
export type GhPickPull = {
  /** `host/owner/repo#number`. */
  key: string
  title: string
  author: string | null
}

/** One thing of a pull request the person can hand to Claude: a review, a thread of line comments, a comment. */
export type GhPickItem = {
  /** GitHub's node id. */
  id: string
  /** The line the pane shows. */
  label: string
  /** What the model reads for it. */
  context: string
  /** The review a thread came with: its item's id. Pressing the review chooses its threads too. */
  parent?: string
}

/** What the pick pane shows. */
export type GhPick =
  | { stage: "loading"; message: string }
  | { stage: "error"; message: string }
  | { stage: "pulls"; pulls: GhPickPull[] }
  | {
      stage: "items"
      /** `host/owner/repo#number`. */
      pull: string
      title: string
      url: string
      /** The head commit's short id when the list was fetched. */
      head: string
      items: GhPickItem[]
      /** What was left out of the list, said in a line each. */
      notes: string[]
      /** The ids chosen so far. */
      chosen: string[]
    }

/** What one pull request has staged for the next prompt. */
export type GhStaged = {
  /** `host/owner/repo#number`. */
  pull: string
  title: string
  url: string
  /** The head commit's short id when the items were fetched. */
  head: string
  items: GhPickItem[]
}

declare module "claude-code" {
  interface PluginState {
    "gh-inbox": {
      /** Recent notices, oldest first. */
      events: GhEvent[]
      watch: GhWatch | null
      /** The ids this session has seen, by `host/owner/repo#number`, and by `repo:host/owner/repo` for a registered repository. */
      seen: Record<string, string[]>
      picker: GhPicker | null
      pick: GhPick | null
      /** What the next prompt the person sends carries to the model. */
      staged: GhStaged[]
    }
  }
}
