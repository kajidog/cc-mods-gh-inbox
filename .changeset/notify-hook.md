---
"gh-inbox": minor
---

通知を出す前に `$.inbox.notify` を通すようにしました。他の mod が `inbox.notify` をフックすると、通知の前に処理を挟んだり、文を変えたり、通知を止めたりできます。
