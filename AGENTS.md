# AGENTS.md

> 给通用 AI 编程 / 办公智能体（OpenAI Codex、WorkBuddy、Cursor、Claude Code、Jules 等）阅读的仓库级说明。
> 本文件遵循 [agents.md](https://agents.md) 约定：根目录放置、Markdown、面向 Agent 而非人类最终用户。
> 人类用户请阅读 [README.md](./README.md)；Claude Code 另见 [CLAUDE.md](./CLAUDE.md)（提交信息规范）。

## 项目一句话

MatrixMedia（matrix-video）是一个基于 Electron 的**自媒体矩阵发布工具**：在 Windows / macOS / CLI 三态下，一键将视频或图文发布到抖音、快手、百家号、哔哩哔哩、头条、视频号、小红书、番茄等平台。

## 想找活干？

本仓库长期开放贡献任务，见置顶 Issue：[#35 全民找茬 · 扫描代码库，发现问题，提交 PR](https://github.com/hanliang97/MatrixMedia/issues/35)。

**贡献流程（人类与 Agent 相同）**：

1. Fork 本仓库 → 新建分支（`fix/xxx` 或 `feat/xxx`）→ 提交 PR
2. 一个 PR 只解决一个问题
3. PR 描述必须包含：**问题现象 → 根因 → 修复思路 → 验证方式**（跑了哪个测试 / 如何复现）
4. **AI 生成或主要辅助的 PR，请在描述中声明所用工具**；声明不影响合并，隐瞒被发现会关 PR
5. 不接受：格式化全仓库、纯依赖升级、无行为变化的"重构"、无法在代码中定位根因的"问题"
6. **发布能力必须同时兼容并通过 GUI / CLI / MCP 三条链路测试**：凡 GUI 可用的发布参数 / 元数据字段 / 回执语义，CLI 与 MCP 必须有等价入口（反之亦然，例如 GUI 的「自定义封面」对应 CLI `--cover`、MCP publish 的 cover 参数）。**PR 必须附三条链路的测试证据**（CLI 命令行输出 / MCP tool 调用结果 / GUI 截图），只测一条链路的不予合并。同时不得破坏退出码契约与回执字段语义（以 `docs/cli.md` 为准），新增状态必须同步 GUI 展示、`cli history` 与文档
7. **发布主链路改动必须由 AI（或人类）走完 e2e 真实平台验证**：涉及 `src/main/services/upLoad/`、`publishOutcome.js`、`publishVideo.js`、CLI publish 段的 PR，需本地跑完 `node e2e/run.js -p <平台> --yes` 并在 PR 描述附结果（report.md 的结果分类与诊断行），收敛标准为目标平台 `draftVerified=true` / 退出码 0。工作流见 `.agent/README.md`，完整实战案例见 `.agent/case-2026-10-31-video-draft-e2e.md`

**高价值目标地图**（按 Issue #35 的任务清单，直接定位到代码）：

| 任务方向 | 代码位置 |
| -------- | -------- |
| 平台发布自动化（选择器脆弱、超时、重试、弹窗兜底） | `src/main/services/upLoad/`（每平台一个文件：`dy` / `ks` / `bjh` / `blbl` / `tt` / `sph` / `xhs` / `fqsp`） |
| Electron 安全（webPreferences / IPC 校验 / openExternal） | `src/main/index.js`、`preload.js`、`src/main/services/ipcMain.js` |
| 登录态检测与误判 | `src/main/services/cliLogin/`、`src/main/services/accountLoginWindowManager.js` |
| CLI 参数与错误处理 | `src/main/cli/`（`parse*.js` 参数解析、`run*Cli.js` 执行） |
| 测试补充 | `scripts/test-*.js`（50+ 个可独立运行的脚本，参照现有写法新增） |

## 关键入口（不要找错）

| 类型     | 位置                                   | 说明                                                |
| -------- | -------------------------------------- | --------------------------------------------------- |
| 主进程   | `src/main/index.js`                    | Electron 主进程入口                                 |
| CLI 入口 | `src/main/cli/index.js`                | **argv 含子串 `cli` 即进入无 GUI 模式**             |
| CLI 参数解析 | `src/main/cli/parse*.js`           | 6 个子命令各一个：`login` / `publish` / `publish-article` / `accounts` / `history` / `stats` |
| CLI 执行层 | 分散在三处                            | `accounts`/`history`/`stats` → `src/main/cli/run*Cli.js`；`login` → `src/main/services/cliLogin/`；`publish*` → `src/main/services/publishVideo.js` |
| 渲染进程 | `src/renderer/`                        | Vue 界面（GUI 模式）                                |
| MCP      | `mcp/`                                 | 独立的 Model Context Protocol Server 子包           |
| 文档     | `docs/cli.md` `docs/http-api.md` `docs/mcp.md` | 外部集成时**必读**                          |

## 给 Agent 的「How to invoke」契约

外部 AI 工具调用本仓库能力时，**不要** fork 进程内 API，统一走以下三种契约之一：

1. **CLI（推荐）**：`matrixmedia cli <subcommand> [args]`
   - 退出码：`0` 成功 / `1` 异常 / `2` 参数错误 / `3` 业务失败
   - 机器可读：`cli accounts --json`、`cli history --json` 产出稳定 JSON
   - 每个子命令支持 `--help`
2. **HTTP API**：GUI 启动后 `POST http://127.0.0.1:30088/publish`，详见 `docs/http-api.md`
3. **MCP**：支持 stdio transport 的工具直接接 `mcp/dist/index.js`，详见 `docs/mcp.md`

完整契约表见 `README.md` 的「AI 工具 / 智能体联动」章节。

## 开发环境

- **Node**：20.x（不要用 18 / 22）
- **包管理**：`yarn`（仓库根有 `yarn.lock`，也有 `package-lock.json`，**优先 yarn**）
- **构建**：`electron-builder`

## 常用命令

```bash
# 安装依赖（首次）
yarn install

# 开发模式（带热更新）
yarn dev

# 各平台打包
yarn build              # Windows x64
yarn build:mac          # macOS x64 + arm64
yarn build:linux        # Linux x64 + arm64
```

### 测试

没有统一的 `yarn test`，也没有 lint / typecheck 脚本。测试是 50+ 个**可用 node 直跑**的独立脚本（`scripts/test-*.js`），其中 31 个在 `package.json` 里注册了 `yarn test:*` 快捷方式。

```bash
# 发现全部测试（改代码前先找相关的）
ls scripts/test-*.js
grep -o '"test:[^"]*"' package.json

# 常用示例
yarn test:cli-login
yarn test:publish-article-args
yarn test:puppeteer-cancel
yarn test:account-login-window-manager

# 未注册进 package.json 的脚本直接跑
node scripts/test-<name>.js
```

## 代码风格 / 约定

- **提交信息**：必须中文，遵循 `CLAUDE.md` 中的 `<type>(<scope>): <中文概述>` 格式
  - type 用英文：`feat` / `fix` / `refactor` / `perf` / `style` / `docs` / `chore` / `test`
  - 不要在提交信息里加 `Co-Authored-By` 或 `Generated with ...` 水印
- **注释 / 文档**：中文优先，专有名词保留英文
- **平台标识**：`dy`（抖音）/ `ks`（快手）/ `bjh`（百家号）/ `blbl`（B站）/ `tt`（头条）/ `sph`（视频号）/ `xhs`（小红书）/ `fqsp`（番茄）等缩写沿用到 scope、文件名、变量名

## Agent 修改代码时的「坑」

1. **GUI 与 CLI 共享 session partition**（`persist:<账号名"-"前缀><平台>`），改登录相关代码时不要破坏这个约定，否则 CLI 与 GUI 会互踢。所有拼装必须走 `src/shared/accountPartition.js` 的 `buildAccountPartition`；对来源不明的 partition 做「归一」时用同文件的 `canonicalAccountPartition`（保留平台后缀），**禁止**再手写 `split("-")[0]`（历史 bug：连平台后缀一起截掉，登录 A 分区、发布读 B 分区）。
2. **视频号 `--force` 登录清 Cookie 前会把会话快照写到 `<userData>/sph-login-backup/`**；登录成功 / 正常恢复后删除，进程被强杀时由下次 sph 登录（`sphCliLogin`）或账号查询（`runAccountsCli`，仅分区完全无 sessionid 时）自动恢复。改这段逻辑时必须保持「先备份落盘、再清除」的顺序，备份写失败时不得清除 Cookie。
3. **Puppeteer 注入的 JS 会被打包压缩**，避免在生产代码里依赖闭包变量名；参考 `fix(bjh)` 提交记录里的「三连击 + Ctrl/Cmd+A + Backspace」模式。
4. **argv 判断逻辑**在 `src/main/cli/detectArgv.js`，新增 CLI 子命令要同步新增 `parse<Xxx>Args.js` 并更新 `docs/cli.md`。
5. **不要直接改 `dist/`**：那是构建产物。
6. **`telemetrySecret.generated.js` 由 `scripts/gen-telemetry-secret.js` 生成**，已在 `.gitignore`，不要提交。

## 测试 / 验证流程

1. 改 CLI 行为 → 跑对应 `yarn test:cli-*` 或 `yarn test:publish-*`
2. 改登录窗口 → 跑 `yarn test:account-login-window-manager`
3. 改打包逻辑 → 跑 `yarn test:pick-release-installer`
4. 跨子命令改动 → 至少手动 `node . cli <subcommand> --help` 验证参数解析没坏
5. 改某平台发布逻辑（`upLoad/<pt>.js`）→ 跑对应 `yarn test:<pt>-*`（如有），并在 PR 中说明无法自动验证的部分
6. **改发布主链路（`upLoad/`、`publishOutcome.js`、`publishVideo.js`、`cli/index.js` 的 publish 段）→ 单测通过后必须跑发布 e2e**：`node e2e/run.js -p <受影响平台> --yes`（详见 `e2e/README.md`）。e2e 默认**本地开发模式**：产物缺失/源码更新时自动 `yarn build:dir` 后以 `electron . cli …` 执行，免 electron-builder 打包；正式发版前用 `node e2e/run.js --app-mode installed` 对打包产物复验一次。结果非 0 或出现 `NEEDS_ATTENTION` / `LEGACY_SUCCESS` 时，按 `e2e/artifacts/<runId>/report.md` 的诊断行与截图修正后重跑。发布回执字段 / 退出码语义变化时必须同步更新 `e2e/` 的分类逻辑并在 PR 中说明。人交互验证用 `node e2e/run.js`（不加 `--yes`），会在每平台后提示人工到后台核对草稿是否真实存在

## 安全 / 合规

- 本工具仅用于**合法合规的学习与效率提升**，不得用于批量作弊、刷量、侵权搬运
- 涉及 Cookie / 账号 / 素材时，不要上传到任何远端；日志里也不要打印完整 Cookie
- 许可证：**GPL-2.0-only**（见 `LICENSE`），所有 AI 辅助产出同样遵循该许可

## 当 Agent 不确定时

按以下顺序查阅：

1. `README.md`（用户视角）
2. `docs/cli.md` / `docs/http-api.md` / `docs/mcp.md`（集成契约）
3. `CLAUDE.md`（提交规范）
4. `src/main/cli/` 源码（最权威的参数解析）
5. 仍不确定 → 在 PR / Issue 中向人类维护者（@hanliang97）确认，**不要瞎猜**
