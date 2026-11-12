---
"gh-inbox": minor
---

`/inbox`, `/inbox watch`, the panes of `/inbox merge` and `/inbox approve`, and the headings of `/inbox log` narrowed to one repository name who approved, who asked for changes and whose review is still asked for (`✓ approved by alice`, `○ awaiting review from carol, @org/core`); the line under the prompt still counts them. "Awaiting review" now also shows while someone asked to review has not answered, not only while the base requires a review. Narrowed to one repository, each heading of `/inbox log` also says where its pull request stands now, merged or closed included; where the heading's row cannot hold it, a `▸ status` button unfolds it under the heading. A token that may not read the organization's teams is asked again without them. `/inbox pick` lists the pull request's description after its CI, to hand to Claude with the rest.

`/inbox`・`/inbox watch`・`/inbox merge` と `/inbox approve` のペイン・1つのリポジトリに絞り込んだ `/inbox log` の見出しで、承認した人・変更を依頼した人・レビューを待っている人の名前を出すようにしました（`✓ 承認（aliceさん）`、`○ レビュー待ち（carolさん、@org/core）`）。プロンプトの下の行は件数のままです。「レビュー待ち」は、base がレビューを求めているときに加えて、頼んだ人がまだレビューしていないあいだも出します。絞り込んだ `/inbox log` の見出しには、PR の今の状態（マージ済み・クローズ済みも）も出します。見出しの行に収まらないときは、`▸ 状態` ボタンで見出しの下に開きます。組織のチームを読めないトークンでは、チームを外して問い合わせ直します。`/inbox pick` では、CI の次に PR の説明文を出し、ほかの項目と一緒に Claude に渡せるようにしました。
