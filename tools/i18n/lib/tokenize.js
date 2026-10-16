'use strict';

// String/template literal scanner for the Task Horizon i18n toolchain.
//
// This is NOT a full JS parser. Its single job: locate string literal content
// ranges precisely enough that the translation pass can rewrite literal text
// without ever touching code. It handles:
//   - line and block comments (skipped, never rewritten)
//   - single/double quoted strings (escapes honored)
//   - template literals including nested ${...} expressions, recording the
//     absolute spans of every interpolation so translators can mask them
//   - regex literals via the usual "last significant token" heuristic
//
// Safety property used by apply.js: applying replacements only inside
// [contentStart, contentEnd) must leave everything outside those ranges
// byte-identical.

const REGEX_ALLOWED_AFTER_CHAR = new Set([
    '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';',
    '+', '-', '*', '%', '~', '^', '<', '>', '\n', '\r',
]);

// After these words a `/` starts a regex rather than a division.
const REGEX_ALLOWED_AFTER_WORD = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'case', 'do', 'else', 'yield', 'await', 'throw',
]);

/**
 * Scan a JS source text and return literal tokens.
 *
 * Token shape:
 *   {
 *     kind: 'single' | 'double' | 'template',
 *     start, end,                    // [start, end) covers the whole literal,
 *                                    // quotes/backticks included
 *     contentStart, contentEnd,      // [contentStart, contentEnd) is the raw
 *                                    // literal content as written (escapes
 *                                    // preserved, ${...} included)
 *     line,                          // 1-based line of the opening quote
 *     interpolations: [{start,end}]  // template-only, absolute spans of each
 *                                    // ${ ... } expression (masked on apply)
 *   }
 */
function scan(src) {
    const tokens = [];
    const n = src.length;
    let i = 0;
    let line = 1;
    let lastChar = '';   // last significant punctuation char ('' at start)
    let lastWord = '';   // last identifier/keyword word, '' for non-words

    const advance = (count) => {
        for (let c = 0; c < count && i < n; c++) {
            if (src[i] === '\n') line++;
            i++;
        }
    };

    const readString = (quote) => {
        const start = i;
        const startLine = line;
        advance(1);
        while (i < n) {
            const ch = src[i];
            if (ch === '\\') { advance(2); continue; }
            if (ch === quote) { advance(1); break; }
            if (ch === '\n') { advance(1); continue; } // tolerate broken literals
            advance(1);
        }
        tokens.push({
            kind: quote === "'" ? 'single' : 'double',
            start,
            end: i,
            contentStart: start + 1,
            contentEnd: Math.max(start + 1, i - 1),
            line: startLine,
        });
    };

    const readTemplate = () => {
        const start = i;
        const startLine = line;
        advance(1);
        const interpolations = [];
        while (i < n) {
            const ch = src[i];
            if (ch === '\\') { advance(2); continue; }
            if (ch === '`') { advance(1); break; }
            if (ch === '$' && src[i + 1] === '{') {
                const exprStart = i;
                advance(2);
                readCode(true);
                interpolations.push({ start: exprStart, end: i });
                continue;
            }
            advance(1);
        }
        tokens.push({
            kind: 'template',
            start,
            end: i,
            contentStart: start + 1,
            contentEnd: Math.max(start + 1, i - 1),
            line: startLine,
            interpolations,
        });
    };

    const readRegex = () => {
        advance(1); // opening '/'
        let inClass = false;
        while (i < n) {
            const ch = src[i];
            if (ch === '\\') { advance(2); continue; }
            if (ch === '[') inClass = true;
            else if (ch === ']') inClass = false;
            else if (ch === '/' && !inClass) { advance(1); break; }
            else if (ch === '\n') break; // malformed; bail out
            advance(1);
        }
        while (i < n && /[a-z]/i.test(src[i])) advance(1); // flags
    };

    /**
     * Read JS code. With templateExpr=true, stop after consuming the `}` that
     * closes the ${...} region (matched by brace depth). Returns true when it
     * terminated at the expected boundary.
     */
    const readCode = (templateExpr) => {
        let depth = 0;
        while (i < n) {
            const ch = src[i];
            if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { advance(1); continue; }
            if (ch === '/' && src[i + 1] === '/') {
                while (i < n && src[i] !== '\n') advance(1);
                continue;
            }
            if (ch === '/' && src[i + 1] === '*') {
                advance(2);
                while (i < n && !(src[i] === '*' && src[i + 1] === '/')) advance(1);
                if (i < n) advance(2);
                continue;
            }
            if (ch === "'" || ch === '"') { readString(ch); lastChar = 'x'; lastWord = ''; continue; }
            if (ch === '`') { readTemplate(); lastChar = 'x'; lastWord = ''; continue; }
            if (ch === '/') {
                const regexOK = REGEX_ALLOWED_AFTER_CHAR.has(lastChar)
                    || (lastChar === 'x' && REGEX_ALLOWED_AFTER_WORD.has(lastWord));
                if (regexOK) { readRegex(); lastChar = 'x'; lastWord = ''; continue; }
                advance(1); lastChar = '/'; lastWord = ''; continue;
            }
            if (ch === '{') { depth++; advance(1); lastChar = '{'; lastWord = ''; continue; }
            if (ch === '}') {
                advance(1);
                if (templateExpr && depth === 0) return true;
                if (depth > 0) depth--;
                lastChar = '}'; lastWord = ''; continue;
            }
            if (/[A-Za-z_$]/.test(ch)) {
                let j = i + 1;
                while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
                lastWord = src.slice(i, j);
                advance(j - i);
                lastChar = 'x';
                continue;
            }
            if (/[0-9]/.test(ch)) {
                let j = i + 1;
                while (j < n && /[0-9a-fA-FxXoObBnN_.]/.test(src[j])) j++;
                advance(j - i);
                lastChar = 'x'; lastWord = '';
                continue;
            }
            advance(1);
            lastChar = ch; lastWord = '';
        }
        return !templateExpr;
    };

    readCode(false);
    return tokens;
}

/**
 * CSS variant: locate quoted strings (single/double) only, skipping comments.
 * UI copy in CSS lives inside `content: "..."`; everything else is functional.
 */
function scanCss(src) {
    const tokens = [];
    const n = src.length;
    let i = 0;
    let line = 1;

    const advance = (count) => {
        for (let c = 0; c < count && i < n; c++) {
            if (src[i] === '\n') line++;
            i++;
        }
    };

    while (i < n) {
        const ch = src[i];
        if (ch === '/' && src[i + 1] === '*') {
            advance(2);
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) advance(1);
            if (i < n) advance(2);
            continue;
        }
        if (ch === '"' || ch === "'") {
            const start = i;
            const startLine = line;
            advance(1);
            while (i < n) {
                const c2 = src[i];
                if (c2 === '\\') { advance(2); continue; }
                if (c2 === ch) { advance(1); break; }
                if (c2 === '\n') { advance(1); continue; }
                advance(1);
            }
            tokens.push({
                kind: ch === "'" ? 'single' : 'double',
                start,
                end: i,
                contentStart: start + 1,
                contentEnd: Math.max(start + 1, i - 1),
                line: startLine,
            });
            continue;
        }
        advance(1);
    }
    return tokens;
}

module.exports = { scan, scanCss };
