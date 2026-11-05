---
"gh-inbox": minor
---

The `/inbox log` pane marks a comment, review or line comment edited or deleted on GitHub since it was told (`(1h ago, edited 5m ago)`, `(1h ago, deleted)`), and an edited one unfolds to what it says now. It asks for the page it shows only, one GraphQL request a page, nothing between; no notice is shown for an edit.

`/inbox log` のペインで、通知したあとに GitHub で編集・削除されたコメント・レビュー・行コメントに `（1時間前、編集済み・5分前）` `（1時間前、削除済み）` と付け、編集されたものは `▸` で今の本文を開けるようにしました。問い合わせるのは表示したページの分だけ（1ページにつき GraphQL 1回）で、それ以外のときには問い合わせません。編集は通知しません。
