---
"gh-inbox": minor
---

The band above the prompt lists, a row each, the open pull requests you opened (the most pressing first: what fails, what can be merged now, what runs, what waits; drafts last) and, under a heading of their own, those you are asked to review (updated last first, with who opened each), wherever they are: each with where it stands as the line under the prompt tells it, up to 5 a group, each linked from its number. They are searched for at every check on github.com and on the hosts of the registered repositories and watched pull requests: both searches in one GraphQL request a host, one point, shared between windows. Turn it off with **Pull requests above the prompt** in `/config`.

入力欄の上に、自分が出している開いた PR と、レビューを頼まれた PR を分けて、どのリポジトリのものもまとめて1件1行で出すようにしました。状態はプロンプトの下の行と同じ書き方で、自分の PR は急ぐもの（失敗、今マージできる、実行中、待ち。下書きは最後）から、レビュー依頼は更新が新しい順に作った人を添えて、それぞれ5件まで並べ、番号は GitHub へのリンクです。確認のたびに、github.com と、登録したリポジトリ・通知している PR のホストで探します（ホストごとに2つの検索をまとめて GraphQL 1回・1ポイント、答えは窓の間で分け合います）。出さないときは `/config` の **Pull requests above the prompt** を `false` にします。
