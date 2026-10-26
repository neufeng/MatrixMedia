# AutoPoster — MatrixMedia 本机自动发帖 bot

> npm 包名：`autoposter`（`bot/package.json`）· 实现代码目录：`bot/`  
> **成功路径 = 在你自己的 Mac 本机发帖。**  
> AutoPoster 监视本地队列文件夹 → 调用已安装的 MatrixMedia **`matrixmedia cli publish`**（或 GUI 运行时的 `http://127.0.0.1:30088/publish`）。  
> **不会**在 Cursor 云端 VM、远程服务器上替你登录或发帖；登录态 Cookie 只存在于本机 MatrixMedia 用户数据目录。

## 合规说明

- 仅用于**发布你自己拥有版权或已获授权的内容**，请勿用于刷量、搬运侵权、批量养号等违规用途。
- AutoPoster **不**提供验证码绕过、风控对抗、Cookie 窃取等能力；小红书请按 MatrixMedia 文档在账号设置中启用 **真实浏览器（Chrome）** 并完成 GUI 登录。
- 遵循仓库 [GPL-2.0-only](../LICENSE) 许可。

## 前置条件（Mac 本机）

1. **安装 MatrixMedia**  
   - 从 [Releases](https://github.com/hanliang97/MatrixMedia/releases) 安装 `.dmg`，或在本仓库 `yarn install && yarn dev` 开发运行。
2. **命令行可用（推荐一次性软链）**  
   ```bash
   sudo ln -sf /Applications/matrixmedia.app/Contents/MacOS/matrixmedia /usr/local/bin/matrixmedia
   matrixmedia cli --help
   ```
3. **GUI 登录各平台账号**（头条 `tt`、小红书 `xhs` 等）  
   - 除抖音 / 视频号外，多数平台**不支持**纯 CLI 登录；需在 GUI 登录一次，CLI 复用 `persist:` 分区。
   - 小红书：账号管理 → 开启 **真实浏览器**，用 Chrome 完成登录（降低风控误判风险）。
4. **确认登录态**  
   ```bash
   matrixmedia cli accounts --json
   matrixmedia cli accounts -p xhs --phone "你的账号标识"
   ```

## 快速开始（本机）

```bash
# 1. 进入你的 MatrixMedia 仓库（fork clone 路径示例）
cd /Users/steven/MatrixMedia

# 2. 复制配置并修改绝对路径、账号 phone
cp bot/config.example.json bot/config.json
# 编辑 bot/config.json：queue.* 目录、accounts.tt/xhs.phone、dryRun

# 3. 先 dry-run，确认会调用哪条 CLI（不真正发布）
yarn autoposter:once -- --config bot/config.json --dry-run

# 4. 往队列丢任务（见下文「任务格式」），关闭 dryRun 后真实发布
yarn autoposter:watch -- --config bot/config.json
```

环境变量：

| 变量 | 说明 |
| ---- | ---- |
| `MATRIXMEDIA_BIN` | 覆盖 MatrixMedia 可执行文件（默认尝试 `/Applications/matrixmedia.app/.../matrixmedia`） |
| `AUTOPOSTER_CONFIG` | 默认 `--config` 路径（兼容旧名 `BOT_CONFIG`） |

## 任务格式

在 **`queue.incomingDir`**（配置里建议写 Mac 绝对路径）放置任务，支持：

### 方式 A：文件夹 + `job.json` + 视频（或头条图文素材）

```
/Users/steven/MatrixMedia/bot/queue/incoming/my-ai-video/
  job.json
  final.mp4
```

`job.json` 示例：

```json
{
  "file": "final.mp4",
  "title": "今日头条 AI 短片标题",
  "description": "正文或简介",
  "tags": "AI 创作 科技",
  "platforms": ["tt", "xhs"],
  "publishAt": "2026-11-01 18:00:00"
}
```

### 方式 B：sidecar `*.job.json` 与视频同目录

```
incoming/
  clip.mp4
  clip.job.json
```

### 字段说明

| 字段 | 必填 | 说明 |
| ---- | ---- | ---- |
| `file` | 推荐 | 视频文件名或绝对路径；省略时目录内仅能有一个视频文件 |
| `title` | 否 | 默认用配置模板 `{{filename}}` |
| `description` / `tags` | 否 | 平台语义与 [docs/cli.md](../docs/cli.md) 一致 |
| `platforms` | 否 | 默认 `["tt","xhs"]`；也可在 `config.json` 的 `defaults.platforms` 改 |
| `publishAt` | 否 | 一次性定时，`YYYY-MM-DD HH:mm:ss`，传给 `cli publish --publish-at` |

#### 头条图文帖（`type: "graphic"`）

与视频任务共用 `incoming` 队列，但 **不** 需要 mp4。示例目录 `bot/queue/incoming/sample-graphic-job/`：

```json
{
  "type": "graphic",
  "title": "2～30 字标题",
  "content": "正文，可多段",
  "contentFile": "body.md",
  "cover": "cover.jpg",
  "images": ["inline-a.jpg", "inline-b.png"],
  "tags": "科技 AI",
  "platforms": ["tt"],
  "publishAt": null
}
```

| 字段 | 说明 |
| ---- | ---- |
| `type` | 固定 `graphic`（也可用 `kind` / `textType`） |
| `title` | 必填，2～30 字 |
| `content` / `contentFile` | 至少一个 |
| `cover` / `images` | 本地图片路径（相对 job 目录或绝对路径） |
| `platforms` | 当前仅支持 `["tt"]` |
| `draft` / `publishMode` | `"draft": true` 或 `"publishMode": "draft"` 时存草稿，不正式发布 |

AutoPoster 会调用 `matrixmedia cli publish-article -p tt ...`（不走 HTTP 发布）。

完成后任务会移到 `done/` 或 `failed/`，并写入 `autoposter-run.log`。

## 配置要点

- **`dryRun: true`**：只打印将要执行的 `matrixmedia cli publish ...`，不调用发布、不消耗 Cookie 上传。换机或升级 MatrixMedia 后建议先 dry-run。
- **`rateLimitMs` / `maxPostsPerDay`**：本机限速，避免短时间连发。
- **`matrixMedia.preferHttp: true`**：当 GUI 已启动且 `30088` 可达时走 HTTP；否则仍用 CLI。
- **`accounts.<平台>.phone`**：与 GUI 账号树中的分组名 / 手机号一致。

仓库内示例路径以 `/Users/steven/MatrixMedia/...` 占位，**请改成你 Mac 上的真实绝对路径**。

## 运行方式

| 命令 | 说明 |
| ---- | ---- |
| `yarn autoposter:once -- --config bot/config.json` | 处理当前队列一轮 |
| `yarn autoposter:watch -- --config bot/config.json` | 按 `pollIntervalMs` 轮询 incoming |
| `node bot/index.js --help` | AutoPoster CLI 帮助 |
| `yarn bot:once` / `yarn bot:watch` | 兼容别名，等同 `autoposter:*` |

## macOS 定时（launchd 示例）

本机常驻监视可将 plist 放到 `~/Library/LaunchAgents/`（路径请替换为你的实际路径）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.steven.matrixmedia.autoposter</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/steven/MatrixMedia/bot/index.js</string>
    <string>--watch</string>
    <string>--config</string>
    <string>/Users/steven/MatrixMedia/bot/config.json</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/steven/MatrixMedia</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/steven/MatrixMedia/bot/queue/autoposter-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/steven/MatrixMedia/bot/queue/autoposter-stderr.log</string>
</dict>
</plist>
```

加载：

```bash
launchctl load ~/Library/LaunchAgents/com.steven.matrixmedia.autoposter.plist
```

也可用 **cron** 每分钟跑一轮 `--once`（不如 `--watch` 直观）：

```cron
* * * * * cd /Users/steven/MatrixMedia && /usr/local/bin/node bot/index.js --once --config /Users/steven/MatrixMedia/bot/config.json >> /Users/steven/MatrixMedia/bot/queue/cron.log 2>&1
```

## 发布链路（本机）

```mermaid
flowchart LR
  A[本地 queue/incoming] --> B[AutoPoster on Mac]
  B --> C{dryRun?}
  C -->|是| D[打印 CLI 命令]
  C -->|否| E[cli accounts 预检]
  E --> F{preferHttp 且 GUI 在线?}
  F -->|是| G[POST 127.0.0.1:30088/publish]
  F -->|否| H[matrixmedia cli publish]
  H --> I[done 或 failed + 日志]
  G --> I
```

## 故障排查

| 现象 | 处理 |
| ---- | ---- |
| `无法启动 MatrixMedia` | 检查 `matrixMedia.bin` 或 `MATRIXMEDIA_BIN`，或安装 `.app` 后做 `/usr/local/bin` 软链 |
| `cookie 已过期` | 在本机打开 MatrixMedia GUI 重新登录对应平台 |
| 小红书上传失败 | 确认账号已开 **真实浏览器** 且 Chrome 可正常登录创作者中心 |
| `ELECTRON_RUN_AS_NODE` 报错 | 终端执行 `unset ELECTRON_RUN_AS_NODE` 后再跑 CLI |
| 云端 Agent 无法发帖 | **预期行为**；请在本机 Mac 运行 AutoPoster |

## 开发与 CI 测试

云端仅验证 AutoPoster 逻辑（dry-run / mock CLI），不接触真实 Cookie：

```bash
yarn test:autoposter
# 别名：yarn test:bot
```

## 相关文档

- [docs/cli.md](../docs/cli.md) — `cli publish` / `accounts` 参数与退出码  
- [docs/http-api.md](../docs/http-api.md) — GUI 内置 HTTP 发布  
- 仓库根 [AGENTS.md](../AGENTS.md) — MatrixMedia 整体架构  
