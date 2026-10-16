'use strict';

// Shared path/target logic for the Task Horizon i18n toolchain.
//
// "Shipped files" mirrors the exclude list of the upstream build.ps1 so that
// translation/extraction only ever looks at files that end up inside the
// plugin package.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// Same list as build.ps1 ($excludePaths). Kept in sync manually on purpose:
// if upstream changes packaging, we want to notice (coverage reports compare
// against these targets).
const EXCLUDE_TOP = [
    '.git', '.gitignore', '.impeccable.md', '.codex-tmp', '.github', '.history',
    '.idea', '.vscode', '.playwright-cli', 'output', 'scripts', '.DS_Store',
    'node_modules', 'docs', 'GUIDE_zh_CN.md', 'REPRO_SYNC.md', 'PRODUCT.md',
    'CHANGELOG.md', 'LICENSE', 'package.zip', 'build.sh', 'build.bat',
    'build.ps1', '.hotreload',
].map((name) => name.toLowerCase());

const TRANSLATE_EXTS = new Set(['.js', '.css']);

// Libraries: functional locale/format data, not UI copy.
const TRANSLATE_EXCLUDE_PREFIXES = ['src/vendor/'];

const TRANSLATE_EXCLUDE_FILES = new Set([
    // task.js is generated from src/task-horizon at deploy time; the sources
    // are the canonical extract/coverage target.
    'task.js',
]);

function isExcludedTop(name) {
    return EXCLUDE_TOP.includes(String(name).toLowerCase());
}

/**
 * List shipped files (relative paths with forward slashes) of the repo or of
 * a staged deploy tree.
 */
function listShippedFiles(root = ROOT) {
    const out = [];
    const visit = (dir, relBase) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const rel = relBase ? relBase + '/' + entry.name : entry.name;
            if (!relBase && isExcludedTop(entry.name)) continue;
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                visit(abs, rel);
            } else if (entry.isFile()) {
                out.push(rel);
            }
        }
    };
    visit(root, '');
    return out.sort();
}

function isTranslatable(rel) {
    const normalized = String(rel).replace(/\\/g, '/');
    if (TRANSLATE_EXCLUDE_FILES.has(normalized)) return false;
    if (TRANSLATE_EXCLUDE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
    const ext = path.extname(normalized).toLowerCase();
    return TRANSLATE_EXTS.has(ext);
}

module.exports = {
    ROOT,
    EXCLUDE_TOP,
    TRANSLATE_EXTS,
    TRANSLATE_EXCLUDE_FILES,
    TRANSLATE_EXCLUDE_PREFIXES,
    listShippedFiles,
    isTranslatable,
};
