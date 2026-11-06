---
"gh-inbox": minor
---

Pull requests other than the branch's can be watched with `/inbox watch`: each is asked about at every check with one GraphQL request, as the branch's is, so its notices come without the Events API's delay. `/inbox watch add` opens a pane to choose them (this repository's open pull requests, and those in registered repositories you are involved in); `/inbox watch add owner/repo#12` names one. Their notices start with the repository's short name and the number, as `[tts#12]`. What a registered repository tells of them too is told once. One seen merged or closed is asked about no more and leaves the list a day later.

今のブランチ以外の PR も `/inbox watch` で選んで、今のブランチの PR と同じ経路（確認のたびに GraphQL で1回問い合わせる）で通知できるようにしました。ブランチを開いていない PR でも、Events API の遅れなく通知が届きます。`/inbox watch add` で選ぶペイン（このリポジトリで開いている PR と、登録したリポジトリで自分が関わっている PR）が開き、`/inbox watch add owner/repo#12` で直接指定もできます。通知の先頭には `[tts#12]` のようにリポジトリの短い名前と番号が付きます。登録したリポジトリにも同じイベントが届いたときは1回だけ通知します。マージ・クローズを通知したあとは問い合わせず、1日たつと一覧から外れます。
