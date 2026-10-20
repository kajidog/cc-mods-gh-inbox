import { expect, test } from "claude-code/testing"

import { MESSAGES, splitNotice } from "../hooks/i18n"

test("splitNotice cuts who did it, what they did and the rest, together the text again", () => {
  const cases = [
    ["en", " someone commented on #3: Looks good: really", { who: " someone ", action: "commented on #3", detail: ": Looks good: really" }],
    ["en", "Jane Doe left 2 comments.", { who: "Jane Doe ", action: "left 2 comments", detail: "." }],
    ["en", "CI failed on main: build: test", { who: "", action: "CI failed on main", detail: ": build: test" }],
    ["en", " #4 was merged.", { who: " ", action: "#4 was merged", detail: "." }],
    ["ja", " aさんが #3 にコメントしました。Looks good。", { who: " aさんが ", action: "#3 にコメントしました", detail: "。Looks good。" }],
    ["ja", "#4 がマージされました。", { who: "", action: "#4 がマージされました", detail: "。" }],
    // A display name's own punctuation is the person's.
    ["en", "Team: Alice commented: hi", { who: "Team: Alice ", action: "commented", detail: ": hi" }],
    ["ja", "A。Bさんがコメントしました。hi", { who: "A。Bさんが", action: "コメントしました", detail: "。hi" }],
    // What a detail says is not who did it.
    ["en", "CI failed on main: build: someone pushed", { who: "", action: "CI failed on main", detail: ": build: someone pushed" }],
    ["ja", "aさんがコメントしました。テストのCIが失敗しました", { who: "aさんが", action: "コメントしました", detail: "。テストのCIが失敗しました" }],
    // A notice kept from before the language was changed is read as its own language.
    ["en", " aさんが #3 にコメントしました。x: y", { who: " aさんが ", action: "#3 にコメントしました", detail: "。x: y" }],
    ["ja", "someone commented on #3: 了解。", { who: "someone ", action: "commented on #3", detail: ": 了解。" }],
    ["en", "build のCIが失敗しました。step", { who: "", action: "build のCIが失敗しました", detail: "。step" }],
  ] as const
  for (const [language, text, parts] of cases) {
    expect(splitNotice(text, language)).toEqual(parts)
    expect(parts.who + parts.action + parts.detail).toBe(text)
  }
})

test("splitNotice cuts by the head and who did it the notice was made with, whatever a person's words say", () => {
  const cases = [
    // A nickname with the verbs in it.
    [" Team commented commented on #3: hi", "en", { who: "Team commented", head: "Team commented commented on #3" }, { who: " Team commented ", action: "commented on #3", detail: ": hi" }],
    // A branch name with Japanese punctuation.
    ["aliceさんが release。next に push しました。abc", "ja", { who: "aliceさん", head: "aliceさんが release。next に push しました" }, { who: "aliceさんが ", action: "release。next に push しました", detail: "。abc" }],
    // A Japanese notice whose nickname reads as English, kept from before the language was changed.
    ["Team commentedさんがコメントしました。hi", "en", { who: "Team commentedさん", head: "Team commentedさんがコメントしました" }, { who: "Team commentedさんが", action: "コメントしました", detail: "。hi" }],
    // No one at its start.
    ["build のCIが失敗しました。step", "en", { head: "build のCIが失敗しました" }, { who: "", action: "build のCIが失敗しました", detail: "。step" }],
    // A line a hook rewrote is read as it reads.
    ["bob commented: hi", "en", { who: "alice", head: "alice commented" }, { who: "bob ", action: "commented", detail: ": hi" }],
  ] as const
  for (const [text, language, known, parts] of cases) expect(splitNotice(text, language, known)).toEqual(parts)
})

test("head is what a notice says before the free text it ends with", () => {
  expect(MESSAGES.en.head("alice pushed to feat: x: fix (+1 −0)", "fix (+1 −0)")).toBe("alice pushed to feat: x")
  expect(MESSAGES.en.head("alice approved.", "")).toBe("alice approved")
  expect(MESSAGES.ja.head("aliceさんが変更を依頼しました。指摘2件 直して", "直して")).toBe("aliceさんが変更を依頼しました。指摘2件")
  expect(MESSAGES.ja.head("#3 がマージされました。", "")).toBe("#3 がマージされました")
})
