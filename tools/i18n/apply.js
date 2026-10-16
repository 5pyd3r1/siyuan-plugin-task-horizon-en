'use strict';

// Translation engine for the Task Horizon i18n toolchain.
//
// Applies i18n/dictionary.zh-en.json (+ optional i18n/spot-patches.json) to
// translatable shipped files. Only string literal *content* is ever rewritten:
// the tokenizer supplies exact ranges, and this module rebuilds each file by
// copying every byte outside those ranges verbatim.
//
// Matching model
//   1. keep list      : exact literal content that must not be touched
//   2. spot patches   : exact literal content -> verbatim replacement
//   3. dictionary     : a) exact literal content -> verbatim replacement
//                       b) otherwise, per template-interpolation segment,
//                          longest-match substring replacement
//   4. uncover report : any Chinese left after 1-3, with context, so nothing
//                       is silently "translated" and nothing silently misses.
//
// Usage:
//   node tools/i18n/apply.js --dry                     # coverage run on sources
//   node tools/i18n/apply.js --root <stage> --out <dir> [--include-task-main]

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, listShippedFiles, isTranslatable } = require('./lib/targets');
const { scan, scanCss } = require('./lib/tokenize');

const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const HAN_RE_G = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

function parseArgs(argv) {
    const opts = {
        root: ROOT,
        out: '',
        dict: path.join(ROOT, 'i18n', 'dictionary.zh-en.json'),
        spot: path.join(ROOT, 'i18n', 'spot-patches.json'),
        keep: path.join(ROOT, 'i18n', 'keep.zh.json'),
        report: path.join(ROOT, 'output', 'i18n', 'apply-report.json'),
        dry: false,
        includeTaskMain: false,
        only: [],
        quiet: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => argv[++i];
        switch (arg) {
            case '--root': opts.root = path.resolve(next()); break;
            case '--out': opts.out = path.resolve(next()); break;
            case '--dict': opts.dict = path.resolve(next()); break;
            case '--spot': opts.spot = path.resolve(next()); break;
            case '--keep': opts.keep = path.resolve(next()); break;
            case '--report': opts.report = path.resolve(next()); break;
            case '--dry': opts.dry = true; break;
            case '--include-task-main': opts.includeTaskMain = true; break;
            case '--only': opts.only = next().split(',').map((s) => s.trim()).filter(Boolean); break;
            case '--quiet': opts.quiet = true; break;
            default: throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (!opts.dry && !opts.out) throw new Error('Either --dry or --out is required');
    return opts;
}

function readJsonIfPresent(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw error;
    }
}

function loadDictionary(file) {
    const raw = readJsonIfPresent(file);
    if (!raw) return new Map();
    const entries = raw.entries && typeof raw.entries === 'object' ? raw.entries : raw;
    const map = new Map();
    for (const [key, value] of Object.entries(entries)) {
        if (typeof key === 'string' && key && typeof value === 'string' && value) {
            map.set(key, value);
        }
    }
    return map;
}

function loadKeep(file) {
    const raw = readJsonIfPresent(file);
    const exact = [];
    if (raw && Array.isArray(raw.exact)) {
        for (const item of raw.exact) {
            if (typeof item === 'string') exact.push({ text: item, files: null });
            else if (item && typeof item.text === 'string') {
                exact.push({ text: item.text, files: Array.isArray(item.files) ? item.files : null });
            }
        }
    }
    return exact;
}

function isKept(exactKeep, rel, content) {
    for (const item of exactKeep) {
        if (item.text !== content) continue;
        if (!item.files) return true;
        if (item.files.some((f) => rel === f || rel.replace(/\\/g, '/') === f)) return true;
    }
    return false;
}

// Longest-match substring matcher over dictionary keys that do not contain
// template interpolation syntax (those only ever participate in exact matches).
function buildMatcher(dictionary) {
    const byFirstChar = new Map();
    let count = 0;
    for (const key of dictionary.keys()) {
        if (!key || key.includes('${')) continue;
        const first = key[0];
        let list = byFirstChar.get(first);
        if (!list) { list = []; byFirstChar.set(first, list); }
        list.push(key);
        count++;
    }
    for (const list of byFirstChar.values()) list.sort((a, b) => b.length - a.length);
    return { byFirstChar, segmentKeyCount: count, exactKeys: dictionary };
}

function escapeForInsert(value) {
    // Canonical escaping that is valid in single-quoted, double-quoted and
    // template literal contexts alike (JS NonEscapeCharacter sequences).
    return value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');
}

function noteMatch(stats, key) {
    stats.matches.set(key, (stats.matches.get(key) || 0) + 1);
}

function applyToSegment(segment, matcher, stats) {
    let out = '';
    let i = 0;
    const matched = [];
    while (i < segment.length) {
        const first = segment[i];
        const candidates = matcher.byFirstChar.get(first);
        let key = null;
        if (candidates) {
            for (const candidate of candidates) {
                if (segment.startsWith(candidate, i)) { key = candidate; break; }
            }
        }
        if (key) {
            out += escapeForInsert(matcher.exactKeys.get(key));
            noteMatch(stats, key);
            matched.push([i, i + key.length]);
            i += key.length;
        } else {
            out += first;
            i++;
        }
    }
    return { out, matched };
}

function unmatchedRuns(original, matchedSpans) {
    // Returns list of { start, end } spans of hanzi inside `original` that are
    // not inside any matched span.
    const runs = [];
    let run = null;
    for (let i = 0; i < original.length; i++) {
        const isHan = HAN_RE.test(original[i]);
        const covered = matchedSpans.some(([s, e]) => i >= s && i < e);
        if (isHan && !covered) {
            if (!run) { run = { start: i, end: i + 1 }; runs.push(run); }
            else run.end = i + 1;
        } else {
            run = null;
        }
    }
    return runs;
}

function contextFor(text, start, end) {
    const from = Math.max(0, start - 30);
    const to = Math.min(text.length, end + 30);
    const prefix = from > 0 ? '…' : '';
    const suffix = to < text.length ? '…' : '';
    return prefix + text.slice(from, to).replace(/\r/g, '\\r').replace(/\n/g, '\\n') + suffix;
}

function processFile(rel, source, opts, matcher, exactKeep, spots, stats) {
    const isCss = rel.toLowerCase().endsWith('.css');
    const tokens = isCss ? scanCss(source) : scan(source);
    const eligible = [];
    tokens.forEach((token, index) => {
        const raw = source.slice(token.contentStart, token.contentEnd);
        if (HAN_RE.test(raw)) eligible.push({ token, index, raw, parent: null });
    });
    if (!eligible.length) return { changed: false, output: source, fileStats: null };

    // Templates can nest literals inside ${...} interpolations. Ancestors of a
    // hanzi-bearing literal always contain hanzi themselves (the interpolation
    // source is part of the outer content), so the tree is built over eligible
    // tokens only. Children render first and are spliced into the parent's
    // interpolation spans.
    eligible.sort((a, b) => a.token.start - b.token.start);
    const childrenByIndex = new Map();
    const stack = [];
    for (const entry of eligible) {
        childrenByIndex.set(entry.index, []);
        while (stack.length && stack[stack.length - 1].token.end <= entry.token.start) stack.pop();
        if (stack.length) {
            entry.parent = stack[stack.length - 1];
            childrenByIndex.get(stack[stack.length - 1].index).push(entry);
        }
        stack.push(entry);
    }

    const fileStats = { replacedTokens: 0, matchedKeys: 0, kept: 0, uncovered: [] };
    const noteReplaced = () => { fileStats.replacedTokens++; };

    const translateSegment = (segment, offsetIntoRaw, matchedLocal) => {
        const result = applyToSegment(segment, matcher, stats);
        if (result.out !== segment) noteReplaced();
        for (const [s, e] of result.matched) matchedLocal.push([offsetIntoRaw + s, offsetIntoRaw + e]);
        return result.out;
    };

    const renderToken = (entry) => {
        const { token, raw } = entry;
        const open = source.slice(token.start, token.contentStart);
        const close = source.slice(token.contentEnd, token.end);

        if (isKept(exactKeep, rel, raw)) {
            fileStats.kept++;
            stats.kept++;
            return open + raw + close;
        }
        const spot = spots.get(raw);
        if (spot !== undefined) {
            noteMatch(stats, raw);
            noteReplaced();
            return open + spot + close;
        }
        const exact = matcher.exactKeys.get(raw);
        if (exact !== undefined) {
            noteMatch(stats, raw);
            noteReplaced();
            return open + exact + close;
        }

        const matchedLocal = [];
        let content = '';
        const interpolations = token.interpolations || [];
        if (!interpolations.length) {
            content = translateSegment(raw, 0, matchedLocal);
        } else {
            const kids = childrenByIndex.get(entry.index) || [];
            let cursor = token.contentStart;
            for (const interp of interpolations) {
                if (interp.start > cursor) {
                    content += translateSegment(
                        source.slice(cursor, interp.start),
                        cursor - token.contentStart,
                        matchedLocal,
                    );
                }
                let inner = '';
                let innerCursor = interp.start;
                for (const child of kids) {
                    if (child.token.start < interp.start || child.token.end > interp.end) continue;
                    inner += source.slice(innerCursor, child.token.start);
                    inner += renderToken(child);
                    innerCursor = child.token.end;
                }
                inner += source.slice(innerCursor, interp.end);
                content += inner;
                cursor = interp.end;
            }
            if (cursor < token.contentEnd) {
                content += translateSegment(
                    source.slice(cursor, token.contentEnd),
                    cursor - token.contentStart,
                    matchedLocal,
                );
            }
        }

        // Uncovered = hanzi outside matched spans. Interpolation source (and
        // nested literals, reported through their own tokens) is masked out.
        let masked = raw;
        if (interpolations.length) {
            const chars = masked.split('');
            for (const interp of interpolations) {
                for (let i = interp.start - token.contentStart; i < interp.end - token.contentStart && i < chars.length; i++) {
                    if (HAN_RE.test(chars[i])) chars[i] = '·';
                }
            }
            masked = chars.join('');
        }
        const runs = unmatchedRuns(masked, matchedLocal);
        for (const run of runs) {
            fileStats.uncovered.push({
                line: token.line,
                context: contextFor(masked, run.start, run.end),
            });
        }

        return open + content + close;
    };

    let output = '';
    let cursor = 0;
    for (const entry of eligible) {
        if (entry.parent) continue;
        output += source.slice(cursor, entry.token.start);
        output += renderToken(entry);
        cursor = entry.token.end;
    }
    output += source.slice(cursor);

    const changed = output !== source;
    if (changed) stats.filesChanged++;
    return { changed, output, fileStats };
}

function main() {
    const opts = parseArgs(process.argv);
    const dictionary = loadDictionary(opts.dict);
    const spotRaw = readJsonIfPresent(opts.spot);
    const spotEntries = spotRaw && typeof spotRaw === 'object'
        ? new Map(Object.entries(spotRaw.entries && typeof spotRaw.entries === 'object' ? spotRaw.entries : spotRaw))
        : new Map();
    const exactKeep = loadKeep(opts.keep);
    const spot = new Map();
    for (const [key, value] of spotEntries) {
        if (typeof key === 'string' && key && typeof value === 'string' && value) spot.set(key, value);
    }
    const matcher = buildMatcher(dictionary);

    let files = listShippedFiles(opts.root).filter((rel) => isTranslatable(rel)
        || (opts.includeTaskMain && rel === 'task.js'));
    if (opts.only.length) {
        files = files.filter((rel) => opts.only.some((needle) => rel.includes(needle)));
    }

    const stats = { matches: new Map(), kept: 0, filesChanged: 0 };
    const report = {
        generatedAt: new Date().toISOString(),
        root: opts.root,
        dry: opts.dry,
        dictionarySize: dictionary.size,
        spotSize: spot.size,
        keepSize: exactKeep.length,
        files: {},
        totals: {},
    };

    for (const rel of files) {
        const source = fs.readFileSync(path.join(opts.root, rel), 'utf8');
        const before = snapshotMatches(stats);
        const { output, fileStats } = processFile(rel, source, opts, matcher, exactKeep, spot, stats);
        if (fileStats) {
            const fileMatches = matchDelta(before, snapshotMatches(stats));
            report.files[rel] = {
                replacedTokens: fileStats.replacedTokens,
                matchedKeys: fileMatches,
                kept: fileStats.kept,
                uncovered: fileStats.uncovered,
            };
        }
        if (!opts.dry && output !== source) {
            const target = path.join(opts.out, rel);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, output);
        }
    }

    // stale = dictionary keys never matched anywhere; spot keys never matched
    const stale = [];
    for (const key of dictionary.keys()) {
        if (!stats.matches.has(key)) stale.push({ key, kind: 'dictionary' });
    }
    for (const key of spot.keys()) {
        if (!stats.matches.has(key)) stale.push({ key, kind: 'spot' });
    }

    const totals = {
        filesScanned: files.length,
        filesChanged: stats.filesChanged,
        keptLiterals: stats.kept,
        matchedKeysTotal: stats.matches.size,
        uncoveredTotal: Object.values(report.files).reduce((sum, f) => sum + f.uncovered.length, 0),
        staleKeys: stale.length,
    };
    report.totals = totals;
    report.stale = stale;

    fs.mkdirSync(path.dirname(opts.report), { recursive: true });
    fs.writeFileSync(opts.report, JSON.stringify(report, null, 2));

    if (!opts.quiet) {
        console.log(`apply${opts.dry ? ' (dry-run)' : ''}: ${totals.filesScanned} files, ${totals.filesChanged} changed`);
        console.log(`apply: ${totals.matchedKeysTotal} dictionary/spot keys matched, ${totals.keptLiterals} literals kept`);
        console.log(`apply: ${totals.uncoveredTotal} uncovered Chinese runs, ${totals.staleKeys} stale keys`);
        console.log(`report: ${path.relative(process.cwd(), opts.report)}`);
        const uncoveredFiles = Object.entries(report.files)
            .filter(([, f]) => f.uncovered.length)
            .sort((a, b) => b[1].uncovered.length - a[1].uncovered.length)
            .slice(0, 12);
        for (const [rel, f] of uncoveredFiles) {
            console.log(`  ${String(f.uncovered.length).padStart(5)} uncovered  ${rel}`);
        }
    }
}

function snapshotMatches(stats) {
    return { matches: new Map(stats.matches) };
}

function matchDelta(before, after) {
    let delta = 0;
    for (const [key, count] of after.matches) {
        delta += count - (before.matches.get(key) || 0);
    }
    return delta;
}

main();
