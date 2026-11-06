# gh-inbox-tts

## 0.2.1

### Patch Changes

- d88d093: A repository named by its alias in **Repositories read** now also reads the notices of the pull requests `/inbox watch` chose there, whose label carries the number (`tts#12`); `tts#12` names that one alone.
  
  **Repositories read** に別名で指定したリポジトリでは、`/inbox watch` で選んだその PR の通知（ラベルが `tts#12` のように番号付き）も読むようにしました。`tts#12` と書くと、その PR だけを読みます。

## 0.2.0

### Minor Changes

- 5ea7c35: gh-inbox の通知を tts で読み上げる mod を追加しました。読む種類・リポジトリ・自分の操作を読むか・読み方を `/config` で選べます。
