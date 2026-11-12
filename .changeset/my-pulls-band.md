---
"gh-inbox": minor
---

The band above the prompt lists the open pull requests you opened, wherever they are, each with where it stands as the line under the prompt tells it, the most pressing first (what fails, what can be merged now, what runs, what waits; drafts last), up to 5, each linked from its number. They are searched for at every check on github.com and on the hosts of the registered repositories and watched pull requests: one GraphQL request a host, one point, shared between windows. Turn it off with **My pull requests above the prompt** in `/config`.

入力欄の上に、自分が出している開いた PR を、どのリポジトリのものもまとめて出すようにしました。それぞれの状態はプロンプトの下の行と同じ書き方で、急ぐもの（失敗、今マージできる、実行中、待ち。下書きは最後）から5件まで並べ、番号は GitHub へのリンクです。確認のたびに、github.com と、登録したリポジトリ・通知している PR のホストで探します（ホストごとに GraphQL 1回・1ポイント、答えは窓の間で分け合います）。出さないときは `/config` の **My pull requests above the prompt** を `false` にします。
