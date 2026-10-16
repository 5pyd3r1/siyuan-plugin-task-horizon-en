'use strict';

// Fork identity layer for the published English build.
//
// The released plugin is a standalone bazaar package: unique plugin name
// (siyuan-plugin-task-horizon-en), its own storage directory and English
// support links. Renaming happens on the staged build only - upstream sources
// in the repository stay untouched, exactly like the translation pipeline.
//
// Rules come from i18n/fork.json. Replacement is a single pass with a
// longest-pattern-first alternation, so the full upstream URL is rewritten
// before the bare plugin name inside it can match. `protect` entries stay
// byte-for-byte: the licence APP_ID must keep its original value because
// activation codes are signed for it.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

const PROCESS_EXTS = new Set(['.js', '.css', '.md']);
const SKIP_PREFIXES = ['src/vendor/'];
// Authored fork readmes; they never contain the upstream identity.
const SKIP_BASENAMES = new Set(['README.md', 'README_zh_CN.md']);

function loadForkConfig() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', 'fork.json'), 'utf8'));
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildReplacer(config) {
    const identity = config.identity || {};
    const protectedTexts = Array.isArray(identity.protect) ? identity.protect.map(String) : [];
    const rules = [];
    for (const text of protectedTexts) rules.push({ from: text, to: text, protect: true });
    for (const rule of Array.isArray(identity.replacements) ? identity.replacements : []) {
        rules.push({ from: String(rule.from), to: String(rule.to), protect: false });
    }
    if (!rules.length) throw new Error('i18n/fork.json has no identity rules');
    // Ordered alternation: longest pattern first so the longest match wins at
    // any position (JavaScript alternation is first-match, not longest-match).
    rules.sort((a, b) => (b.from.length - a.from.length) || (a.from < b.from ? -1 : 1));
    const pattern = new RegExp(rules.map((rule) => escapeRegExp(rule.from)).join('|'), 'g');
    const byMatch = new Map(rules.map((rule) => [rule.from, rule]));
    return { pattern, byMatch, rules, protectedTexts };
}

function listFiles(root) {
    const out = [];
    const visit = (dir, relBase) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
            if (entry.isDirectory()) visit(path.join(dir, entry.name), rel);
            else if (entry.isFile()) out.push(rel);
        }
    };
    visit(root, '');
    return out.sort();
}

function isProcessable(rel) {
    if (SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))) return false;
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    if (SKIP_BASENAMES.has(base)) return false;
    const dot = base.lastIndexOf('.');
    return dot >= 0 && PROCESS_EXTS.has(base.slice(dot).toLowerCase());
}

function maskProtected(text, protectedTexts) {
    let out = text;
    for (const value of protectedTexts) {
        if (!value) continue;
        out = out.split(value).join('#'.repeat(value.length));
    }
    return out;
}

// Leftover scan: any replacement source still present after the rename pass is
// a build error (except occurrences inside protected text). Occurrences
// followed by the replacement suffix are the renamed ones and are skipped.
function scanIdentityLeftovers(root, config) {
    const replacer = buildReplacer(config);
    const leftovers = [];
    for (const rel of listFiles(root).filter(isProcessable)) {
        const masked = maskProtected(fs.readFileSync(path.join(root, rel), 'utf8'), replacer.protectedTexts);
        for (const rule of replacer.rules) {
            if (rule.protect) continue;
            const suffix = rule.to.startsWith(rule.from) ? rule.to.slice(rule.from.length) : '';
            const guard = suffix ? `(?!${escapeRegExp(suffix)})` : '';
            const re = new RegExp(escapeRegExp(rule.from) + guard, 'g');
            let match;
            while ((match = re.exec(masked)) !== null) {
                leftovers.push({ rel, token: match[0], index: match.index });
            }
        }
    }
    return leftovers;
}

function rewriteManifest(stageDir, config) {
    const file = path.join(stageDir, 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const baseVersion = String(manifest.version || '').trim();
    if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
        throw new Error(`fork identity: unexpected upstream version "${baseVersion}" (expected x.y.z)`);
    }
    const suffix = String(config.versionSuffix || '').trim();
    if (!/^[0-9A-Za-z][0-9A-Za-z.-]*$/.test(suffix)) {
        throw new Error(`fork identity: invalid versionSuffix "${suffix}"`);
    }
    manifest.name = String(config.name);
    manifest.url = String(config.repoUrl);
    manifest.author = String(config.author);
    manifest.version = `${baseVersion}-${suffix}`;
    if (config.displayName) manifest.displayName = config.displayName;
    if (config.description) manifest.description = config.description;
    if (config.readme) manifest.readme = config.readme;
    if (Array.isArray(config.keywordsExtra) && config.keywordsExtra.length) {
        const merged = [];
        const seen = new Set();
        const add = (value) => {
            const text = String(value).trim();
            if (!text) return;
            const key = text.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            merged.push(text);
        };
        (Array.isArray(manifest.keywords) ? manifest.keywords : []).forEach(add);
        config.keywordsExtra.forEach(add);
        manifest.keywords = merged;
    }
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');
    return { baseVersion, version: manifest.version };
}

function applyForkIdentity(stageDir) {
    const config = loadForkConfig();
    const replacer = buildReplacer(config);
    const files = listFiles(stageDir).filter(isProcessable);

    let changedFiles = 0;
    let replacedTotal = 0;
    const perFile = [];
    for (const rel of files) {
        const abs = path.join(stageDir, rel);
        const source = fs.readFileSync(abs, 'utf8');
        let replaced = 0;
        const output = source.replace(replacer.pattern, (match) => {
            const rule = replacer.byMatch.get(match);
            if (!rule || rule.protect) return match;
            replaced++;
            return rule.to;
        });
        if (replaced > 0) {
            fs.writeFileSync(abs, output, 'utf8');
            changedFiles++;
            replacedTotal += replaced;
            perFile.push(`${rel} (${replaced})`);
        }
    }
    if (replacedTotal === 0) {
        throw new Error('fork identity: no identity references found in the stage - refusing to proceed');
    }

    const manifest = rewriteManifest(stageDir, config);

    const leftovers = scanIdentityLeftovers(stageDir, config);
    if (leftovers.length) {
        const sample = leftovers.slice(0, 12)
            .map((item) => `  ${item.rel}: ${JSON.stringify(item.token)}`)
            .join('\n');
        throw new Error(`fork identity: ${leftovers.length} reference(s) not renamed:\n${sample}`);
    }

    let protectedHits = 0;
    for (const rel of files) {
        const text = fs.readFileSync(path.join(stageDir, rel), 'utf8');
        for (const value of replacer.protectedTexts) {
            let index = text.indexOf(value);
            while (index !== -1) {
                protectedHits++;
                index = text.indexOf(value, index + value.length);
            }
        }
    }
    if (replacer.protectedTexts.length && protectedHits === 0) {
        throw new Error('fork identity: protected text was not found in the stage - did upstream rename it?');
    }

    return { config, changedFiles, replacedTotal, protectedHits, perFile, manifest, filesTotal: files.length };
}

module.exports = {
    ROOT,
    loadForkConfig,
    buildReplacer,
    scanIdentityLeftovers,
    applyForkIdentity,
};
