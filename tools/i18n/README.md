# Task Horizon i18n toolchain

Deploy-time localization for the Task Horizon plugin. The upstream sources in
this repository are never modified on the `i18n` branch - translation happens
on the deploy artifact, driven by curated dictionaries.

## Layout

| Path | Role |
|---|---|
| `i18n/dictionary.zh-en.json` | zh -> en entries. Keys are raw Chinese literal content as written in the source (escapes preserved). |
| `i18n/spot-patches.json` | Context-sensitive exact literal replacements (locale objects, weekday arrays, format fragments). Applied before the dictionary; values inserted verbatim. |
| `i18n/keep.zh.json` | Literal content that must NOT be translated (functional strings, e.g. natural-language date parser synonyms). Exact matches, optionally scoped to files. |
| `tools/i18n/lib/tokenize.js` | String/template literal scanner (nesting-aware, comment/regex aware). |
| `tools/i18n/extract.js` | Writes `output/i18n/catalog.json` + `unique.json` (string inventory). |
| `tools/i18n/apply.js` | The translation engine; `--dry` produces the coverage report. |
| `tools/i18n/stage.js` | Builds `output/i18n/stage`: copy shipped files, rebuild `task.js`, apply translations, apply the fork identity, syntax-verify. |
| `i18n/fork.json` | Published English package identity: name/url/author, displayName/description/readme, `versionSuffix`, identity replacement + protect rules. |
| `tools/i18n/lib/fork.js` | Applies `i18n/fork.json` to the staged build (rename + manifest rewrite + leftover scan). |
| `tools/i18n/pack.js` | Verifies the stage, writes `output/i18n/package.zip` (pure-Node zip) + `RELEASE_BODY.md`. |
| `tools/i18n/deploy.ps1` | stage -> backup -> mirror into the SiYuan plugin folder (folder derived from the staged manifest). |
| `tools/i18n/migrate-data.ps1` | One-time petal-storage copy from the original plugin id to the fork id. |

## Matching model (apply.js)

1. Tokenize every shipped `.js`/`.css`; only literal *content* ranges are ever rewritten.
2. Per literal: keep list -> spot patches -> dictionary exact match -> dictionary
   longest-match replacement inside template-interpolation segments.
3. Anything Chinese left is reported as "uncovered" with context - translations
   never silently drop UI text; untranslated text stays Chinese and keeps working.
4. Nested literals inside `${...}` render through a token tree; interpolations
   themselves are never modified.

## Workflow

```powershell
# 1. coverage: what still needs translation (and which keys went stale)
node tools/i18n/apply.js --dry

# 2. translate the delta into i18n/dictionary.zh-en.json (or spot-patches)

# 3. build + inspect (published English package identity by default)
node tools/i18n/stage.js --lang en            # add --identity upstream for the drop-in build

# 3b. marketplace release artifact (verifies identity + translation report)
node tools/i18n/pack.js --tag v3.2.4-en.1     # writes output/i18n/package.zip

# 4. deploy (backs up the current install, mirrors the stage)
pwsh -File tools/i18n/deploy.ps1

# after upstream updates:
git fetch origin; git merge origin/main
node tools/i18n/apply.js --dry    # translate the new/changed strings
```

## Escape rules for dictionary values

- Entries may be plain strings, or `{ "en": "...", "exactOnly": true }` for
  short/generic labels that must only replace a whole literal (e.g. `打开`
  -> Open must not turn `打开设置` into `Open设置`).
- Exact-match values are inserted verbatim: preserve `${...}` interpolation
  syntax, write escapes in the style of the target literal context.
- Segment (substring) values are inserted through canonical escaping valid in
  all literal kinds (`\'` `\"` `` \` `` `\$` `\\`); plain ASCII/English text
  needs no special treatment.
- Never create single-character keys for particles such as `的`; use full
  literal content or distinctive multi-character runs.
- Checkout line endings matter: `.gitattributes` pins `*.js`/`*.css` to CRLF
  because some dictionary keys and raw patches match `\r\n` inside multi-line
  template literals. Do not change it.

## Reports

- `output/i18n/apply-report.json` / `stage-apply-report.json`: per-file
  replaced/uncovered details, stale keys.
- `output/i18n/backups/`: timestamped zips of the installed plugin folder.
