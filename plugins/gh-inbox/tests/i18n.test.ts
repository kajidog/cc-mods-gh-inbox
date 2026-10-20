import { expect, test } from "claude-code/testing"

import { splitNotice } from "../hooks/i18n"

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

test("splitNotice takes who did it as the notice named them, whatever words their nickname has", () => {
  expect(splitNotice(" Team commented commented: hi", "en", "Team commented")).toEqual({ who: " Team commented ", action: "commented", detail: ": hi" })
  expect(splitNotice("がさんがコメントしました。x", "ja", "がさん")).toEqual({ who: "がさんが", action: "コメントしました", detail: "。x" })
  // Named in the other language, from before the language was changed.
  expect(splitNotice("Team approved approved.", "ja", "Team approved")).toEqual({ who: "Team approved ", action: "approved", detail: "." })
  // A name the line does not start with (a hook rewrote it) is read as the line reads.
  expect(splitNotice("bob commented: hi", "en", "alice")).toEqual({ who: "bob ", action: "commented", detail: ": hi" })
})
