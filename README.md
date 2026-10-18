# cc-mods-gh-inbox

GitHub の通知まわりの Claude Code の mod です。

| mod | 内容 |
| --- | --- |
| [gh-inbox](plugins/gh-inbox/README.md) | 今のブランチの PR と、登録したリポジトリに届いた GitHub のイベントを通知し、選んだものを Claude に渡す |
| [gh-inbox-tts](plugins/gh-inbox-tts/README.md) | gh-inbox の通知を [tts](https://github.com/kajidog/cc-mods-tts) で読み上げる |

## インストール

```
/plugin install gh-inbox --marketplace kajidog/cc-mods-gh-inbox
/plugin install gh-inbox-tts --marketplace kajidog/cc-mods-gh-inbox   # 読み上げも使うなら
```

gh-inbox-tts を入れると、gh-inbox と tts もまだなければ一緒に入ります。

## 開発

```sh
npm install
claude --plugin-dir ~/cc-mods-gh-inbox/plugins/gh-inbox   # 読み込んで起動（変更すると読み込み直されます）
npm run check                                             # lint・検証・型チェック・テスト（全部の mod）
npm run changeset                                         # ユーザー向けの変更メモを追加
```

- mod は `plugins/` の下に1つずつ置きます。バージョンは mod ごとに changesets で上げます。
- gh-inbox-tts を手元で試すときは、gh-inbox と tts も一緒に読み込みます。

  ```sh
  claude --plugin-dir ~/cc-mods-gh-inbox/plugins/gh-inbox --plugin-dir ~/cc-mods-gh-inbox/plugins/gh-inbox-tts --plugin-dir ~/cc-mods-tts
  ```

main に入った変更メモから、リリース用の PR が自動で作られます。

## ライセンス

MIT
