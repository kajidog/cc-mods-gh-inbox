# gh-inbox-tts

English | [日本語](README.ja.md)

A Claude Code mod that reads [gh-inbox](../gh-inbox/README.md)'s notices aloud through [tts](https://github.com/kajidog/cc-mods-tts).

- It reads only in the window that shows notices (the one used last). However many windows are open, a notice is read once.
- A notice another mod stopped is not read. A notice whose text was rewritten is read as rewritten (as it shows).
- How it reads (skipping code and URLs, and so on) and the voice follow tts's settings. It reads even when tts's reading mode is `notify`.
- It reads in the language of gh-inbox's notices: set **GitHub: Language** in `/config` (`en` by default, `ja` for Japanese) to match your tts voice.

## Install

tts lives in another marketplace, so add that marketplace first.

```
/plugin marketplace add kajidog/cc-mods-tts
/plugin install gh-inbox-tts --marketplace kajidog/cc-mods-gh-inbox
```

- With the marketplace added, gh-inbox and tts come along if they are not installed yet.
- Installed without it, tts is not installed and gh-inbox-tts does not load. Run `/plugin marketplace add kajidog/cc-mods-tts`, then `/reload-plugins`.
- For setting up tts (an engine such as VOICEVOX), see [tts's README](https://github.com/kajidog/cc-mods-tts).

## Settings (`/config`)

| Setting | Default | What it does |
| --- | --- | --- |
| Kinds read | (empty) | Comma-separated kinds to read: `comment` `review` `commit` `ci` `merge` `close` `branch` `open` `push`. Empty: every kind |
| Repositories read | (empty) | Comma-separated repositories to read, each as `owner/repo`, `host/owner/repo` or its `/inbox repo alias`. Empty: every repository (the branch's pull request included) |
| Read my own activity | false | Also read notices of your own activity |
| What is said | `{text}` | The text read. `{text}` the line shown, `{body}` the same without its leading `[alias]`, `{label}` the alias, `{repo}` owner/repo, `{kind}` the kind, `{author}` the GitHub login |
| Interrupt | false | Stop what tts is saying and read the notice at once |

Example: read only reviews and CI failures, as "tts, reviewer approved #18…".

- Kinds read: `review,ci`
- What is said: `{label}, {body}`

## License

MIT
