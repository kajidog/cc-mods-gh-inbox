import { expect, test } from "claude-code/testing"

import { MESSAGES } from "../hooks/i18n"

test("splitNotice cuts who did it, what they did and the rest, together the text again", () => {
  const cases = [
    ["en", " someone commented on #3: Looks good: really", { who: " someone ", action: "commented on #3", detail: ": Looks good: really" }],
    ["en", "Jane Doe left 2 comments.", { who: "Jane Doe ", action: "left 2 comments", detail: "." }],
    ["en", "CI failed on main: build: test", { who: "", action: "CI failed on main", detail: ": build: test" }],
    ["en", " #4 was merged.", { who: " ", action: "#4 was merged", detail: "." }],
    ["ja", " aさんが #3 にコメントしました。Looks good。", { who: " aさんが ", action: "#3 にコメントしました", detail: "。Looks good。" }],
    ["ja", "#4 がマージされました。", { who: "", action: "#4 がマージされました", detail: "。" }],
  ] as const
  for (const [language, text, parts] of cases) {
    expect(MESSAGES[language].splitNotice(text)).toEqual(parts)
    expect(parts.who + parts.action + parts.detail).toBe(text)
  }
})
