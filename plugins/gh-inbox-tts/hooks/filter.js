"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSettings = toSettings;
exports.shouldRead = shouldRead;
exports.speechOf = speechOf;
exports.speechFor = speechFor;
var words = function (value) {
    return String(value !== null && value !== void 0 ? value : "")
        .split(",")
        .map(function (word) { return word.trim().toLowerCase(); })
        .filter(function (word) { return word !== ""; });
};
function toSettings(options) {
    var kinds = words(options.kinds);
    var repos = words(options.repos);
    var format = typeof options.format === "string" && options.format.trim() !== "" ? options.format : "{text}";
    return {
        kinds: kinds.length === 0 ? null : new Set(kinds),
        repos: repos.length === 0 ? null : repos,
        readSelf: options.readSelf === true,
        format: format,
        interrupt: options.interrupt === true,
    };
}
/** `host/owner/repo` as `owner/repo`. */
var ownerRepo = function (repo) { return repo.split("/").slice(-2).join("/"); };
/**
 * A word names the repository by `owner/repo`, `host/owner/repo` or its alias. A pull request `/inbox pr` watches is
 * labelled with its number (`tts#12`): the alias is what comes before it, and the whole label names that one alone.
 */
function isNamed(word, notice) {
    var _a, _b;
    var repo = notice.repo.toLowerCase();
    var label = (_b = (_a = notice.label) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== null && _b !== void 0 ? _b : null;
    return word === repo || word === ownerRepo(repo) || (label !== null && (word === label || word === label.replace(/#\d+$/, "")));
}
function shouldRead(settings, notice) {
    if (notice.isSelf && !settings.readSelf)
        return false;
    if (settings.kinds !== null && !settings.kinds.has(notice.event.kind))
        return false;
    if (settings.repos !== null && !settings.repos.some(function (word) { return isNamed(word, notice); }))
        return false;
    return true;
}
/** The text read for a notice, its placeholders filled. */
function speechOf(format, notice) {
    var _a, _b;
    var prefix = notice.label === null ? "" : "[".concat(notice.label, "] ");
    var body = notice.text.startsWith(prefix) ? notice.text.slice(prefix.length) : notice.text;
    var values = {
        text: notice.text,
        body: body,
        label: (_a = notice.label) !== null && _a !== void 0 ? _a : "",
        repo: ownerRepo(notice.repo),
        kind: notice.event.kind,
        author: (_b = notice.event.author) !== null && _b !== void 0 ? _b : "",
    };
    return format.replace(/\{(\w+)\}/g, function (whole, name) { var _a; return (_a = values[name]) !== null && _a !== void 0 ? _a : whole; });
}
/** What to have tts say for a notice as it shows; undefined says nothing. */
function speechFor(settings, notice) {
    if (!shouldRead(settings, notice))
        return undefined;
    return { text: speechOf(settings.format, notice), interrupt: settings.interrupt };
}
