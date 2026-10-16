'use strict';

// Build a complete, translated deploy tree under output/i18n/stage.
//
// Mirrors upstream packaging semantics (build.ps1):
//   1. copy every shipped file (same top-level excludes as packaging)
//   2. rebuild task.js by concatenating src/task-horizon per manifest.main.json
//   3. drop src/task-horizon from the package (task.js replaces it)
//   4. run apply.js over the staged tree (task.js included)
//   5. syntax-verify every staged .js file with vm.Script
//
// Usage:
//   node tools/i18n/stage.js [--quiet]

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { ROOT, listShippedFiles } = require('./lib/targets');

const STAGE = path.join(ROOT, 'output', 'i18n', 'stage');
const APPLY = path.join(__dirname, 'apply.js');
const QUIET = process.argv.includes('--quiet');

function log(...args) {
    if (!QUIET) console.log(...args);
}

function rmrf(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

function buildTaskMain(repoRoot, stageRoot) {
    const manifestPath = path.join(repoRoot, 'src', 'task-horizon', 'manifest.main.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const scripts = Array.isArray(manifest.scripts) ? manifest.scripts : [];
    if (!scripts.length) throw new Error('src/task-horizon/manifest.main.json has no scripts');
    const sourceRoot = path.join(repoRoot, 'src', 'task-horizon');
    const parts = [];
    for (const raw of scripts) {
        const rel = String(raw).replace(/\\/g, '/').trim();
        if (!rel || rel.split('/').some((part) => !part || part === '.' || part === '..')) {
            throw new Error(`Invalid manifest script path: ${raw}`);
        }
        const abs = path.join(sourceRoot, rel);
        const text = fs.readFileSync(abs, 'utf8');
        parts.push(`/* task-horizon build: begin ${rel} */`);
        parts.push(text);
        parts.push('');
        parts.push(`/* task-horizon build: end ${rel} */`);
        parts.push('');
    }
    fs.writeFileSync(path.join(stageRoot, 'task.js'), parts.join('\r\n'), 'utf8');
    return scripts.length;
}

function main() {
    log('stage: preparing', path.relative(ROOT, STAGE));
    rmrf(STAGE);

    const shipped = listShippedFiles(ROOT);
    let copied = 0;
    for (const rel of shipped) {
        if (rel === 'task.js') continue; // regenerated below
        if (rel.startsWith('src/task-horizon/')) continue; // becomes task.js
        copyFile(path.join(ROOT, rel), path.join(STAGE, rel));
        copied++;
    }
    const fragmentCount = buildTaskMain(ROOT, STAGE);
    log(`stage: copied ${copied} files, built task.js from ${fragmentCount} fragments`);

    log('stage: applying translation dictionary');
    execFileSync(process.execPath, [
        APPLY,
        '--root', STAGE,
        '--out', STAGE,
        '--include-task-main',
        '--report', path.join(ROOT, 'output', 'i18n', 'stage-apply-report.json'),
    ], { stdio: 'inherit' });

    // Syntax-verify everything that ships as JS.
    let verified = 0;
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(abs); continue; }
            if (!entry.name.toLowerCase().endsWith('.js')) continue;
            const rel = path.relative(STAGE, abs).replace(/\\/g, '/');
            try {
                new vm.Script(fs.readFileSync(abs, 'utf8'), { filename: rel });
            } catch (error) {
                console.error(`stage: SYNTAX ERROR in ${rel}: ${error.message}`);
                process.exitCode = 1;
            }
            verified++;
        }
    };
    walk(STAGE);
    if (process.exitCode) {
        console.error('stage: aborted due to syntax errors');
    } else {
        log(`stage: ${verified} JS files syntax-verified`);
        log(`stage: ready at ${path.relative(ROOT, STAGE)}`);
    }
}

main();
