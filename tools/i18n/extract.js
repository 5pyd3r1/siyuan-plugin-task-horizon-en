'use strict';

// Extract every Chinese-containing string literal from the shipped sources.
//
// Outputs (under output/i18n/):
//   catalog.json  per-file literal tokens (line, kind, raw text)
//   unique.json   deduplicated strings with occurrence counts and locations
//
// task.js is skipped on purpose: it is generated from src/task-horizon at
// deploy time, so the modules are the canonical source for extraction.

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, listShippedFiles, isTranslatable } = require('./lib/targets');
const { scan, scanCss } = require('./lib/tokenize');

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const HAS_HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

const outDir = path.join(ROOT, 'output', 'i18n');
fs.mkdirSync(outDir, { recursive: true });

const pluginVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8')).version;

const files = listShippedFiles(ROOT).filter((rel) => isTranslatable(rel));

const catalog = { generatedAt: new Date().toISOString(), pluginVersion, files: {} };
const unique = new Map();
let totalTokens = 0;
let hanziTokens = 0;
let escapedHanzi = 0;
const perFile = [];

for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const src = fs.readFileSync(abs, 'utf8');
    const isCss = rel.toLowerCase().endsWith('.css');
    const tokens = isCss ? scanCss(src) : scan(src);

    const hits = [];
    for (const token of tokens) {
        totalTokens++;
        const text = src.slice(token.contentStart, token.contentEnd);
        if (!HAS_HAN.test(text)) continue;
        hanziTokens++;
        // Escaped hanzi (\uXXXX) cannot be matched raw; count for a todo list.
        const escaped = (text.match(/\\u[0-9a-fA-F]{4}/g) || [])
            .filter((hit) => HAS_HAN.test(String.fromCharCode(parseInt(hit.slice(2), 16)))).length;
        escapedHanzi += escaped;
        hits.push({ line: token.line, kind: token.kind, escaped, text });

        const entry = unique.get(text) || { count: 0, escaped: 0, locations: [] };
        entry.count++;
        entry.escaped = Math.max(entry.escaped, escaped > 0 ? 1 : 0);
        if (entry.locations.length < 20) entry.locations.push(`${rel}:${token.line}`);
        unique.set(text, entry);
    }

    if (hits.length) {
        catalog.files[rel] = { count: hits.length, tokens: hits };
        perFile.push({ rel, tokens: tokens.length, hanzi: hits.length });
    }
}

const uniqueEntries = {};
for (const [text, info] of unique) {
    uniqueEntries[text] = {
        count: info.count,
        hanzi: (text.match(HAN) || []).length,
        escaped: info.escaped,
        locations: info.locations,
    };
}

fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2));
fs.writeFileSync(path.join(outDir, 'unique.json'), JSON.stringify({
    generatedAt: catalog.generatedAt,
    pluginVersion,
    count: unique.size,
    entries: uniqueEntries,
}, null, 2));

console.log(`extract: ${files.length} files scanned, ${totalTokens} literals, ${hanziTokens} with Chinese`);
console.log(`extract: ${unique.size} unique Chinese strings (escaped-backslash-u hits: ${escapedHanzi})`);
console.log('per-file (literals with Chinese):');
for (const row of perFile.sort((a, b) => b.hanzi - a.hanzi)) {
    console.log(`  ${String(row.hanzi).padStart(5)}  ${row.rel}`);
}
console.log(`output: ${path.relative(ROOT, outDir)}/catalog.json, unique.json`);
