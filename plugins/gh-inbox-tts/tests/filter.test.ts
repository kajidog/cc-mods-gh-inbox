import { expect, test } from "claude-code/testing"
import type { InboxNotice } from "gh-inbox"

import { shouldRead, speechFor, speechOf, toSettings } from "../hooks/filter"

const notice = (changes: Partial<InboxNotice> = {}): InboxNotice => ({
  event: { id: "1", kind: "comment", pull: "o/r#3", author: "someone", at: "", text: "", url: "", items: [] },
  source: "repo",
  repo: "github.com/o/r",
  label: "r",
  isSelf: false,
  text: "[r] someoneさんが #3 にコメントしました。Looks good",
  ...changes,
})

test("empty options read every notice but my own", async () => {
  const settings = toSettings({})
  expect(shouldRead(settings, notice())).toBe(true)
  expect(shouldRead(settings, notice({ isSelf: true }))).toBe(false)
  expect(shouldRead({ ...settings, readSelf: true }, notice({ isSelf: true }))).toBe(true)
})

test("kinds read only the kinds named", async () => {
  const settings = toSettings({ kinds: " review, CI " })
  expect(shouldRead(settings, notice())).toBe(false)
  expect(shouldRead(settings, notice({ event: { ...notice().event, kind: "ci" } }))).toBe(true)
})

test("repos name a repository by owner/repo, host/owner/repo or its alias, the branch's pull request too", async () => {
  const pull = notice({ source: "pull", label: null })
  for (const repos of ["o/r", "GitHub.com/o/r", "r"]) expect(shouldRead(toSettings({ repos }), notice())).toBe(true)
  expect(shouldRead(toSettings({ repos: "o/r" }), pull)).toBe(true)
  expect(shouldRead(toSettings({ repos: "r" }), pull)).toBe(false)
  expect(shouldRead(toSettings({ repos: "x/y,other" }), notice())).toBe(false)
})

test("the format fills its placeholders, an unknown one left as written", async () => {
  expect(speechOf("{label}、{body}", notice())).toBe("r、someoneさんが #3 にコメントしました。Looks good")
  expect(speechOf("{repo} {kind} {author} {nope}", notice())).toBe("o/r comment someone {nope}")
  expect(speechOf("{body}", notice({ label: null, text: "#7 がマージされました。" }))).toBe("#7 がマージされました。")
  expect(toSettings({ format: " " }).format).toBe("{text}")
})

test("what tts says follows what the hooks beneath answered", async () => {
  const settings = toSettings({ interrupt: true })
  expect(speechFor(settings, { value: notice({ text: "rewritten" }) })).toEqual({ text: "rewritten", interrupt: true })
  expect(speechFor(settings, { deny: "muted" })).toBeUndefined()
  expect(speechFor(settings, { value: notice({ isSelf: true }) })).toBeUndefined()
})
