# Claude Rules

## AI 自动 e2e 开发模式（v0.14.0 起）

- **发布主链路改动**（`src/main/services/upLoad/`、`publishOutcome.js`、`publishVideo.js`、`cli/index.js` 的 publish 段）：单测通过后**必须**跑 e2e 真实平台验证：`node e2e/run.js -p <平台> --yes`（默认本地开发模式，自动构建免打包），直到目标平台 `draftVerified=true` / 退出码 0
- 工作流引导：[`.agent/README.md`](./.agent/README.md)；实战案例（10 轮迭代实录与教训）：[`.agent/case-2026-10-31-video-draft-e2e.md`](./.agent/case-2026-10-31-video-draft-e2e.md)
- 红线：不允许无条件回报成功（证据不足标 needs_attention）；只有明确失败文案才触发重试（避免重复上传）；信号文案变化需同步 `scripts/test-publish-abnormal.js`
- e2e 会产生带 `MM-E2E` 标记的真实平台草稿，验证后提醒用户清理

## 提交代码（git commit）规范

**所有提交信息必须使用中文，并按「更新声明」风格书写。**

### 格式

```
<type>(<scope>): <中文一句话概述本次更新>

<可选：更新声明正文，使用中文分条列出本次更新点>
- 新增：xxx
- 修复：xxx
- 优化：xxx
- 移除：xxx
```

### 要求

1. **语言**：标题与正文一律使用中文，专有名词（组件名、API 名、文件名）可保留英文原文。
2. **type 取值**（保持英文，便于工具识别）：
   - `feat`：新增功能
   - `fix`：修复缺陷
   - `refactor`：重构（不影响功能）
   - `perf`：性能优化
   - `style`：仅样式/格式调整
   - `docs`：文档变更
   - `chore`：构建/依赖/发布等杂项
   - `test`：测试相关
3. **scope**：可选，使用平台或模块名，如 `bjh` / `tt` / `xhs` / `login` / `upload` / `release` 等。
4. **标题**：不超过 50 个汉字，结尾不加句号，必须能让人一眼看出"这次更新做了什么"。
5. **正文（可选但推荐）**：当一次提交包含多项变更时，使用「更新声明」分条列出，每条以 `新增` / `修复` / `优化` / `移除` / `调整` 等动词开头。
6. **禁止**：不写 `update`、`修改`、`改了一下`、`tmp` 等无信息量的提交信息。
7. **不要**在提交信息中追加 `Co-Authored-By: Claude` 或 `Generated with Claude Code` 等署名/水印。

### 示例

良好示例：

```
fix(bjh): 修复百家号标题输入压缩后报 r is not defined

- 修复：用三连击 + Ctrl/Cmd+A + Backspace 替换原 selection API 闭包，避开打包压缩后变量被改名导致 ReferenceError 的问题
- 优化：增加 textContent 兜底清空逻辑，防止个别情况下选区未生效残留默认文件名
```

```
feat(local-publish): 视频标签支持批量粘贴 # 与空格快速添加

- 新增：粘贴 "#美食 #旅行,日常#vlog" 自动拆成 4 个标签
- 新增：输入完按空格等同于选择第一个候选项
- 优化：自动去重，placeholder 同步提示新交互
```

不良示例：

```
update              ← 无信息量
fix bug             ← 用了英文且没说清楚
修改了一下          ← 没说清楚
```
