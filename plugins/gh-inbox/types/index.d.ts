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
  /**
   * What the line starts with in brackets, before its head: the registered repository's short name, or for a pull
   * request `/inbox watch` chose, that name and its number (`tts#20`).
   */
  label?: string
}

/** The repository whose kinds the picker pane toggles. */
export type GhPicker = {
  /** `host/owner/repo`. */
  repo: string
  kinds: string[]
}

/** Someone whose review a pull request has or waits for: a person by the name the mod shows, a team by `org/team`. */
export type GhReviewer = { name: string; isTeam: boolean }

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
  /** Who approves, by their last say; absent before it was asked for. */
  approvedBy?: GhReviewer[]
  /** Who asks for changes, by their last say; absent before it was asked for. */
  changesRequestedBy?: GhReviewer[]
  /** Those whose review is asked for and not given yet, people and teams; absent before it was asked for. */
  awaiting?: GhReviewer[]
  /** `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED`; null where the base asks for no review. */
  reviewDecision: string | null
  /** `CONFLICTING` when it does not merge into its base cleanly; `UNKNOWN` while GitHub works it out. */
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  /**
   * What GitHub says of merging it now, branch protection and all (`CLEAN`, `HAS_HOOKS`, `UNSTABLE`, `BLOCKED`,
   * `BEHIND`, `DIRTY`, `DRAFT`, `UNKNOWN`); null or absent where it said nothing.
   */
  mergeState?: string | null
  /** Whether it is a draft; absent before it was asked for. */
  isDraft?: boolean
  /** Whether auto-merge is turned on for it; absent before it was asked for. */
  autoMerge?: boolean
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

/** One of the open pull requests the band above the prompt shows: one the person opened, or one asked of them to review. */
export type GhMinePull = {
  /** `host/owner/repo#number`. */
  key: string
  /** Its repository's short name (a registered one's alias, else its name) and its number: `tts#20`. */
  label: string
  title: string
  url: string
  /** When it was updated last, ISO. */
  updatedAt: string
  /** Who opened it, by the name the mod shows; absent where GitHub names no one. */
  author?: string
  status: GhPullStatus
}

/** One group of the band above the prompt: those found, in the order it shows them, and how many more there are. */
export type GhMineGroup = {
  pulls: GhMinePull[]
  /** How many more are open than were found. */
  more: number
}

/** The open pull requests the band above the prompt shows, as the last check found them. */
export type GhMine = {
  /** Those the person opened, the most pressing first. */
  opened: GhMineGroup
  /** Those asked of the person to review, updated last first. */
  requested: GhMineGroup
  /** When the last check that searched finished, ms since the epoch. */
  checkedAt: number
}

/** What the pane of `/inbox watch` shows: pull requests to start or stop watching. */
export type GhWatchPick =
  | { stage: "loading"; message: string }
  | { stage: "error"; message: string }
  | {
      stage: "pulls"
      /** Those found open, then those watched that were not found. */
      pulls: GhPickPull[]
      /** The hosts that could not be searched and what was left out, said in a line each. */
      notes: string[]
      /** The `host/owner/repo#number` of those watched. */
      chosen: string[]
      /** Why the last one pressed could not be watched; absent where it could. */
      refusal?: string
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
  /** GitHub's node id; for the head commit's CI, `ci:` and how it stood (its commit, what failed). */
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
      /** When the list was asked for, ms since the epoch. */
      at?: number
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
  /** When the items were asked for, ms since the epoch. */
  at?: number
}

/**
 * What `/inbox merge`, `/inbox close`, `/inbox draft`, `/inbox approve` and `/inbox unapprove` do to a pull request
 * once the person confirms it.
 */
export type GhActKind = "merge" | "auto" | "disable-auto" | "close" | "ready" | "draft" | "approve" | "unapprove"

/**
 * What the pane of `/inbox merge`, `/inbox close`, `/inbox draft`, `/inbox approve` and `/inbox unapprove` shows: what
 * is about to be done, to confirm.
 */
export type GhAct = {
  /** confirm: waiting for the person. running: under way. failed: GitHub refused it, `message` saying why. */
  stage: "confirm" | "running" | "failed"
  kind: GhActKind
  /** `host/owner/repo#number`. */
  pull: string
  title: string
  url: string
  /** The head commit it was confirmed at, in full: a merge goes only while it is still the head; an approval approves it. */
  head: string
  /** Where it stands, as the line under the prompt tells it. */
  status: string
  /** What to know before going on, a line each. */
  notes: string[]
  /** For a merge: the methods the repository allows (`MERGE`, `SQUASH`, `REBASE`) and the one chosen. */
  methods: string[]
  method: string | null
  /** For a withdrawn approval: the node id of the person's approving review, which is dismissed. */
  review?: string
  /** Why GitHub refused it, once it did. */
  message?: string
}

/** A row the `row` channel placed in the transcript (`$.ui.place`), and what it draws. */
export type GhPlaced = {
  /** The row's id, as `$.ui.place` was given it. */
  id: string
  /** The line, as it showed. */
  text: string
  /** Where what was done links to; empty for none. */
  url: string
  /** What the notice was made with, as the log draws it by; absent for the line counting notices not shown one by one. */
  made?: { who?: string; head?: string; label?: string; kind?: string }
}

/** One notice about to be shown, as `$.inbox.notify` takes it. */
export type InboxNotice = {
  event: GhEvent
  /** pull: the checked-out branch's pull request. watch: a pull request `/inbox watch` chose. repo: a registered repository. */
  source: "pull" | "watch" | "repo"
  /** `host/owner/repo`. */
  repo: string
  /**
   * What leads `text` in brackets: the registered repository's alias or its name, with the number of a pull
   * request `/inbox watch` chose (`tts#20`); null for the branch's pull request.
   */
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
      /** The page the log pane shows, 0 the newest. */
      logPage: number
      /** The log pane's rows unfolded to say in full what they said, by `pull|id`. */
      logUnfolded: string[]
      /** The repository (`owner/repo`) the log pane is narrowed to; null for all. */
      logRepo: string | null
      /** What the log pane's comments say now, by `host|node id`, asked for as their page shows. */
      logLatest: Record<
        string,
        | { state: "deleted" }
        | {
            state: "found"
            body: string
            editedAt: string | null
            comments?: Array<{ url: string; body: string; editedAt: string | null }>
            isComplete?: boolean
          }
      >
      /**
       * The titles of the pull requests and issues the log pane narrowed to one repository heads its notices with, by
       * `host/owner/repo#number`; "" for a number GitHub knows nothing of.
       */
      logTitles: Record<string, string>
      /**
       * Where each pull request the log pane narrowed to one repository heads its notices with stands now, as its heading
       * says it after the title, by `host/owner/repo#number`.
       */
      logStands: Record<string, string>
      /** The pick pane's items unfolded to say in full what they say, by id. */
      pickUnfolded: string[]
      /** What the pane of `/inbox watch` shows. */
      watchPick: GhWatchPick | null
      /**
       * The open pull requests the band above the prompt shows (those the person opened, those asked of them to review);
       * null while none were searched for.
       */
      mine: GhMine | null
      /** When each watched pull request (`host/owner/repo#number`) was added, as this session last checked it. */
      watchedSince: Record<string, number>
      /** How CI of the branch's pull request stood when Claude was last told of it in this session (`ciKey`); null before. */
      ciTold: string | null
      /** When what Claude was last told of CI was asked of GitHub, ms since the epoch; 0 before. */
      ciToldAt: number
      /** The rows the `row` channel placed in the transcript, oldest first, the newest kept. */
      placed: GhPlaced[]
      /** What the pane of `/inbox merge`, `/inbox close`, `/inbox draft`, `/inbox approve` and `/inbox unapprove` shows. */
      act: GhAct | null
    }
  }
}
