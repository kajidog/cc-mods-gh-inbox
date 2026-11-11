---
"gh-inbox": minor
---

`/inbox merge`, `/inbox close` and `/inbox draft` merge a pull request, close it, or switch it between a draft and ready for review. Each reads the pull request afresh and opens a pane that shows the head commit and where it stands; nothing is sent to GitHub until you press the pane's button, which has no hotkey. A merge goes only at the head commit the pane showed (`--match-head-commit`), with the repository's allowed method you used last (`merge`, `squash` or `rebase` to choose another), never past branch protection and without deleting the branch. What GitHub would not merge now (a draft, a conflict, a base moved on) is refused before any pane; one a required review or check still holds back gets auto-merge where the repository allows it.

`/inbox merge`・`/inbox close`・`/inbox draft` で、PR のマージ、クローズ、下書きとレビュー待ちの切り替えができるようにしました。どれも PR をその場で取り直し、先頭のコミットと状態をペインに出します。ペインのボタン（ホットキーなし）を押すまでは GitHub に何も送りません。マージは、ペインに出した先頭のコミットのままのときだけ行い（`--match-head-commit`）、方式はリポジトリで使えるもののうち前回使ったものです（`merge`・`squash`・`rebase` で指定もできます）。ブランチ保護は越えず、ブランチも消しません。下書き・コンフリクト・base が先に進んでいるなど今マージできないものはペインを開く前に断り、必須のレビューやチェックが足りないだけなら、リポジトリが許していれば自動マージを設定します。
