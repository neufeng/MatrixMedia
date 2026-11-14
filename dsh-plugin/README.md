# dsh-plugin-matrixmedia

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：一键接入**矩媒 MatrixMedia MCP**（`matrixmedia-mcp`）——把视频发布到抖音 / 快手 / 视频号 / 小红书 / B站 / 百家号 / 头条 / 番茄视频，发布掘金文章，查询账号数据与发布记录。

## 前置要求

1. 安装 MatrixMedia 桌面端：[GitHub Releases](https://github.com/hanliang97/MatrixMedia/releases) · [Gitee Releases](https://gitee.com/gzlingyi_0/pubtw/releases)
2. 在桌面端 GUI 中登录要发布的平台账号（MCP 运行在无头 stdio 环境，无法弹出扫码窗口）
3. MCP Server 通过 `npx -y matrixmedia-mcp` 启动，需 Node.js ≥ 18

## 安装

DSH Web UI → 插件 → 添加插件 → 安装源选 Git 仓库，输入：

```
https://github.com/hanliang97/dsh-plugin-matrixmedia
```

## 环境变量

均可选；不填时自动按 PATH 与各平台默认安装位置探测桌面端。

| 变量 | 必填 | 说明 |
|---|---|---|
| `MATRIXMEDIA_BIN` | 否 | MatrixMedia 可执行文件绝对路径（自动探测失败时兜底） |
| `MATRIXMEDIA_DIR` | 否 | 源码仓库根目录，仅开发模式（用仓库内 electron 跑 CLI） |

示例：

```sh
MATRIXMEDIA_BIN="/Applications/matrixmedia.app/Contents/MacOS/matrixmedia" npx @deepseek-ai/dsh web
```

## 工具

安装后工具以 `mcp__matrixmedia__*` 形式出现在会话中：

| 工具 | 说明 |
|---|---|
| `list_accounts` | 列出本机已登录账号，支持按平台过滤 |
| `list_history` | 查询本机发布记录（平台/状态/天数过滤） |
| `publish_video` | 发布视频（支持草稿与定时发布） |
| `publish_article` | 发布掘金文章 |
| `get_publish_status` | 按 jobId 轮询发布任务状态 |
| `get_account_stats` | 读账号粉丝数据（本地快照） |
| `sync_account_stats` | 主动采集账号最新数据 |
| `get_work_stats` | 按完整标题查单视频发布数据 |

## 长任务说明

视频上传可能耗时数十分钟。`publish_video` / `publish_article` 最多阻塞约 20 秒：期间完成则直接返回结果，否则返回 `{ status: "running", jobId }`，之后用 `get_publish_status({ jobId })` 轮询（每次最多等 25 秒）。参数完全相同的发布在运行中重复调用会复用同一任务，不会重复上传。

## 维护者说明

本目录即插件仓库根（范式同 [dsh-plugin-kuaizi-atom](https://github.com/hanliang97/dsh-plugin-kuaizi-atom)）：`package.json` 声明 `dsh.bundle.patch` 指向 `matrixmedia.cordis.yml`，DSH 按 Git 仓库安装时只读取这些清单与配置文件。

- 发布：把本目录内容推送到 <https://github.com/hanliang97/dsh-plugin-matrixmedia>（单独仓库）
- 版本：`vX.Y.Z` 标签对全仓库生效；默认分支列出 `package.json` 里的当前版本
- 依赖：`matrixmedia-mcp`（npm 包，[MatrixMedia 仓库 mcp/ 子包](https://github.com/hanliang97/MatrixMedia/tree/main/mcp)），发布新版本后用户侧 `npx -y` 自动取最新
