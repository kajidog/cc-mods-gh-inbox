import { describe, expect, test } from "claude-code/testing"

import { MERGED_ID, newEvents, pullIds } from "../hooks/events"
import type { Pull } from "../hooks/github"
import {
  ACTIONS_PRIMED,
  canCompare,
  KINDS,
  type Kind,
  newRepoEvents,
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
const options = { nicknames: { "long-reviewer-name": "レビ", kajidog: "かじ" }, notifySelf: false }
const events = parseEvents(JSON.stringify(EVENTS))
const titles = parseTitles(JSON.stringify(TITLES))

/** The events with their pushes looked up, as a check leaves them: a new branch's has no compare. */
const lookedUp = events.map(event => (event.type === "push" ? { ...event, changes: canCompare(event) ? parseCompare(JSON.stringify(COMPARE)) : null } : event))

function inputWith(changes: Partial<RepoInput>): RepoInput {
  return { ref, label: "tts", kinds: KINDS, events: lookedUp, runs: [], titles, viewer: "me", watchedBranch: null, ...changes }
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

  test("a failed run is told with its job and step, not on the branch this session watches", async () => {
    const failure = parseJobs(JSON.stringify(JOBS))
    const runs: Run[] = parseRuns(JSON.stringify(RUNS)).map(run => ({ ...run, failure }))
    const input = inputWith({ kinds: ["ci-failure"], runs })
    expect(texts(input, [ACTIONS_PRIMED])).toEqual([
      "[tts] test / test (ubuntu-latest) の CI が失敗しました（main）。Run npm test",
      "[tts] test / test (ubuntu-latest) の CI が失敗しました（feat/foo）。Run npm test",
    ])
    expect(texts({ ...input, watchedBranch: "feat/foo" }, [ACTIONS_PRIMED])).toHaveLength(1)
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
        comments: [{ id: "PRRC_kwDOVDRCgM7_s8-h", path: "hooks/config.js", line: 1, hunk: "", body: "x", url: "" }],
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
