# 任务管理器（非官方英文版）

**这是 [任务管理器 Task Horizon](https://github.com/5kyfkr/siyuan-plugin-task-horizon) 的英文构建版**——由 [5kyfkr](https://github.com/5kyfkr) 为[思源笔记](https://b3log.org/siyuan/)开发的任务管理插件。

> 本项目是社区分支，与原作者无关，也未获得其背书。插件本身的全部功劳属于 5kyfkr，欢迎支持原项目。

## 说明

- 界面为英文；每个版本都由原版中文源码在构建时通过翻译词典流水线自动生成，可跟随上游版本持续更新。
- 仅翻译界面，不会改写你的任务数据、状态名称或已有内容。
- 英文版使用独立的插件 ID（`siyuan-plugin-task-horizon-en`），可与原版插件同时安装、互不冲突。
- 原作者签发的激活码继续有效，付费功能与授权方式不变；应用内的赞助入口仍指向原作者。

## 安装

- **集市安装**：打开 *设置 → 集市 → 插件*，搜索"任务管理器（英文版）"并安装。
- **手动安装**：从[最新 Release](https://github.com/5pyd3r1/siyuan-plugin-task-horizon-en/releases/latest) 下载 `package.zip`，解压到 `{工作空间}/data/plugins/siyuan-plugin-task-horizon-en/`，重启思源并启用插件。
- **从原版切换**：把 `{工作空间}/data/storage/petal/siyuan-plugin-task-horizon` 复制为 `{工作空间}/data/storage/petal/siyuan-plugin-task-horizon-en`（或运行本仓库的 `tools/i18n/migrate-data.ps1`），即可保留设置、AI 配置与激活状态，然后停用原版插件。

## 更新

每个版本对应一个上游版本：`x.y.z-en.N` 即上游 `x.y.z` 的英文构建。

本仓库每天检查上游。当 5kyfkr 发布新版本、且现有词典已覆盖全部文案时，会自动合并、重新构建并发布，随后像普通插件更新一样通过思源集市推送。若上游新增界面文案，则会先开 issue 等待补译，翻译不完整的版本绝不会发布。

## 反馈

- 翻译问题请在本仓库的 [issues](https://github.com/5pyd3r1/siyuan-plugin-task-horizon-en/issues) 反馈。
- 原版插件（中文）见 [5kyfkr/siyuan-plugin-task-horizon](https://github.com/5kyfkr/siyuan-plugin-task-horizon)。

## 许可

沿用上游 MIT 许可（见 [LICENSE](LICENSE)），版权归 5kyfkr 所有；英文构建由 [5pyd3r1](https://github.com/5pyd3r1) 维护。
