# 业务数据目录（account / pushData）

## 当前位置

| 类型 | 路径 |
|------|------|
| 账号、发布历史等 | `<项目根>/data/` |
| 失败截图 | `<项目根>/fail-screenshots/` |
| xAI Key、定时任务、Cookie | **不变**：`~/Library/Application Support/matrix-video/`（`userData`） |

不再写入 `~/Documents/web/MatrixMedia/data`。

## 解析优先级

1. `MATRIXMEDIA_DATA_DIR` — 业务 `data` 的绝对路径（最高）
2. `MATRIXMEDIA_PROJECT_ROOT` — 仓库根，数据在 `<root>/data`
3. 从 Electron `app.getAppPath()`（非 asar）或主进程模块路径向上查找 `package.json`（`name: matrix-video`）
4. 仅当从 `/Applications` 运行且找不到仓库时：`~/Library/Application Support/matrix-video/project-data-root.json`：

```json
{ "projectRoot": "/Users/you/Documents/work/MatrixMedia" }
```

无法解析时进程会报错，**不会**回落到文稿目录。

## 从文稿目录迁移（手动，无备份）

先退出 MatrixMedia，避免双写：

```bash
cd /Users/steven/Documents/work/MatrixMedia
# 预演
node scripts/migrate-data-to-project.js --dry-run
# 移动（默认源：~/Documents/web/MatrixMedia/data）
node scripts/migrate-data-to-project.js
# 校验目标正确后，可选删除已迁走的源文件
node scripts/migrate-data-to-project.js --remove-source
```

遇同名但内容不同会退出码 `2`，不覆盖。不修改 JSON 内素材绝对路径。

## 开发与打包

- `yarn dev` / `electron .`：`app.getAppPath()` 一般为仓库根。
- 打包后从本机 `dist/mac-arm64` 启动且无仓库时，请设置 `MATRIXMEDIA_PROJECT_ROOT` 或 `project-data-root.json`。
- **旧安装包在未更新代码前仍写文稿目录**；需拉取本变更并重新构建后才会使用 `<项目根>/data`。