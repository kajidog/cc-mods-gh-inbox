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
  /** Who did it as the line names them (a nickname, `さん` in Japanese), where the line starts with them. */
  who?: string
  /** What the line starts with before what a person wrote (a comment, a title): who did it and what. */
  head?: string
  /** The short name of the registered repository the line starts with, in brackets, before its head. */
  label?: string
}

/** The repository whose kinds the picker pane toggles. */
export type GhPicker = {
  /** `host/owner/repo`. */
  repo: string
  kinds: string[]
}

/** Where the watched pull request stands, as the line under the prompt tells it. */
export type GhPullStatus = {
  /** The newest commit's checks; null with none. */
  ci: {
    /** GitHub's rollup of them: `SUCCESS`, `FAILURE`, `PENDING`, `ERROR`, `EXPECTED`; null where it gave none. */
    state: string | null
    total: number
    failed: number
    pending: number
  } | null
  /** Reviewers whose last say approves. */
  approvals: number
  /** Reviewers whose last say asks for changes. */
  changesRequested: number
  /** `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED`; null where the base asks for no review. */
  reviewDecision: string | null
  /** `CONFLICTING` when it does not merge into its base cleanly; `UNKNOWN` while GitHub works it out. */
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  /** The newest comment, review or line comment with words in it. */
  latest: { author: string | null; name: string; body: string; at: string; url: string } | null
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
  /** Where the pull request stood at the last check that read it; null or absent with none. */
  status?: GhPullStatus | null
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
  | {
      stage: "pulls"
      pulls: GhPickPull[]
      /** The hosts that could not be searched, said in a line each. */
      notes: string[]
    }
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
  /** The language the items were written in, so what goes with them is in it too: `en` or `ja`. */
  language?: string
}

/** One notice about to be shown, as `$.inbox.notify` takes it. */
export type InboxNotice = {
  event: GhEvent
  /** pull: the checked-out branch's pull request. repo: a registered repository. */
  source: "pull" | "repo"
  /** `host/owner/repo`. */
  repo: string
  /** The registered repository's label, its alias or its name, that leads `text` in brackets; null for the branch's pull request. */
  label: string | null
  /** Whether the account `gh` is logged in as did it. */
  isSelf: boolean
  /** The line shown, as plain text. */
  text: string
}

/**
 * `$.inbox`, for another mod to act on the notices. Every notice of a check passes `notify` one by
 * one, in the one session that shows it (the one touched last), whatever the channel; `/inbox log`
 * lists it either way.
 */
export type Inbox = {
  /**
   * Before a notice shows. A hook on `inbox.notify` may rewrite the notice (its `text`) with `next`,
   * or keep it from showing with `{ deny }`. Resolves to the notice as the hooks let it through;
   * rejects when one refused it.
   */
  notify: (notice: InboxNotice) => Promise<InboxNotice>
  /**
   * Once every hook on `inbox.notify` has answered: each notice none refused, as it shows, the ones
   * counted in the "N more updates" line too. A hook on `inbox.notified` acts on what the person sees
   * (reads it aloud, sends it elsewhere); its answer changes nothing.
   */
  notified: (notice: InboxNotice) => Promise<void>
}

declare module "claude-code" {
  interface EngineInterface {
    inbox: Inbox
  }

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
