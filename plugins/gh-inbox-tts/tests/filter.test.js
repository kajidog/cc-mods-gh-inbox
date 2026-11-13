"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var testing_1 = require("claude-code/testing");
var filter_1 = require("../hooks/filter");
var notice = function (changes) {
    if (changes === void 0) { changes = {}; }
    return (__assign({ event: { id: "1", kind: "comment", pull: "o/r#3", author: "someone", at: "", text: "", url: "", items: [] }, source: "repo", repo: "github.com/o/r", label: "r", isSelf: false, text: "[r] someoneさんが #3 にコメントしました。Looks good" }, changes));
};
(0, testing_1.test)("empty options read every notice but my own", function () { return __awaiter(void 0, void 0, void 0, function () {
    var settings;
    return __generator(this, function (_a) {
        settings = (0, filter_1.toSettings)({});
        (0, testing_1.expect)((0, filter_1.shouldRead)(settings, notice())).toBe(true);
        (0, testing_1.expect)((0, filter_1.shouldRead)(settings, notice({ isSelf: true }))).toBe(false);
        (0, testing_1.expect)((0, filter_1.shouldRead)(__assign(__assign({}, settings), { readSelf: true }), notice({ isSelf: true }))).toBe(true);
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)("kinds read only the kinds named", function () { return __awaiter(void 0, void 0, void 0, function () {
    var settings;
    return __generator(this, function (_a) {
        settings = (0, filter_1.toSettings)({ kinds: " review, CI " });
        (0, testing_1.expect)((0, filter_1.shouldRead)(settings, notice())).toBe(false);
        (0, testing_1.expect)((0, filter_1.shouldRead)(settings, notice({ event: __assign(__assign({}, notice().event), { kind: "ci" }) }))).toBe(true);
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)("repos name a repository by owner/repo, host/owner/repo or its alias, the branch's pull request too", function () { return __awaiter(void 0, void 0, void 0, function () {
    var pull, _i, _a, repos;
    return __generator(this, function (_b) {
        pull = notice({ source: "pull", label: null });
        for (_i = 0, _a = ["o/r", "GitHub.com/o/r", "r"]; _i < _a.length; _i++) {
            repos = _a[_i];
            (0, testing_1.expect)((0, filter_1.shouldRead)((0, filter_1.toSettings)({ repos: repos }), notice())).toBe(true);
        }
        (0, testing_1.expect)((0, filter_1.shouldRead)((0, filter_1.toSettings)({ repos: "o/r" }), pull)).toBe(true);
        (0, testing_1.expect)((0, filter_1.shouldRead)((0, filter_1.toSettings)({ repos: "r" }), pull)).toBe(false);
        (0, testing_1.expect)((0, filter_1.shouldRead)((0, filter_1.toSettings)({ repos: "x/y,other" }), notice())).toBe(false);
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)("a watched pull request is named by its repository's alias, or by its label alone", function () { return __awaiter(void 0, void 0, void 0, function () {
    var watched, _i, _a, repos;
    return __generator(this, function (_b) {
        watched = notice({ source: "watch", label: "tts#12", text: "[tts#12] someoneさんがコメントしました。Looks good" });
        for (_i = 0, _a = ["o/r", "tts", "TTS#12"]; _i < _a.length; _i++) {
            repos = _a[_i];
            (0, testing_1.expect)((0, filter_1.shouldRead)((0, filter_1.toSettings)({ repos: repos }), watched)).toBe(true);
        }
        (0, testing_1.expect)((0, filter_1.shouldRead)((0, filter_1.toSettings)({ repos: "tts#13" }), watched)).toBe(false);
        (0, testing_1.expect)((0, filter_1.speechOf)("{body}", watched)).toBe("someoneさんがコメントしました。Looks good");
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)("the format fills its placeholders, an unknown one left as written", function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        (0, testing_1.expect)((0, filter_1.speechOf)("{label}、{body}", notice())).toBe("r、someoneさんが #3 にコメントしました。Looks good");
        (0, testing_1.expect)((0, filter_1.speechOf)("{repo} {kind} {author} {nope}", notice())).toBe("o/r comment someone {nope}");
        (0, testing_1.expect)((0, filter_1.speechOf)("{body}", notice({ label: null, text: "#7 がマージされました。" }))).toBe("#7 がマージされました。");
        (0, testing_1.expect)((0, filter_1.toSettings)({ format: " " }).format).toBe("{text}");
        return [2 /*return*/];
    });
}); });
(0, testing_1.test)("what tts says is the notice as it shows, filtered and formatted", function () { return __awaiter(void 0, void 0, void 0, function () {
    var settings;
    return __generator(this, function (_a) {
        settings = (0, filter_1.toSettings)({ interrupt: true, format: "{body}" });
        (0, testing_1.expect)((0, filter_1.speechFor)(settings, notice({ text: "[r] rewritten" }))).toEqual({ text: "rewritten", interrupt: true });
        (0, testing_1.expect)((0, filter_1.speechFor)(settings, notice({ isSelf: true }))).toBeUndefined();
        return [2 /*return*/];
    });
}); });
