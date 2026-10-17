---
"cc-mods-gh-inbox": minor
---

リポジトリを登録して、選んだ種類のイベント（ブランチ作成、PR の作成・マージ・クローズ、コメント、レビュー、行へのコメント、push、CI の失敗）を通知できるようにしました。`/inbox repo add owner/repo` で登録し、種類はペインか `/inbox repo set` で選びます。今のブランチの PR と同じイベントは1回だけ通知します。
