import { describe, expect, test } from "claude-code/testing"

import { MERGED_ID, newEvents, pullIds } from "../hooks/events"
import type { Pull } from "../hooks/github"
import {
  ACTIONS_PRIMED,
  canCompare,
  isAnswerOf,
  KINDS,
  type Kind,
  newRepoEvents,
  numbersNotFound,
  parseCompare,
  parseEvents,
  parseJobs,
  parseKinds,
  parseRepo,
  parseResponse,
  parseRuns,
  parseTitles,
  pendingEvents,
  type RepoEvent,
  type RepoInput,
  type Run,
  repoIds,
  repoSeenKey,
  seenForPull,
  seenForRepo,
} from "../hooks/repo-events"
import { addTitles, carryOver, toRepos } from "../hooks/repos"
import { COMPARE, EVENTS, JOBS, RUNS, TITLES } from "./fixtures/repo-answers"

const ref = { host: "github.com", owner: "kajidog", repo: "cc-mods-tts" }
const options = { nicknames: { "long-reviewer-name": "レビ", kajidog: "かじ" }, notifySelf: false, language: "ja" } as const
const events = parseEvents(JSON.stringify(EVENTS))
const titles = parseTitles(JSON.stringify(TITLES))

/** The events with their pushes looked up, as a check leaves them: a new branch's has no compare. */
const lookedUp = events.map(event => (event.type === "push" ? { ...event, changes: canCompare(event) ? parseCompare(JSON.stringify(COMPARE)) : null } : event))

function inputWith(changes: Partial<RepoInput>): RepoInput {
  return { ref, label: "tts", kinds: KINDS, events: lookedUp, runs: [], titles, viewer: "me", watchedHead: null, ...changes }
}
const texts = (input: RepoInput, seen: Iterable<string> = []) => newRepoEvents(input, new Set(seen), options).map(event => event.text)

describe("newRepoEvents", () => {
  test("every kind is told, oldest first, after the repository's short name", async () => {
    expect(texts(inputWith({}))).toEqual([
      "[tts] chatgpt-codex-connector[bot]さんが #18 にコメントしました。Codex Review: Didn't find any major issues.",
      "[tts] reviewerさんが #18 にコメントしました。hooks/config.js ローカルの型チェックで出力された .js が誤ってコミットに入っていました。",
      "[tts] かじさんが main に push しました。feat: 要約だけ読む設定を既定でオフにする (#18) (+15 −10)",
      "[tts] github-actions[bot]さんがブランチを作りました。changeset-release/main",
      "[tts] github-actions[bot]さんが PR を作りました。#19 Version Packages",
      "[tts] #19 がマージされました。Version Packages",
      "[tts] レビさんが #18 を承認しました。feat: 要約だけ読む設定を既定でオフにする",
      "[tts] #17 がクローズされました。WIP: try another engine",
      "[tts] レビさんが Issue #4 にコメントしました。Same here",
      "[tts] newbieさんが feat/new に push しました。abcdef1",
    ])
  })

  test("merged and closed are told apart", async () => {
    const pulls = events.filter(event => event.type === "pull")
    expect(pulls.map(event => event.id)).toEqual(["opened:#19", "merged:#19", "closed:#17"])
  })

  test("a comment says whether it is on a pull request or an issue", async () => {
    const comments = newRepoEvents(inputWith({ kinds: ["comment"] }), new Set(), options)
    expect(comments.map(event => event.pull)).toEqual(["kajidog/cc-mods-tts#18", "kajidog/cc-mods-tts#4"])
    expect(comments.map(event => event.text.includes("Issue"))).toEqual([false, true])
  })

  test("kinds not chosen and my own activity are left out; my merge is not", async () => {
    const mine = inputWith({ kinds: ["pr-merge", "pr-close", "push"], viewer: "kajidog" })
    expect(texts(mine)).toEqual(["[tts] #19 がマージされました。Version Packages", "[tts] newbieさんが feat/new に push しました。abcdef1"])
    expect(newRepoEvents(mine, new Set(), { ...options, notifySelf: true })).toHaveLength(4)
  })

  test("the first look notifies nothing; what it saw is not told again", async () => {
    const input = inputWith({})
    expect(newRepoEvents(input, undefined, options)).toEqual([])
    expect(texts(input, repoIds(input.events, input.runs, false))).toEqual([])
  })

  test("a review with line comments carries them, told once", async () => {
    const review: RepoEvent = { ...(events.find(event => event.id === "PRR_kwDOVDRCgM8AAAABSlMH-Q") as RepoEvent & { type: "review" }), body: "Two notes" }
    const input = inputWith({ events: [review, ...events.filter(event => event.type === "review-comment")], kinds: ["review", "review-comment"] })
    const [told, ...rest] = newRepoEvents(input, new Set(), options)
    expect(rest).toEqual([])
    expect(told?.text).toBe("[tts] reviewerさんが #18 をレビューしました。Two notes")
    expect(told?.items.map(item => item.path ?? null)).toEqual([null, "hooks/config.js"])
  })

  test("pushes not looked up are counted in one line", async () => {
    const pushes: RepoEvent[] = [1, 2, 3].map(at => ({ id: `event:${at}`, type: "push", actor: "a", at: `2026-01-0${at}T00:00:00Z`, branch: "main", before: "b", head: `h${at}` }))
    expect(texts(inputWith({ events: pushes }))).toEqual(["[tts] ほか3件の push がありました。"])
  })

  test("a push whose commits were all told already says nothing", async () => {
    expect(texts(inputWith({ kinds: ["push"] }), [COMPARE.commits[0]?.sha ?? "", "abcdef1234567890"])).toEqual([])
  })

  test("a failed run is told with its job and step, not on the commit this session watches", async () => {
    const failure = parseJobs(JSON.stringify(JOBS))
    const runs: Run[] = parseRuns(JSON.stringify(RUNS)).map(run => ({ ...run, failure }))
    const input = inputWith({ kinds: ["ci-failure"], runs })
    expect(texts(input, [ACTIONS_PRIMED])).toEqual([
      "[tts] test / test (ubuntu-latest) の CI が失敗しました（main）。Run npm test",
      "[tts] test / test (ubuntu-latest) の CI が失敗しました（feat/foo）。Run npm test",
    ])
    expect(texts({ ...input, watchedHead: "f00" }, [ACTIONS_PRIMED])).toEqual(["[tts] test / test (ubuntu-latest) の CI が失敗しました（main）。Run npm test"])
    // Until the runs there are taken as seen, none is told.
    expect(texts(input)).toEqual([])
    expect(runs.map(run => run.id)).toEqual(["actions:39000000001:1", "actions:39000000002:2"])
  })

  test("pendingEvents is what the lookups are for", async () => {
    const pending = pendingEvents({ kinds: ["push", "pr-open"] as Kind[], events, viewer: "kajidog" }, new Set(), false)
    expect(pending.map(event => event.id)).toEqual(["opened:#19", "event:110"])
  })
})

describe("one notice for what the pull request and the repository both see", () => {
  const pull: Pull = {
    ref: { ...ref, number: 18 },
    viewer: "me",
    title: "T",
    url: "",
    state: "MERGED",
    mergedBy: "kajidog",
    closedBy: null,
    closedAt: "2026-10-16T02:49:46Z",
    comments: [{ id: "IC_kwDOVDRCgM8AAAABcdCdCg", author: "bot", body: "hi", at: "2026-10-15T23:31:53Z", url: "" }],
    reviews: [
      { id: "PRR_approve", author: "long-reviewer-name", state: "APPROVED", body: "", at: "", url: "", comments: [] },
      {
        id: "PRR_kwDOVDRCgM8AAAABSlMH-Q",
        author: "reviewer",
        state: "COMMENTED",
        body: "",
        at: "",
        url: "",
        comments: [{ id: "PRRC_kwDOVDRCgM7_s8-h", author: "kajidog", at: "", path: "hooks/config.js", line: 1, hunk: "", body: "x", url: "" }],
      },
    ],
    commits: [],
    checks: [],
  }
  const merged: RepoEvent = { id: "merged:#18", type: "pull", action: "merged", number: 18, actor: "kajidog", at: "" }

  test("told by the pull request first, the repository says nothing more", async () => {
    const seenByKey = { "github.com/kajidog/cc-mods-tts#18": pullIds(pull), [repoSeenKey(ref)]: [] }
    expect(texts(inputWith({ events: [...events, merged] }), seenForRepo(seenByKey, ref)).filter(line => line.includes("#18"))).toEqual([])
  })

  test("told by the repository first, the pull request says nothing more", async () => {
    const seenByKey = { "github.com/kajidog/cc-mods-tts#18": [], [repoSeenKey(ref)]: repoIds([...events, merged], [], false) }
    expect(newEvents(pull, seenForPull(seenByKey, pull.ref), options)).toEqual([])
    expect(seenForPull(seenByKey, pull.ref)?.has(MERGED_ID)).toBe(true)
  })

  test("a session's first look at either stays a first look", async () => {
    expect(seenForRepo({ "github.com/kajidog/cc-mods-tts#18": [] }, ref)).toBeUndefined()
    expect(seenForPull({ [repoSeenKey(ref)]: [] }, pull.ref)).toBeUndefined()
  })
})

test("parseResponse reads gh api -i, a 304 included", async () => {
  const ok = parseResponse('HTTP/2.0 200 OK\r\nEtag: W/"abc"\r\nX-Poll-Interval: 60\r\n\r\n[{"id":"1"}]')
  expect(ok).toEqual({ status: 200, headers: { etag: 'W/"abc"', "x-poll-interval": "60" }, body: '[{"id":"1"}]' })
  const unchanged = parseResponse('HTTP/2.0 304 Not Modified\nEtag: "abc"\n\n')
  expect(unchanged.status).toBe(304)
  expect(unchanged.body).toBe("")
})

test("parseRepo reads a name, a host and a URL", async () => {
  expect(parseRepo("kajidog/cc-mods-tts")).toEqual(ref)
  expect(parseRepo("https://github.com/kajidog/cc-mods-tts.git")).toEqual(ref)
  expect(parseRepo("ghe.example/o/r")).toEqual({ host: "ghe.example", owner: "o", repo: "r" })
  expect(parseRepo("GitHub.com/o/r")).toEqual({ host: "github.com", owner: "o", repo: "r" })
  expect(parseRepo("nope")).toBeNull()
})

test("parseKinds keeps the order of KINDS and names the unknown words", async () => {
  expect(parseKinds("push, comment,branch")).toEqual({ kinds: ["branch", "comment", "push"], unknown: [] })
  expect(parseKinds("comment,issues").unknown).toEqual(["issues"])
})

test("parseTitles leaves out a number that is not a pull request", async () => {
  expect(Object.keys(titles).sort()).toEqual(["17", "18", "19"])
  expect(Object.keys(addTitles({ "1": { title: "a", author: null } }, titles))).toEqual(["1", "17", "18", "19"])
})

test("carryOver keeps what was looked up across a new answer", async () => {
  const previous = { at: 0, etag: null, poll: 60, events: lookedUp, runsEtag: null, runs: [] }
  const kept = carryOver(previous, { events, runs: [] })
  expect(kept.events.find(event => event.type === "push" && event.branch === "main")).toMatchObject({ changes: { additions: 15 } })
})

test("toRepos drops what is not a kind", async () => {
  expect(toRepos({ "github.com/o/r": { kinds: ["comment", "issues"], alias: "r" }, bad: 1 })).toEqual({ "github.com/o/r": { kinds: ["comment"], alias: "r" } })
})

test("parseRuns keeps the runs that failed or timed out", async () => {
  const run = (id: number, conclusion: string) => ({ id, name: "test", head_branch: "main", html_url: "", updated_at: "", run_attempt: 1, conclusion })
  const body = JSON.stringify({ workflow_runs: [run(3, "success"), run(2, "timed_out"), run(1, "failure")] })
  expect(parseRuns(body).map(one => one.runId)).toEqual([1, 2])
})

test("a merge GitHub Enterprise Server tells as closed is a merge", async () => {
  const closed = (number: number, merged: boolean) => ({
    id: String(number),
    type: "PullRequestEvent",
    actor: { login: "a" },
    created_at: "",
    payload: { action: "closed", number, pull_request: { number, merged } },
  })
  expect(parseEvents(JSON.stringify([closed(2, true), closed(1, false)])).map(event => event.id)).toEqual(["closed:#1", "merged:#2"])
})

test("numbersNotFound names the numbers with no pull request, not a failure for now", async () => {
  expect(numbersNotFound(JSON.stringify(TITLES))).toEqual([4])
  expect(numbersNotFound(JSON.stringify({ errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }))).toEqual([])
})

test("an edited review is not a new one", async () => {
  const review = (id: string, action: string) => ({
    id,
    type: "PullRequestReviewEvent",
    actor: { login: "a" },
    created_at: "",
    payload: { action, review: { id: 1, node_id: "PRR_1", state: "approved", body: null, html_url: "" }, pull_request: { number: 1 } },
  })
  expect(parseEvents(JSON.stringify([review("2", "updated"), review("1", "created")])).map(event => event.id)).toEqual(["PRR_1"])
})

test("a branch with # in its name links to the branch, not a fragment", async () => {
  const branch: RepoEvent = { id: "event:1", type: "branch", ref: "release/#123", actor: "a", at: "" }
  const [event] = newRepoEvents(inputWith({ kinds: ["branch"], events: [branch] }), new Set(), options)
  expect(event?.url).toBe("https://github.com/kajidog/cc-mods-tts/tree/release/%23123")
})

test("isAnswerOf tells an answer about another repository", async () => {
  expect(isAnswerOf(JSON.stringify([{ repo: { id: 1 } }]), 1)).toBe(true)
  expect(isAnswerOf(JSON.stringify([{ repo: { id: 2 } }]), 1)).toBe(false)
  expect(isAnswerOf(JSON.stringify({ workflow_runs: [{ repository: { id: 2 } }] }), 1)).toBe(false)
  expect(isAnswerOf(JSON.stringify(EVENTS), 1)).toBe(true)
})

describe("newRepoEvents in English, the default", () => {
  test("every kind is told after the repository's short name", async () => {
    const english = { nicknames: { kajidog: "kaji" }, notifySelf: false }
    expect(newRepoEvents(inputWith({}), new Set(), english).map(event => event.text)).toEqual([
      "[tts] chatgpt-codex-connector[bot] commented on #18: Codex Review: Didn't find any major issues.",
      "[tts] reviewer commented on #18: hooks/config.js ローカルの型チェックで出力された .js が誤ってコミットに入っていました。",
      "[tts] kaji pushed to main: feat: 要約だけ読む設定を既定でオフにする (#18) (+15 −10)",
      "[tts] github-actions[bot] created a branch: changeset-release/main",
      "[tts] github-actions[bot] opened a PR: #19 Version Packages",
      "[tts] #19 was merged: Version Packages",
      "[tts] long-reviewer-name approved #18: feat: 要約だけ読む設定を既定でオフにする",
      "[tts] #17 was closed: WIP: try another engine",
      "[tts] long-reviewer-name commented on issue #4: Same here",
      "[tts] newbie pushed to feat/new: abcdef1",
    ])
  })
})
