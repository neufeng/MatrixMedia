# .agent — AI Agent 工作目录

本目录是 AI 编程智能体（Claude Code / Cursor / Codex / OpenClaw 等）在本仓库工作的入口：

- [`skills/`](./skills/) — 可复用技能（符号链接到根目录 `skills/`）：`matrixmedia-cli-publish`（CLI 发布驱动）、`ui-ux-pro-max`（界面设计）
- 本文件 — **AI 自动 e2e 开发模式**工作流引导

## AI 自动 e2e 开发模式

> 适用：发布主链路（`src/main/services/upLoad/`、`publishOutcome.js`、`publishVideo.js`、CLI publish 段）及一切「能上真实平台验证」的改动。契约要求见 `AGENTS.md`「测试 / 验证流程」第 6 条。

AI 开发发布相关功能时，**不允许只跑单测就交差**——必须走以下闭环，用真实平台的运行证据收敛：

```
改代码 → 单测（yarn test:*）→ e2e 真实平台验证 → 读证据 → 修 → 重跑 → 直至 PASS
```

### 第 1 步：实现 + 单测

按常规完成代码与对应单测（`scripts/test-*.js`，回归命令见 `package.json` 的 `test:*`）。单测全绿只是入场券。

### 第 2 步：e2e 真实平台验证（免打包）

```bash
node e2e/run.js -p <受影响平台代码> --yes
# 平台代码：dy / blbl / sph / xhs / ks / bjh / tt；--yes 为 AI 非交互模式
```

- **默认本地开发模式**：产物缺失或源码有更新时自动 `yarn build:dir`，以 `electron . cli …` 执行，**不需要 electron-builder 打包安装**；`--app-mode installed` 用于发版前复验打包产物
- 预检自动查询 `cli accounts --json`：未登录平台自动跳过（不硬跑）
- 每平台生成唯一 `MM-E2E-<runId>` 标记，方便后台定位与事后清理

### 第 3 步：读证据，不是读心情

结果非 PASS 时，**按证据定位，禁止盲改**：

| 证据 | 位置 | 用途 |
| --- | --- | --- |
| 结果分类 + 回执 JSON | `e2e/artifacts/<runId>/report.md` / `report.json` | PASS_VERIFIED / NEEDS_ATTENTION / FAIL / 跳过原因 |
| 主进程诊断行 | report.md「诊断行」段（`[publish] …`） | 页面实际提示文案 → 校准 `publishOutcome.js` 信号正则 |
| 失败/未确认截图 | `~/Documents/MatrixMedia/fail-screenshots/` | 页面真实状态（弹窗/表单/toast） |
| 退出码 | 0 通过 / 1 需跟进 / 2 环境错误 | CI 语义 |

### 第 4 步：收敛标准

- 退出码 0，目标平台全部 `draftVerified=true`（或明确跳过原因）
- 无 `NEEDS_ATTENTION` / `LEGACY_SUCCESS`（后者说明产物没含新逻辑，先重新构建）
- 信号文案变化时同步 `scripts/test-publish-abnormal.js` 用例（回归：`yarn test:publish-abnormal`）

### 红线（ Issue #42 的教训）

1. **不允许无条件回报成功**：存草稿/发布没有拿到平台侧证据时，宁可 `needs_attention`（退出码 4，人工核对、不触发重试）也不许假成功
2. **误判失败会重复上传**：只有「明确失败文案」才走 `status:false` 触发重试；表单校验提示（请先选择等）归「待人工」，否则大视频会反复重传
3. **诚实标注不确定**：证据不足时如实说「无法确认」，附上截图与诊断行

## 实战案例（本工作流的首秀）

- **[case-2026-10-31-video-draft-e2e.md](./case-2026-10-31-video-draft-e2e.md)**（v0.14.0 收官案例，**推荐精读**）：issue #42 草稿假成功修复 + 视频号专项的完整 10 轮 e2e 迭代实录——每轮的现象/证据/动作、两次被证据否掉的方案、以及给其它 AI 的 8 条教训
- **Issue #42 草稿假成功**：`--draft` 全平台回报成功但后台无草稿。修复 `replyPublishOutcome` 增加轮询校验（失败文案/成功 toast/跳转三判据），e2e 四平台 `draftVerified=true` 后关闭
- **视频号专项**（commit `7711e65`）：e2e 连续多轮迭代，依次暴露并修复——wujie 影子树重渲染导致 ElementHandle 失效（not clickable）、键盘输入静默落空（回读校验兜底）、shadow DOM 文本信号全盲（递归穿透）、隐藏模板污染判定（checkVisibility + 尺寸 + 视口三重过滤）、最终以「已保存」toast 为判据连续两轮 PASS

## 注意事项

- e2e 用真实账号：会在平台留下真实草稿（标题带 `MM-E2E` 标记），验证后需人工删除
- 平台未登录的账号会被跳过；AI 无法完成「后台人工核对」环节（交互模式功能），AI 一律 `--yes`
- `yarn dev` 运行中时 e2e 自动跳过构建复用当前 dist（两者争用 dist 与 5858 端口）；需要强制构建加 `--rebuild`
- 提交信息遵循仓库中文「更新声明」规范（见 `CLAUDE.md`）
