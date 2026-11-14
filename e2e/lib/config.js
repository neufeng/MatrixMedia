"use strict";

/**
 * e2e 运行环境探测：应用可执行文件、数据目录、产物目录。
 * 全部支持环境变量 / CLI 参数覆盖，便于 CI 与多机环境。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const MAC_APP_CANDIDATES = [
  "/Applications/matrixmedia.app/Contents/MacOS/matrixmedia",
  path.join(os.homedir(), "Applications", "matrixmedia.app", "Contents", "MacOS", "matrixmedia"),
];

const WIN_APP_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || "", "Programs", "matrixmedia", "matrixmedia.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Programs", "矩媒", "矩媒.exe"),
];

const FFMPEG_CANDIDATES = [
  process.env.MM_FFMPEG,
  "/usr/local/bin/ffmpeg",
  "/opt/homebrew/bin/ffmpeg",
  path.join(os.homedir(), ".local", "bin", "ffmpeg"),
].filter(Boolean);

/** 定位矩媒应用可执行文件（CLI 模式入口） */
function detectAppBin(override) {
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`--app 指定的应用不存在: ${override}`);
    }
    return override;
  }
  const candidates =
    process.platform === "darwin" ? MAC_APP_CANDIDATES : WIN_APP_CANDIDATES;
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error(
    "未找到矩媒应用，请先安装，或用 --app 指定可执行文件路径\n" +
      "（macOS 示例：/Applications/matrixmedia.app/Contents/MacOS/matrixmedia）"
  );
}

/** 定位 ffmpeg（用于生成测试视频，真实发布不需要重编码） */
function detectFfmpeg() {
  for (const c of FFMPEG_CANDIDATES) {
    try {
      require("child_process").execFileSync(c, ["-version"], { stdio: "ignore" });
      return c;
    } catch (_) {
      /* try next */
    }
  }
  return "";
}

/** 应用持久化数据根目录（与主进程 app.getPath("documents")/MatrixMedia 一致） */
function dataRoot() {
  return path.join(os.homedir(), "Documents", "MatrixMedia");
}

function pushDataDir() {
  return path.join(dataRoot(), "data", "pushData");
}

function failScreenshotDir() {
  return path.join(dataRoot(), "fail-screenshots");
}

function artifactsRoot() {
  return path.join(__dirname, "..", "artifacts");
}

/**
 * 从源码 ptConfig.js 读取各平台内容管理页地址（草稿在管理页的草稿 tab 下）。
 * ptConfig 是 ESM 源文件，这里动态 import；失败时返回空表，仅影响人工核对提示。
 */
async function loadPlatformManagePages() {
  try {
    const p = path.join(__dirname, "..", "..", "src", "main", "config", "ptConfig.js");
    const mod = await import(pathToFileURL(p).href);
    const cfg = mod.default || {};
    const map = {};
    for (const [name, v] of Object.entries(cfg)) {
      map[name] = (v && v.listIndex) || "";
    }
    return map;
  } catch (_) {
    return {};
  }
}

/** 项目根目录（e2e 以本地开发模式跑时的 cwd） */
function projectRoot() {
  return path.join(__dirname, "..", "..");
}

/** 本地构建产物的主进程入口（yarn build:dir 产出） */
function distMainPath() {
  return path.join(projectRoot(), "dist", "electron", "main.js");
}

/** 本地开发模式的 electron 可执行文件（npm electron 包导出二进制路径） */
function localElectronBin() {
  try {
    const p = require("electron");
    if (typeof p === "string" && fs.existsSync(p)) return p;
  } catch (_) {
    /* electron 未安装 */
  }
  return "";
}

/** 是否有 yarn dev 会话在跑（会争用 dist 产物与 5858 调试端口） */
function isDevRunnerRunning() {
  try {
    require("child_process").execSync("pgrep -f dev-runner.js", {
      stdio: "ignore",
    });
    return true;
  } catch (_) {
    return false;
  }
}

/** dist/electron/main.js 是否比 src/main + src/shared 旧（缺构建或源码有更新） */
function isDistStale() {
  const distMain = distMainPath();
  if (!fs.existsSync(distMain)) return true;
  const distMtime = fs.statSync(distMain).mtimeMs;
  let newest = 0;
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      if (f === "node_modules") continue;
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.mtimeMs > newest) newest = st.mtimeMs;
    }
  };
  for (const d of ["src/main", "src/shared"]) {
    walk(path.join(projectRoot(), d));
  }
  return newest > distMtime;
}

module.exports = {
  detectAppBin,
  detectFfmpeg,
  dataRoot,
  pushDataDir,
  failScreenshotDir,
  artifactsRoot,
  loadPlatformManagePages,
  projectRoot,
  distMainPath,
  localElectronBin,
  isDevRunnerRunning,
  isDistStale,
};
