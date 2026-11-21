# 应用内 AI 定时发帖（xAI）

## 功能概述

在 MatrixMedia **GUI 保持运行**时，按 Asia/Shanghai 时区调度任务：调用 xAI 官方 API 生成微头条正文与配图，再通过现有 Puppeteer 微头条发布链路发帖。

- 入口：顶部导航 **「AI 定时发帖」**
- 与外部 `bot/`（AutoPoster）队列**相互独立**，不迁移、不修改你本机已有的 launchd / Grok Bot 任务
- 与既有「发布历史 / 定时发布」记录（`pushData` 里 `scheduledTask`）并行存在，互不影响

## 密钥与安全

| 项目 | 说明 |
| --- | --- |
| 存储位置 | macOS/Linux/Windows：`<userData>/xai-settings.json`（Electron `userData`，矩阵应用一般为「用户目录/Library/Application Support/matrix-video/」） |
| 保护方式 | 优先 `safeStorage`（macOS 钥匙串 / Windows DPAPI）；不可用时会提示并尽量限制明文落盘权限 `0600` |
| 渲染进程 | 仅显示掩码与是否已配置；**不回传完整 Key** |
| 日志 / 历史 | 执行历史不含 Key；错误信息经打码处理 |
| 官方 API | 仅请求 `https://api.x.ai/v1/chat/completions` 与 `/v1/images/generations` |

示例 Key：`xai-********************************abcd`（占位符，勿提交真实 Key）

## 调度策略

1. **必须保持应用运行**：进程退出后不会后台执行；界面已明示。
2. **漏跑不补发**：睡眠、关机、关应用错过后，启动时**不会**集中补发，只计算**下一档** `nextRunAt`。
3. **任务锁**：同一任务同时仅允许一个执行实例（默认锁 15 分钟）。
4. **发布结果不明确**：超时或异常回执标为 `needs_attention`，**不自动重试**，避免重复发帖。
5. **默认安全**：新建任务默认 **禁用**；**未勾选「正式自动发布」** 时只测 xAI 生成，不调平台发布。

## xAI 模型默认值

- 文本：`grok-4-fast`（OpenAI 兼容 `POST /v1/chat/completions`）
- 图片：`grok-imagine-image-2.0`（`POST /v1/images/generations`，`response_format: b64_json`）

可在「xAI 设置」中修改；以 [xAI 官方文档](https://docs.x.ai) 为准。

## 内容合规

微头条默认 **40～80 字**（硬上限 100 字）。涉及时事 / 金融时，模型被要求**不得编造**「已核实新闻」；无检索来源时仅生成观点型或用户素材导向文案。

## CLI 兼容性

本功能**不修改** `matrixmedia cli publish-article` 参数与行为；你仍可照常使用：

```bash
matrixmedia cli publish-article -p tt --phone <账号> --weitoutiao --file <正文> --images <图片>
```

应用内自动发帖与 CLI 共用同一套账号 `persist:` 分区与上载逻辑。

## 数据文件

| 文件 | 内容 |
| --- | --- |
| `<userData>/auto-publish-tasks.json` | 任务定义与执行历史（不含 Key） |
| `<userData>/auto-publish-assets/<taskId>/` | 生成的配图 |

## 测试

```bash
yarn test:auto-publish-task
yarn test:xai-client
```

测试全部使用本地 mock，不产生真实发帖或收费 API 调用。

## 已知限制

- 当前仅 **头条 · 微头条**；其他平台后续可扩展。
- 无 xAI 实时检索时，不提供「自动搜新闻」能力。
- 图片 URL 模式依赖短时 CDN，默认走 base64 落地。
- 与 `bot/` 外部定时队列无自动同步。