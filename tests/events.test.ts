import { describe, expect, test } from "claude-code/testing"

import { MERGED_ID, mergeSeen, newEvents, plain, pullIds, SEEN_LIMIT, snippet } from "../hooks/events"
import { type Pull, parsePull, parsePullUrl, pullArgv } from "../hooks/github"

const ref = { host: "github.com", owner: "o", repo: "r", number: 7 }

function pullWith(changes: Partial<Pull>): Pull {
  return {
    ref,
    viewer: "me",
    title: "Add things",
    url: "https://github.com/o/r/pull/7",
    state: "OPEN",
    mergedBy: null,
    closedAt: null,
    comments: [],
    reviews: [],
    commits: [],
    checks: [],
    ...changes,
  }
}

const options = { nicknames: { "long-reviewer-name": "レビ" }, notifySelf: false }
const texts = (pull: Pull, seen: string[] = []) => newEvents(pull, new Set(seen), options).map(event => event.text)

describe("newEvents", () => {
  test("the first look at a pull request notifies nothing", async () => {
    const pull = pullWith({ comments: [{ id: "c1", author: "a", body: "hi", at: "2026-01-01T00:00:00Z", url: "" }] })
    expect(newEvents(pull, undefined, options)).toEqual([])
    expect(pullIds(pull)).toEqual(["c1"])
  })

  test("a new comment names its author by nickname", async () => {
    const pull = pullWith({
      comments: [
        { id: "c1", author: "long-reviewer-name", body: "<!-- x -->\n## **Looks** good\nmore", at: "2026-01-01T00:00:00Z", url: "" },
      ],
    })
    expect(texts(pull)).toEqual(["レビさんがコメントしました。Looks good"])
  })

  test("my own activity is left out unless asked for", async () => {
    const pull = pullWith({ comments: [{ id: "c1", author: "me", body: "note", at: "2026-01-01T00:00:00Z", url: "" }] })
    expect(texts(pull)).toEqual([])
    expect(newEvents(pull, new Set(), { ...options, notifySelf: true })).toHaveLength(1)
  })

  test("commits of one author join, titles listed and line counts last", async () => {
    const commit = (oid: string, title: string) => ({ oid, author: "a", title, additions: 2, deletions: 1, at: `2026-01-01T00:00:0${oid}Z`, url: "" })
    const pull = pullWith({ commits: [commit("1", "old"), commit("2", "fix: one"), commit("3", "feat: two")] })
    expect(texts(pull, ["1"])).toEqual(["aさんがコミットしました。fix: one / feat: two (+4 −2)"])
  })

  test("reviews say what kind they are", async () => {
    const inline = { id: "rc", author: "reviewer", at: "", path: "src/a.ts", line: 12, hunk: "@@", body: "Why **this**?", url: "" }
    const review = (id: string, state: string, body: string, comments = [inline]) => ({ id, author: "b", state, body, at: `2026-01-01T00:00:0${id}Z`, url: "", comments })
    const pull = pullWith({
      reviews: [review("1", "APPROVED", "LGTM", []), review("2", "CHANGES_REQUESTED", "Please fix"), review("3", "COMMENTED", ""), review("4", "PENDING", "")],
    })
    expect(texts(pull)).toEqual([
      "bさんが承認しました。LGTM",
      "bさんが変更を依頼しました。指摘1件 Please fix",
      "bさんがコメントしました。src/a.ts:12 Why this?",
    ])
    const [, requested] = newEvents(pull, new Set(), options)
    expect(requested?.items.map(item => item.path ?? null)).toEqual([null, "src/a.ts"])
  })

  test("a reply that joins a review told already is told on its own", async () => {
    const comment = (id: string, author: string) => ({ id, author, at: "2026-01-01T00:00:09Z", path: "src/a.ts", line: 3, hunk: "", body: "Agreed", url: "" })
    const review = { id: "r", author: "b", state: "COMMENTED", body: "Look", at: "2026-01-01T00:00:00Z", url: "", comments: [comment("c1", "b")] }
    const replied = pullWith({ reviews: [{ ...review, comments: [comment("c1", "b"), comment("c2", "c"), comment("c3", "me")] }] })
    expect(texts(replied, ["r", "c1"])).toEqual(["cさんがコメントしました。src/a.ts:3 Agreed"])
  })

  test("a failed check is notified once, with its failed step", async () => {
    const pull = pullWith({
      checks: [
        { id: "run:1", name: "CI / test", isFailed: true, failedStep: "Run npm test", url: "" },
        { id: "run:2", name: "CI / lint", isFailed: false, failedStep: null, url: "" },
      ],
    })
    expect(texts(pull)).toEqual(["CI / testのCIが失敗しました。Run npm test"])
    expect(texts(pull, pullIds(pull))).toEqual([])
  })

  test("a merge is notified once", async () => {
    const pull = pullWith({ state: "MERGED", mergedBy: "me", closedAt: "2026-01-02T00:00:00Z" })
    expect(texts(pull)).toEqual(["#7 がマージされました。"])
    expect(texts(pull, [MERGED_ID])).toEqual([])
  })
})

test("snippet cuts long lines", async () => {
  expect(snippet("a".repeat(100), 10)).toBe(`${"a".repeat(9)}…`)
  expect(snippet("```\ncode\n```\n> quoted [link](http://x)")).toBe("quoted link")
})

test("plain drops control characters and bidirectional overrides", async () => {
  expect(plain("ok\u001b]0;title\u0007 \u202eevil\u001b[2J")).toBe("ok]0;title evil[2J")
})

test("mergeSeen keeps each id once, newest last", async () => {
  expect(mergeSeen(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"])
})

test("mergeSeen keeps every id GitHub lists now, past the limit", async () => {
  const ids = Array.from({ length: SEEN_LIMIT + 10 }, (_, index) => `id${index}`)
  expect(mergeSeen(["old"], ids)).toEqual(ids)
})

test("parsePullUrl and pullArgv name another host", async () => {
  const found = parsePullUrl("https://ghe.example/o/r/pull/3")
  expect(found).toEqual({ host: "ghe.example", owner: "o", repo: "r", number: 3 })
  expect(found && pullArgv(found).slice(0, 4)).toEqual(["gh", "api", "--hostname", "ghe.example"])
})

test("pullArgv sends the names as strings, so a repository named 2048 is not a number", async () => {
  const argv = pullArgv({ host: "github.com", owner: "o", repo: "2048", number: 3 })
  expect(argv[argv.indexOf("repo=2048") - 1]).toBe("-f")
  expect(argv[argv.indexOf("number=3") - 1]).toBe("-F")
})

test("parsePull reads checks of the newest commit", async () => {
  const answer = {
    data: {
      viewer: { login: "me" },
      repository: {
        pullRequest: {
          title: "T",
          url: "u",
          state: "OPEN",
          closedAt: null,
          mergedBy: null,
          comments: { nodes: [] },
          reviews: { nodes: [] },
          commits: { nodes: [{ commit: { oid: "x", messageHeadline: "m", additions: 1, deletions: 0, committedDate: "d", url: "", author: { name: "N", user: null } } }] },
          latest: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: {
                      nodes: [
                        {
                          __typename: "CheckRun",
                          databaseId: 5,
                          name: "test",
                          conclusion: "FAILURE",
                          detailsUrl: "",
                          checkSuite: { workflowRun: { workflow: { name: "CI" } } },
                          steps: { nodes: [{ name: "setup", conclusion: "SUCCESS" }, { name: "Run tests", conclusion: "FAILURE" }] },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  }
  const pull = parsePull(ref, JSON.stringify(answer))
  expect(pull.commits[0]?.author).toBe("N")
  expect(pull.checks).toEqual([{ id: "run:5", name: "CI / test", isFailed: true, failedStep: "Run tests", url: "" }])
  expect(() => parsePull(ref, JSON.stringify({ errors: [{ message: "Bad credentials" }] }))).toThrow("Bad credentials")
})
