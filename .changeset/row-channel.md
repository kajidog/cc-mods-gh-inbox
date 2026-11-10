---
"gh-inbox": minor
---

**Where notices show** in `/config` has a new choice, `row`: each notice stays in the transcript as a row of its own, drawn as `/inbox log` draws it, and what was done (`commented on #3`) is a link that opens it on GitHub. The rows are not sent to Claude. They need Claude Code 2.1.312 or later; before that, notices are the dim lines of `log`. With `log`, the line counting notices not shown one by one no longer says `GitHub:` twice.

`/config` の **Where notices show** に `row` を足しました。通知が1件ずつ行として会話の中に残り（`/inbox log` と同じ2段表示）、「#3 にコメントしました」のような何をしたかの部分を押すと GitHub で開きます。行は Claude には送られません。Claude Code 2.1.312 以降で使えます（それより前では `log` と同じ薄い行で出します）。あわせて、`log` で「ほか N 件」の行の頭に `GitHub:` が2回付いていたのを直しました。
