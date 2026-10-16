'use strict';

// Builds and verifies the marketplace release package.
//
// Reads the staged English fork build (stage.js --lang en, default fork
// identity), asserts the release invariants (fork identity, clean translation
// report, required files), packs everything into package.zip with forward
// slash entries (pure Node, no platform zip tools) and re-reads the archive to
// verify it. Also writes the GitHub release body.
//
// Usage:
//   node tools/i18n/pack.js [--stage <dir>] [--out <file>] [--tag v3.2.4-en.1]
//                           [--body <file>] [--allow-dirty] [--quiet]

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { ROOT } = require('./lib/targets');
const { loadForkConfig, scanIdentityLeftovers } = require('./lib/fork');

const QUIET = process.argv.includes('--quiet');
const ALLOW_DIRTY = process.argv.includes('--allow-dirty');

function argValue(flag) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : null;
}

const STAGE = path.resolve(argValue('--stage') || path.join(ROOT, 'output', 'i18n', 'stage'));
const OUT = path.resolve(argValue('--out') || path.join(ROOT, 'output', 'i18n', 'package.zip'));
const BODY = path.resolve(argValue('--body') || path.join(ROOT, 'output', 'i18n', 'RELEASE_BODY.md'));
const TAG = argValue('--tag');

function log(...args) {
    if (!QUIET) console.log(...args);
}

function fail(message) {
    throw new Error(message);
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

// ---------------------------------------------------------------------------
// Pure-Node ZIP writer (deflate + CRC32), deterministic entry order and a
// fixed timestamp so repeated builds produce identical archives.

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let crc = ~0;
    for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    return (~crc) >>> 0;
}

const DOS_FIXED = (() => {
    const date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    return {
        time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
        date: ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    };
})();

function zipBuild(entries) {
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const raw = entry.data;
        const crc = crc32(raw);
        const deflated = zlib.deflateRawSync(raw, { level: 9 });
        const useDeflate = deflated.length < raw.length;
        const data = useDeflate ? deflated : raw;
        const method = useDeflate ? 8 : 0;

        const local = Buffer.alloc(30 + nameBuf.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);   // version needed
        local.writeUInt16LE(0, 6);    // flags
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(DOS_FIXED.time, 10);
        local.writeUInt16LE(DOS_FIXED.date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);   // extra length
        nameBuf.copy(local, 30);
        chunks.push(local, data);

        const cd = Buffer.alloc(46 + nameBuf.length);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4);      // version made by
        cd.writeUInt16LE(20, 6);      // version needed
        cd.writeUInt16LE(0, 8);       // flags
        cd.writeUInt16LE(method, 10);
        cd.writeUInt16LE(DOS_FIXED.time, 12);
        cd.writeUInt16LE(DOS_FIXED.date, 14);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(data.length, 20);
        cd.writeUInt32LE(raw.length, 24);
        cd.writeUInt16LE(nameBuf.length, 28);
        cd.writeUInt16LE(0, 30);      // extra
        cd.writeUInt16LE(0, 32);      // comment
        cd.writeUInt16LE(0, 34);      // disk number
        cd.writeUInt16LE(0, 36);      // internal attrs
        cd.writeUInt32LE(0, 38);      // external attrs
        cd.writeUInt32LE(offset, 42);
        nameBuf.copy(cd, 46);
        central.push(cd);

        offset += local.length + data.length;
    }
    const centralBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...chunks, centralBuf, eocd]);
}

function zipReadNames(buffer) {
    const maxBack = Math.min(buffer.length, 65557);
    let eocd = -1;
    for (let i = buffer.length - 22; i >= buffer.length - maxBack && i >= 0; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) fail('package.zip: end-of-central-directory record not found');
    const count = buffer.readUInt16LE(eocd + 10);
    const cdSize = buffer.readUInt32LE(eocd + 12);
    const cdOffset = buffer.readUInt32LE(eocd + 16);
    const names = [];
    let pos = cdOffset;
    for (let i = 0; i < count; i++) {
        if (buffer.readUInt32LE(pos) !== 0x02014b50) fail(`package.zip: bad central directory entry ${i}`);
        const nameLen = buffer.readUInt16LE(pos + 28);
        const extraLen = buffer.readUInt16LE(pos + 30);
        const commentLen = buffer.readUInt16LE(pos + 32);
        names.push(buffer.slice(pos + 46, pos + 46 + nameLen).toString('utf8'));
        pos += 46 + nameLen + extraLen + commentLen;
    }
    if (pos !== cdOffset + cdSize) fail('package.zip: central directory size mismatch');
    return names;
}

// ---------------------------------------------------------------------------

function buildReleaseBody(config, manifest) {
    const suffix = String(config.versionSuffix);
    const version = String(manifest.version);
    const baseVersion = version.endsWith(`-${suffix}`) ? version.slice(0, -(suffix.length + 1)) : version.replace(/-.*$/, '');
    return [
        `Unofficial English build of [Task Horizon](${config.upstreamRepoUrl}) — based on upstream **v${baseVersion}**.`,
        '',
        `- Plugin version: **${version}** (English build of upstream \`${baseVersion}\`)`,
        `- Upstream release: ${config.upstreamRepoUrl}/releases/tag/v${baseVersion}`,
        `- Original author: [5kyfkr](https://github.com/5kyfkr) · English fork maintained by [5pyd3r1](https://github.com/5pyd3r1)`,
        '',
        `Install or update through the SiYuan marketplace ("Task Horizon (English)"), or unzip \`package.zip\` into \`{workspace}/data/plugins/${config.name}/\`.`,
        '',
        'This is an unofficial community build; all credit for the plugin goes to the original author. Please report translation issues in this repository\'s issues.',
    ].join('\n');
}

function main() {
    if (!fs.existsSync(STAGE)) fail(`stage folder not found: ${STAGE} (run stage.js --lang en first)`);
    const manifestPath = path.join(STAGE, 'plugin.json');
    if (!fs.existsSync(manifestPath)) fail(`stage is missing plugin.json: ${STAGE}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const config = loadForkConfig();
    const files = listFiles(STAGE);
    const fileSet = new Set(files);

    // --- required files -----------------------------------------------------
    const required = ['plugin.json', 'index.js', 'kernel.js', 'README.md', 'icon.png', 'preview.png'];
    for (const name of required) {
        if (!fileSet.has(name)) fail(`stage is missing required file: ${name}`);
    }
    if (files.some((rel) => rel.startsWith('src/task-horizon/'))) {
        fail('stage still contains src/task-horizon (dev sources must be dropped from the package)');
    }
    for (const [locale, relPath] of Object.entries(manifest.readme || {})) {
        if (!fileSet.has(relPath)) fail(`manifest readme.${locale} declares missing file: ${relPath}`);
    }

    // --- fork identity assertions ------------------------------------------
    if (manifest.name !== config.name) fail(`manifest name is "${manifest.name}", expected "${config.name}" (build with --identity fork)`);
    if (manifest.url !== config.repoUrl) fail(`manifest url is "${manifest.url}", expected "${config.repoUrl}"`);
    if (manifest.author !== config.author) fail(`manifest author is "${manifest.author}", expected "${config.author}"`);
    if (!String(manifest.version).endsWith(`-${config.versionSuffix}`)) fail(`manifest version "${manifest.version}" does not end in "-${config.versionSuffix}"`);
    const leftovers = scanIdentityLeftovers(STAGE, config);
    if (leftovers.length) fail(`stage still references the upstream identity (${leftovers.length} occurrence(s), e.g. ${leftovers[0].rel})`);

    // --- image budgets (marketplace limits) --------------------------------
    if (fs.statSync(path.join(STAGE, 'icon.png')).size > 64 * 1024) fail('icon.png exceeds the 64 KiB marketplace limit');
    if (fs.statSync(path.join(STAGE, 'preview.png')).size > 512 * 1024) fail('preview.png exceeds the 512 KiB marketplace limit');

    // --- entry name hygiene -------------------------------------------------
    for (const rel of files) {
        if (rel.includes('\\')) fail(`entry uses backslash: ${rel}`);
        if (rel.startsWith('/')) fail(`entry is absolute: ${rel}`);
        if (rel.split('/').some((part) => part === '..' || part === '.')) fail(`entry contains a relative segment: ${rel}`);
        for (const part of rel.split('/')) {
            if (part !== part.trim()) fail(`entry has leading/trailing spaces: ${rel}`);
            if (part.startsWith('.')) fail(`dot entries never sync and are rejected by the bazaar checker: ${rel}`);
        }
        if (rel.endsWith('.tmp')) fail(`temporary entries never sync and are rejected by the bazaar checker: ${rel}`);
        if (rel.split('/').includes('__MACOSX') || rel.endsWith('.DS_Store')) fail(`entry is a macOS archive residue: ${rel}`);
    }

    // --- translation report -------------------------------------------------
    const reportPath = path.join(path.dirname(STAGE), 'stage-apply-report.json');
    if (fs.existsSync(reportPath)) {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const totals = report.totals || {};
        const uncovered = Number(totals.uncoveredTotal || 0);
        const stale = Number(totals.staleKeys || 0);
        const rawMismatch = Array.isArray(report.rawCountMismatch) ? report.rawCountMismatch.length : 0;
        const dirty = uncovered > 0 || stale > 0 || rawMismatch > 0 || report.dry === true || report.skipped === true;
        if (dirty && !ALLOW_DIRTY) {
            fail(`translation report is not clean (uncovered=${uncovered}, stale=${stale}, rawMismatch=${rawMismatch}, dry=${report.dry === true}, skipped=${report.skipped === true}); fix the dictionaries or pass --allow-dirty`);
        }
        log(`pack: translation report clean (0 uncovered / 0 stale / 0 raw mismatches) over ${totals.filesScanned || '?'} files`);
    } else {
        log(`pack: WARNING - no translation report at ${path.relative(process.cwd(), reportPath)}`);
    }

    // --- tag vs manifest version -------------------------------------------
    if (TAG) {
        const expected = `v${manifest.version}`;
        if (TAG !== expected) fail(`tag "${TAG}" does not match manifest version (expected "${expected}")`);
        log(`pack: tag ${TAG} matches manifest version`);
    }

    // --- build the archive --------------------------------------------------
    const entries = files.map((rel) => ({ name: rel, data: fs.readFileSync(path.join(STAGE, rel)) }));
    const zip = zipBuild(entries);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, zip);

    const names = zipReadNames(zip);
    if (names.length !== entries.length) fail(`package.zip entry count mismatch (${names.length} != ${entries.length})`);
    for (let i = 0; i < names.length; i++) {
        if (names[i] !== entries[i].name) fail(`package.zip entry mismatch at ${i}: "${names[i]}" != "${entries[i].name}"`);
    }
    if (names.some((name) => name.includes('\\'))) fail('package.zip contains backslash entry names');

    // --- release body -------------------------------------------------------
    fs.writeFileSync(BODY, `${buildReleaseBody(config, manifest)}\n`, 'utf8');

    log(`pack: ${manifest.name} v${manifest.version} - ${entries.length} files, ${(zip.length / 1024).toFixed(1)} KB`);
    log(`pack: wrote ${path.relative(process.cwd(), OUT)}`);
    log(`pack: wrote ${path.relative(process.cwd(), BODY)}`);
}

try {
    main();
} catch (error) {
    console.error(`pack: FAILED - ${error.message}`);
    process.exitCode = 1;
}
