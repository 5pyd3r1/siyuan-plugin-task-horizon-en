# Task Horizon — English (unofficial)

**Unofficial English version of [Task Horizon](https://github.com/5kyfkr/siyuan-plugin-task-horizon)**, the task-management plugin for [SiYuan](https://b3log.org/siyuan/) created by [5kyfkr](https://github.com/5kyfkr).

> This is a community fork and is **not affiliated with, sponsored by, or endorsed by the original author**. All credit for the plugin itself goes to 5kyfkr — consider supporting the original project.

## What is this?

Task Horizon aggregates tasks from across your SiYuan documents and manages them in list, checklist, timeline, Kanban, calendar and whiteboard views, with an AI assistant, focus/Pomodoro statistics and quick-add editing.

This repository publishes the plugin with an **English user interface**. Every release is generated from the original Chinese sources by a curated build-time translation pipeline, so it can follow upstream versions closely. Only the interface is translated — your task data, status names and existing content are never rewritten.

## Install

- **From the marketplace:** open *Settings → Marketplace → Plugins*, search for **Task Horizon (English)** and install it.
- **Manually:** download `package.zip` from the [latest release](https://github.com/5pyd3r1/siyuan-plugin-task-horizon-en/releases/latest), unpack it into `{workspace}/data/plugins/siyuan-plugin-task-horizon-en/`, restart SiYuan and enable the plugin.

The English build has its own plugin id (`siyuan-plugin-task-horizon-en`), so it can be installed **next to the original plugin** without conflicts.

Switching from the original plugin? Copy `{workspace}/data/storage/petal/siyuan-plugin-task-horizon` to `{workspace}/data/storage/petal/siyuan-plugin-task-horizon-en` (or run `tools/i18n/migrate-data.ps1` in this repository) to keep settings, AI configuration and the activation state, then disable the original plugin.

## Updates

Each release tracks an upstream version: `x.y.z-en.N` is the English build of upstream `x.y.z`. When 5kyfkr publishes an update, this fork merges it, re-runs the translation pipeline and publishes a matching release — updates then arrive through the SiYuan marketplace as usual.

## Notes

- Activation codes issued by the original author keep working; paid features and their licensing are unchanged. The in-app funding options still point to the original author.
- Support for the original plugin (Chinese) is at [5kyfkr/siyuan-plugin-task-horizon](https://github.com/5kyfkr/siyuan-plugin-task-horizon). Please report **translation issues** in this repository's [issues](https://github.com/5pyd3r1/siyuan-plugin-task-horizon-en/issues).

## Credits & license

- Original plugin © 5kyfkr — [repository](https://github.com/5kyfkr/siyuan-plugin-task-horizon) · MIT License (see [LICENSE](LICENSE)).
- English build maintained by [5pyd3r1](https://github.com/5pyd3r1).
