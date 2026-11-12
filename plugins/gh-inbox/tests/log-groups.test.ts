import type { GhEvent } from "../types"
import { describe, expect, test } from "claude-code/testing"

import { byPull, logTitlesArgv, numberOf, parseLogTitles, pullGroups, titlesWanted } from "../hooks/log-groups"

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
})

test("titlesWanted asks each repository for the numbers not known yet, once each", () => {
  const groups = pullGroups([event("a", "o/r#3", "https://github.com/o/r/pull/3"), event("b", "o/r#5", "https://github.com/o/r/pull/5"), event("c", "o/r")])
  expect(titlesWanted(groups, new Set(["github.com/o/r#5"]))).toEqual(new Map([["github.com/o/r", [3]]]))
  expect(titlesWanted(groups, new Set(["github.com/o/r#3", "github.com/o/r#5"]))).toEqual(new Map())
})

test("logTitlesArgv asks pull requests and issues alike, another host as itself", () => {
  const argv = logTitlesArgv("ghe.example/o/r", [3, 5])
  expect(argv.slice(0, 4)).toEqual(["gh", "api", "--hostname", "ghe.example"])
  expect(argv).toContain("owner=o")
  expect(argv).toContain("repo=r")
  const query = argv.find(word => word.startsWith("query=")) ?? ""
  expect(query).toContain("n3: issueOrPullRequest(number: 3) { ... on PullRequest { title } ... on Issue { title } }")
  expect(query).toContain("n5: issueOrPullRequest(number: 5)")
  expect(logTitlesArgv("github.com/o/r", [3]).slice(0, 3)).toEqual(["gh", "api", "graphql"])
})

test("parseLogTitles reads each title, a number GitHub knows nothing of as none, a repository it did not answer for as nothing", () => {
  const answer = { data: { repository: { n3: { title: "Add things" }, n9: null } }, errors: [{ type: "NOT_FOUND", path: ["repository", "n9"] }] }
  expect(parseLogTitles(JSON.stringify(answer))).toEqual(
    new Map([
      [3, "Add things"],
      [9, ""],
    ]),
  )
  expect(parseLogTitles(JSON.stringify({ data: { repository: null } }))).toEqual(new Map())
})
