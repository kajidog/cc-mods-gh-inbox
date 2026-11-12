import type { GhEvent } from "../types"
import { describe, expect, test } from "claude-code/testing"

import { byPull, cells, headingsWanted, logHeadingsArgv, numberOf, parseLogHeadings, pullGroups } from "../hooks/log-groups"

const event = (id: string, pull: string, url = ""): GhEvent => ({ id, kind: "comment", pull, author: "a", at: "", text: id, url, items: [] })

test("numberOf reads the pull request's or issue's number, none for a notice on the repository alone", () => {
  expect(numberOf({ pull: "o/r#12" })).toBe(12)
  expect(numberOf({ pull: "o/r" })).toBeUndefined()
})

test("byPull puts each pull request's notices together, the one with the first notice first, each in the order they came", () => {
  const list = [event("a", "o/r#3"), event("b", "o/r#5"), event("c", "o/r"), event("d", "o/r#3"), event("e", "o/r#5")]
  expect(byPull(list).map(one => one.id)).toEqual(["a", "d", "b", "e", "c"])
})

describe("pullGroups", () => {
  test("one heading a run of notices on the same pull request, linked to its page as a notice points into it", () => {
    const groups = pullGroups([
      event("a", "o/r#3", "https://github.com/o/r/pull/3#issuecomment-1"),
      event("b", "o/r#3", "https://github.com/o/r/pull/3/commits/abc"),
      event("c", "o/r#5", "https://github.com/o/r/issues/5#issuecomment-2"),
      event("d", "o/r", "https://github.com/o/r/compare/a...b"),
    ])
    expect(groups.map(group => ({ pull: group.pull, number: group.number, key: group.key, url: group.url, ids: group.events.map(one => one.id) }))).toEqual([
      { pull: "o/r#3", number: 3, key: "github.com/o/r#3", url: "https://github.com/o/r/pull/3", ids: ["a", "b"] },
      { pull: "o/r#5", number: 5, key: "github.com/o/r#5", url: "https://github.com/o/r/issues/5", ids: ["c"] },
      { pull: "o/r", number: undefined, key: undefined, url: "", ids: ["d"] },
    ])
  })

  test("a pull request no notice points into links to its page on the host its notices came from", () => {
    const [group] = pullGroups([event("a", "o/r#7", "https://ghe.example/o/r/actions/runs/1/job/2"), event("b", "o/r#7", "u")])
    expect(group?.key).toBe("ghe.example/o/r#7")
    expect(group?.url).toBe("https://ghe.example/o/r/pull/7")
  })

  test("an outside CI's details link is no host of the repository's: the rest of the log's is taken, else github.com", () => {
    const ci = { ...event("status:1", "o/r#7", "https://circleci.com/gh/o/r/123"), kind: "ci" } as const
    const [alone] = pullGroups([ci])
    expect(alone?.key).toBe("github.com/o/r#7")
    expect(alone?.url).toBe("https://github.com/o/r/pull/7")
    // Another of the repository's notices on the log, not on the page, tells its host.
    const [around] = pullGroups([ci], [ci, event("c", "o/r#3", "https://ghe.example/o/r/pull/3#issuecomment-1"), event("x", "o/other#1", "https://elsewhere.example/o/other/pull/1")])
    expect(around?.key).toBe("ghe.example/o/r#7")
    expect(around?.url).toBe("https://ghe.example/o/r/pull/7")
    // One shaped as the repository's own page is taken after any other notice's.
    const lookalike = { ...ci, url: "https://ci.example/o/r/pull/7" }
    const [after] = pullGroups([lookalike, event("c", "o/r#7", "https://ghe.example/o/r/issues/7#issuecomment-2")])
    expect(after?.key).toBe("ghe.example/o/r#7")
    expect(after?.url).toBe("https://ghe.example/o/r/issues/7")
  })
})

test("headingsWanted asks each repository for the numbers not known yet, once each", () => {
  const groups = pullGroups([event("a", "o/r#3", "https://github.com/o/r/pull/3"), event("b", "o/r#5", "https://github.com/o/r/pull/5"), event("c", "o/r")])
  expect(headingsWanted(groups, new Set(["github.com/o/r#5"]))).toEqual(new Map([["github.com/o/r", [3]]]))
  expect(headingsWanted(groups, new Set(["github.com/o/r#3", "github.com/o/r#5"]))).toEqual(new Map())
})

test("logHeadingsArgv asks a pull request's title and where it stands, an issue's title, another host as itself", () => {
  const argv = logHeadingsArgv("ghe.example/o/r", [3, 5])
  expect(argv.slice(0, 4)).toEqual(["gh", "api", "--hostname", "ghe.example"])
  expect(argv).toContain("owner=o")
  expect(argv).toContain("repo=r")
  const query = argv.find(word => word.startsWith("query=")) ?? ""
  expect(query).toContain("n3: issueOrPullRequest(number: 3) { __typename ... on PullRequest { title state isDraft mergeable reviewDecision mergeStateStatus")
  expect(query).toContain("reviewRequests(first: 20)")
  expect(query).toContain("... on Issue { title } }")
  expect(query).toContain("n5: issueOrPullRequest(number: 5)")
  expect(logHeadingsArgv("github.com/o/r", [3]).slice(0, 2)).toEqual(["gh", "api"])
  expect(logHeadingsArgv("github.com/o/r", [3])).not.toContain("--hostname")
})

test("parseLogHeadings reads each title and where a pull request stands, a number GitHub knows nothing of as none, a repository it did not answer for as nothing", () => {
  const answer = {
    data: {
      repository: {
        n3: {
          __typename: "PullRequest",
          title: "Add things",
          state: "MERGED",
          isDraft: false,
          mergeable: "UNKNOWN",
          latestOpinionatedReviews: { nodes: [{ state: "APPROVED", author: { login: "bob" } }] },
        },
        n4: { __typename: "Issue", title: "A bug" },
        n9: null,
      },
    },
    errors: [{ type: "NOT_FOUND", path: ["repository", "n9"] }],
  }
  const headings = parseLogHeadings(JSON.stringify(answer))
  expect([...headings.keys()]).toEqual([3, 4, 9])
  expect(headings.get(3)).toMatchObject({ title: "Add things", pull: { state: "MERGED", verdicts: [{ state: "APPROVED", author: "bob" }], requested: [] } })
  expect(headings.get(4)).toEqual({ title: "A bug" })
  expect(headings.get(9)).toEqual({ title: "" })
  expect(parseLogHeadings(JSON.stringify({ data: { repository: null } }))).toEqual(new Map())
})

test("cells counts what a terminal draws two cells wide (kana, kanji, fullwidth brackets) as two, the marks as one", () => {
  expect(cells("#3 Add things")).toBe(13)
  expect(cells("（マージ済み）")).toBe(14)
  expect(cells("✓ 承認  ◐ CI 1/2")).toBe(16)
  expect(cells("한글 😀")).toBe(7)
})
