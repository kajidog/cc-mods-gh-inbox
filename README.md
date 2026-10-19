# cc-mods-gh-inbox

English | [日本語](README.ja.md)

Claude Code mods around GitHub notices.

| mod | What it does |
| --- | --- |
| [gh-inbox](plugins/gh-inbox/README.md) | Shows GitHub events on the checked-out branch's pull request and on repositories you register, and hands the ones you pick to Claude |
| [gh-inbox-tts](plugins/gh-inbox-tts/README.md) | Reads gh-inbox's notices aloud through [tts](https://github.com/kajidog/cc-mods-tts) |

Notices, commands and panes are in English by default. Set **GitHub: Language** to `ja` in `/config` for Japanese.

## Install

```
/plugin install gh-inbox --marketplace kajidog/cc-mods-gh-inbox
```

To have notices read aloud too, add the tts marketplace first, then install gh-inbox-tts. gh-inbox and tts come with it if they are not installed yet.

```
/plugin marketplace add kajidog/cc-mods-tts
/plugin install gh-inbox-tts --marketplace kajidog/cc-mods-gh-inbox
```

## Development

```sh
npm install
claude --plugin-dir ~/cc-mods-gh-inbox/plugins/gh-inbox   # load it and start (reloaded as you change it)
npm run check                                             # lint, validate, typecheck, test (every mod)
npm run changeset                                         # add a note on a change users will see
```

- Each mod lives in its own folder under `plugins/`. Versions are bumped per mod with changesets.
- To try gh-inbox-tts locally, load gh-inbox and tts with it.

  ```sh
  claude --plugin-dir ~/cc-mods-gh-inbox/plugins/gh-inbox --plugin-dir ~/cc-mods-gh-inbox/plugins/gh-inbox-tts --plugin-dir ~/cc-mods-tts
  ```

- Every line a mod shows lives in `plugins/gh-inbox/hooks/i18n.ts`, once per language. A new line goes into each of them; TypeScript reports one that is missing.

A release pull request is opened automatically from the change notes merged into main.

## License

MIT
