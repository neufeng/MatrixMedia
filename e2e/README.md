# 草稿模式 e2e（issue #42）

**定位：发布主链路的回归门槛。** 后续凡是改动发布相关代码（`upLoad/`、
`publishOutcome.js`、`publishVideo.js`、CLI publish 段）的开发（含 AI 辅助开发），
单测之外必须重打包安装后跑本 e2e，确认「CLI 回报」与「创作者后台真实草稿」一致；
开发流程要求见 `AGENTS.md` 的「测试 / 验证流程」第 6 条。

对人的使用：直接 `node e2e/run.js` 交互运行，每平台发布后会在终端提示人工到后台
核对草稿是否真实存在；`--show` 可旁观点击过程；报告输出人读的
`e2e/artifacts/<runId>/report.md`。

当前验证目标：`--draft` 模式 + 采集主进程诊断行（`[publish] ...`）校准
`pollDraftVerdict` 的成功/失败信号文案（`src/main/services/upLoad/publishOutcome.js`
的 `DRAFT_*_PATTERNS`）。

## 前置条件

1. **默认基于本地开发模式**：直接用仓库的 `dist/electron` 构建产物（`electron . cli …`），
   免 electron-builder 打包。源码有更新或产物缺失时 e2e 会自动跑 `yarn build:dir`
   （`--skip-build` 跳过，`--rebuild` 强制）。若 `yarn dev` 正在运行会自动跳过构建
   并复用当前 dist（两者会争用 dist 与 5858 调试端口，跑 e2e 前建议先停掉 dev）；
2. 目标平台账号已登录（`cli accounts` 可查），账号分组用 `--phone` 透传；
3. 生成测试视频需要 ffmpeg（或用 `--video` 指定已有 mp4，建议 <10MB 竖屏）；
4. **运行产物必须包含 #42 修复**（回执带 `draftVerified` 字段）。旧产物仍可跑，
   但结果会标记为 `LEGACY_SUCCESS`（回报成功但无法自动确认）；
5. 复验**打包产物**时用 `--app-mode installed`（默认探测 `/Applications/matrixmedia.app`，
   可用 `--app` 指定）。

## 用法

```bash
# 默认：本地开发模式，跑 issue #42 报告者的四平台（dy/blbl/sph/xhs）
node e2e/run.js

# 指定平台 + 显示发布窗口（人工旁观点击过程）
node e2e/run.js -p dy,xhs --show

# 非交互（AI/CI）：跳过后台人工核对
node e2e/run.js --yes

# 对已安装的打包 App 复验（发版前）
node e2e/run.js --app-mode installed

# 只打印将执行的命令，不发布
node e2e/run.js --dry-run

# 指定账号分组与已有视频
node e2e/run.js --phone 123456 --video /path/to/test.mp4
```

每个平台生成带唯一标记的标题（`MM-E2E-<runId>-<平台>`），便于在后台草稿箱中
定位与事后清理。**e2e 会在真实账号产生草稿，跑完后请到各平台草稿箱手动删除。**

## 流程（每平台）

1. 预检 `cli accounts --json`：该平台未登录则跳过（`--force` 强行执行）；
2. `cli publish --draft` 真实上传并点存草稿（窗口默认隐藏）；
3. 解析 CLI 回执 JSON + `[publish]` 诊断行 + 新增失败截图 + pushData 记录；
4. 交互模式下询问人工核对：后台草稿箱里是否真的有这条草稿（y/n/s）；
5. 汇总报告写入 `e2e/artifacts/<runId>/`。

## 结果分类

| 结果 | 含义 | 处理 |
|---|---|---|
| `PASS_VERIFIED` | App 校验到"保存成功"提示/跳转，`draftVerified=true` | 通过 |
| `PASS_HUMAN` | App 无校验字段但人工确认后台有草稿 | 通过 |
| `LEGACY_SUCCESS` | App 回报成功但版本不含草稿校验逻辑 | 重新打包安装 App 后重跑 |
| `NEEDS_ATTENTION` | App 无法确认（退出码 4）或「App 说成功但后台没草稿」 | **取 evidence 校准信号文案** |
| `FAIL` / `TIMEOUT` / `ERROR` | 发布失败 / 超时 / 执行异常 | 看 stderr 与失败截图 |

退出码：全部通过 = 0；存在需跟进项 = 1；用法/环境错误 = 2。

## 校准流程（修复信号文案）

`NEEDS_ATTENTION` / `PASS_VERIFIED` 与事实不符时：

1. 打开 `e2e/artifacts/<runId>/report.md`，看「诊断行」里 App 实际观测到的页面提示
   （`页面提示「...」`）与 `draftUrlUnchanged`；
2. 对照失败截图（`~/Documents/MatrixMedia/fail-screenshots/`）确认页面真实状态；
3. 在 `publishOutcome.js` 的 `DRAFT_SUCCESS_PATTERNS` / `DRAFT_FAILURE_PATTERNS` /
   `DRAFT_VALIDATION_PATTERNS` 中补充该平台文案；
4. `yarn test:publish-abnormal` 补对应用例；
5. 重新打包安装 App，重跑 e2e 确认。

## 产物

```
e2e/artifacts/<runId>/
  report.md           # 人读报告（含诊断行）
  report.json         # CI 消费（stdoutTail 截尾保留）
  dy.stdout.log       # 每平台完整 stdout
  dy.stderr.log
  dy.receipt.json     # 最终机器回执
```

## 已知边界

- 自动化只到「App 自报 + 截图 + 日志」，后台是否存在草稿的最终判定在交互模式下
  由人工确认（各平台草稿列表接口/选择器不同，待逐平台接入）；
- 番茄视频等非默认平台未纳入用例时需先在 `e2e/lib/platforms.js` 补 `CASES`；
- e2e 不清理平台侧草稿，删除需人工进行（标题带 `MM-E2E` 标记便于筛选）。
