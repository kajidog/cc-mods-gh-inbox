---
"gh-inbox": minor
---

The line under the prompt leads each part of where the pull request stands with a mark, the most pressing first: `✗` fails or waits on the author (conflicts, failed CI, change requests, a base moved on), `◐` still runs, `○` waits on someone else (a review, auto-merge, a rule), `●` GitHub would merge it now, `✓` passed. A draft says so after its number. The newest comment follows a bar, cut shorter. `/inbox`, `/inbox watch` and the CI item of `/inbox pick` read the same way. GitHub is asked nothing more for it.

プロンプトの下の行を見直し、PR の状態の項目ごとに先頭に記号を付けて、急ぐものから並べるようにしました。`✗` は失敗・作者の対応が必要なもの（コンフリクト、CI の失敗、変更依頼、base より古い）、`◐` は実行中、`○` はほかの人や条件待ち（レビュー、自動マージ、ルール）、`●` は今マージできる、`✓` は通ったものです。下書きは番号のあとに出します。最新のコメントは `|` のあとに短くして出します。`/inbox`・`/inbox watch`・`/inbox pick` の CI の項目も同じ書き方です。GitHub への問い合わせは増えません。
