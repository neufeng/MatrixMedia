# 实战案例：视频号草稿修复的 AI 自动 e2e 迭代全程（2026-10-31）

> 本文是 `.agent/README.md`「AI 自动 e2e 开发模式」的完整实录，供其它 AI 参考如何**只凭证据**迭代到收敛。
> 背景：issue #42（--draft 全平台回报成功但后台无草稿）的通用校验已落地，本轮任务是修复视频号「声明原创」勾选失败并用 e2e 验证。任务指令只有一句：「视频号原创说明你自己 e2e 加修复一下」。

## 结果

最终方案经 **10 轮真实平台 e2e** 迭代收敛，最后连续两轮 `draftVerified=true`（commit `7711e65`）。中途放弃了两个"想当然"的方案（草稿列表页导航核对、post_list 接口核对），全部以截图/诊断行证据定案。

## 迭代时间线（每轮：现象 → 证据 → 动作）

| # | runId | 现象 | 关键证据 | 结论 / 动作 |
|---|---|---|---|---|
| 1 | `060034` | 五平台全部退出码 2 | stderr：`缺少 --phone 或完整 --partition` | CLI 必填账号选择器 → e2e 预检从 `cli accounts --json` 自动取已登录分组填充 `--phone` |
| 2 | `060137` | dy/blbl/ks `draftVerified=true`；sph 流程中断 | stderr 堆栈：`CDPElementHandle.clickablePoint … Node is either not clickable or not an HTMLElement` | **不是选择器问题**：wujie 微前端影子树重渲染让 ElementHandle 指向已分离节点 → 新增 `clickSphShadow`（evaluate 实时查询 + DOM click + 重试） |
| 3 | `061827` | sph 走到存草稿但「未确认」；之前轮次截图里**表单描述为空** | `readPageText` 对 sph 页面返回空 → **文本信号全盲**：内容在 shadow root / wujie iframe 里，`body.innerText` 读不到 | `readPageText` 递归穿透 shadow root + 同源 iframe；简介/短标题改为「点击聚焦 + 回读校验 + 重试 3 次」 |
| 4 | `062341` | 仍未确认 | 新增的上下文采集：`页面出现校验提示「请先选择」` | 勾上声明原创后**平台强制要求视频标注** → e2e 用例补 `--cs` |
| 5 | `062823` | 仍「请先选择」 | 截图：**「添加拍摄时间和地点」对话框**（拍摄地点必填） | `self_shot` 标注会触发该对话框 → 改用 `ai_generated` |
| 6 | `063147` | 仍失败 | 上下文证据：`…暂无小说 暂无绑定小程序 请先选择左侧小程序…`，但**截图里没有任何对话框** | 隐藏模板文本污染：`textContent` 把 display:none 的组件模板也读进来了 → 引入可见性三重过滤（checkVisibility + 真实尺寸 + 视口相交） |
| 7 | `064022` | **假阳性**：报告 verified | 列表页 marker 命中，但引导弹窗还压着列表；下一轮加 URL 守卫后不再命中 | **我自己 goto 列表页造成的 URL 变化被当成「保存成功后跳转」**；且 `post/list` 只显示已发表视频 → 放弃导航核对方案，`replyPublishOutcome` 增加 `draftVerdictOverride`（调用方判定优先） |
| 8 | `065401`/`065709` | 抛错「保存草稿被平台拒绝」 | 截图顶部赫然是绿色 **✅已保存 toast** | 保存一直是成功的！「将此次编辑保留?」常驻隐藏模板通过了 `checkVisibility` → 白名单过滤该模板；同时发现用户被 `will-prevent-unload` 二次确认弹窗反复打扰（导航方案遗留问题） |
| 9 | `065940` | 直接抛 `switchedDraftTab is not defined` | stderr | 删除列表核对死代码时日志行残留引用 → **删代码必须清干净引用**（低级但真实） |
| 10 | `070121` | 未确认 | 列表页截图：只有已发表视频，无草稿条目 | 导航方案彻底证伪 → 终版方案：点击后 6 秒内全量文本轮询捕捉**「已保存」toast**（文案经截图实证固定），强拒绝弹窗抛错走重试，校验提示归 needs_attention |
| ✅ | `070748` + 复跑 | 连续两轮 | `已确认草稿保存成功（发表页出现「已保存」提示）`，`draftVerified=true` | 收敛 |

## 终版方案要点

1. **点击类交互**一律 `clickSphShadow(page, selector)`：evaluate 内实时 `shadowRoot.querySelector` + `el.click()`（可 `focus`），带轮询重试——不用 `waitForSelector + ElementHandle.click`（wujie 重渲染会让它失效）
2. **文本输入**：点击聚焦 → 键盘全选清空 → 输入 → **回读校验**，未生效重试 3 次（#37 `fillKsDescription` 模式）
3. **存草稿判定**：6 秒窗口内全量文本找「已保存/保存成功」toast → verified；可见强拒绝弹窗（排除已知良性模板）→ 抛错走队列重试；「请先选择」类校验提示 → needs_attention（重试无用，不浪费上传）
4. **文本信号读取**：`readPageText` 递归 shadow root + 同源 iframe；可见弹窗判定用 checkVisibility + 尺寸 + 视口三重过滤

## 给其它 AI 的教训清单

1. **每轮只信证据**：截图、主进程诊断行、回执 JSON。本案例里"想当然"的两次（列表核对方案、接口核对设想）都被证据否掉
2. **假阳性比失败更危险**：run `064022` 自己的导航被误读成成功证据——验证手段本身可能制造假证据，务必设守卫（如 URL 路由检查）
3. **隐藏模板是文本匹配的天敌**：`textContent` 全量读会带出 display:none 的预渲染模板，纯文本正则校准信号前先做可见性过滤
4. **平台规则藏在报错里**：「请先选择」背后是"声明原创必须选标注""自行拍摄必须填拍摄地点"两级联动约束——逐轮把提示的**上下文**采集出来（`matchPatternWithContext`）才能定位
5. **先修"验证工具的盲区"再修业务**：第 3 轮发现文本全盲后，所有后续轮次的证据质量才成立
6. **删代码要清引用**（run `065940` 的 `switchedDraftTab is not defined`）
7. **CLI 契约细节**：`--phone` 必填；skip 回执只有 `resultStatus: "skipped"` 没有 `skipped` 字段；旧产物回执无 `draftVerified` 字段要先重建
8. **别打扰人**：流程内导航会触发 `will-prevent-unload` 二次确认弹窗（同步阻塞主进程）——自动化路径要么避免导航，要么先 `skipCloseConfirmation`
