---
"gh-inbox": minor
---

Narrowed to one repository, the `/inbox log` pane puts its notices together by pull request (or issue), each under a heading with its number, a link to it on GitHub, and its title: the one with the newest notice first, each one's newest first. What is on no pull request (pushes, branches, CI) goes under a heading of its own, and the rows leave out the repository's short name. A title not known already is asked for once each time the log opens, one GraphQL request a page.

`/inbox log` のペインを1つのリポジトリに絞り込むと、通知を PR（Issue）ごとにまとめ、番号（GitHub へのリンク）とタイトルの見出しの下に並べるようにしました。最新の通知が新しい PR から順に、PR の中も新しい順です。push・ブランチ・CI など PR に付かないものは1つの見出しにまとめ、各行の先頭のリポジトリの短い名前は出しません。まだ分からないタイトルは、ログを開くたびに1回、ページごとに GraphQL 1回で問い合わせます。
