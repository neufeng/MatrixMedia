"use strict";

import fs from "fs";
import path from "path";

const PKG_NAME = "matrix-video";
export const PROJECT_DATA_SUBDIR = "data";
export const FAIL_SCREENSHOTS_DIR = "fail-screenshots";

export function isInsideAsar(filePath) {
  return String(filePath || "").includes("app.asar");
}

export function legacyDocumentsWebDataDir(documentsPath) {
  return path.join(documentsPath, "web", "MatrixMedia", PROJECT_DATA_SUBDIR);
}

export function legacyDocumentsDataDir(documentsPath) {
  return path.join(documentsPath, "MatrixMedia", PROJECT_DATA_SUBDIR);
}

function readJsonIfExists(filePath, fsSync = fs) {
  try {
    if (!fsSync.existsSync(filePath)) return null;
    return JSON.parse(fsSync.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function findRepoRootFrom(startDir, fsSync = fs) {
  if (!startDir || isInsideAsar(startDir)) return null;
  let dir = path.resolve(startDir);
  for (let i = 0; i < 30; i += 1) {
    const pkgPath = path.join(dir, "package.json");
    if (fsSync.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fsSync.readFileSync(pkgPath, "utf8"));
        if (pkg && pkg.name === PKG_NAME) return dir;
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 解析 MatrixMedia 仓库根目录（可写数据落在 <root>/data）。
 * 不回落到文稿 Documents；无法解析时返回 null。
 */
export function resolveProjectRoot(options = {}) {
  const fsSync = options.fs || fs;

  const envRoot = String(process.env.MATRIXMEDIA_PROJECT_ROOT || "").trim();
  if (envRoot) {
    return path.resolve(envRoot);
  }

  const app = options.app;
  if (app && typeof app.getAppPath === "function") {
    const appPath = app.getAppPath();
    if (!isInsideAsar(appPath)) {
      const fromApp = findRepoRootFrom(appPath, fsSync);
      if (fromApp) return fromApp;
    }
    if (typeof app.getPath === "function") {
      const cfgPath = path.join(app.getPath("userData"), "project-data-root.json");
      const cfg = readJsonIfExists(cfgPath, fsSync);
      const configured = cfg && String(cfg.projectRoot || "").trim();
      if (configured) return path.resolve(configured);
    }
  }

  const moduleDir = options.moduleDir;
  if (moduleDir) {
    const fromModule = findRepoRootFrom(moduleDir, fsSync);
    if (fromModule) return fromModule;
  }

  const argv1 = options.argv1;
  if (argv1) {
    const fromArgv = findRepoRootFrom(path.dirname(path.resolve(argv1)), fsSync);
    if (fromArgv) return fromArgv;
  }

  return null;
}

function ensureParentWritable(targetDir, fsSync) {
  const parent = path.dirname(targetDir);
  try {
    fsSync.mkdirSync(parent, { recursive: true });
    fsSync.mkdirSync(targetDir, { recursive: true });
    const probe = path.join(targetDir, ".write-probe");
    fsSync.writeFileSync(probe, "ok");
    fsSync.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * 业务数据根目录：<项目根>/data
 * 可由 MATRIXMEDIA_DATA_DIR 显式覆盖（绝对路径）。
 */
export function resolveBusinessDataDir(options = {}) {
  const fsSync = options.fs || fs;
  const envData = String(process.env.MATRIXMEDIA_DATA_DIR || "").trim();
  if (envData) {
    const dataDir = path.resolve(envData);
    if (!ensureParentWritable(dataDir, fsSync)) {
      const err = new Error(`MATRIXMEDIA_DATA_DIR 不可写: ${dataDir}`);
      err.code = "MATRIXMEDIA_NO_DATA_ROOT";
      throw err;
    }
    return dataDir;
  }

  const root = resolveProjectRoot(options);
  if (!root) {
    const err = new Error(
      "无法确定项目根目录，业务数据不会写入文稿目录。请设置 MATRIXMEDIA_PROJECT_ROOT 或 MATRIXMEDIA_DATA_DIR；" +
        "若仅从 /Applications 启动且无仓库，请在 userData 配置 project-data-root.json（见 docs/data-directory.md）。"
    );
    err.code = "MATRIXMEDIA_NO_DATA_ROOT";
    throw err;
  }
  if (isInsideAsar(root)) {
    const err = new Error("检测到 app.asar 内路径，不能作为数据目录。请设置 MATRIXMEDIA_PROJECT_ROOT。");
    err.code = "MATRIXMEDIA_NO_DATA_ROOT";
    throw err;
  }
  const dataDir = path.join(root, PROJECT_DATA_SUBDIR);
  if (!ensureParentWritable(dataDir, fsSync)) {
    const err = new Error(`项目 data 目录不可写: ${dataDir}`);
    err.code = "MATRIXMEDIA_NO_DATA_ROOT";
    throw err;
  }
  return dataDir;
}

export function resolveFailScreenshotDir(options = {}) {
  const envData = String(process.env.MATRIXMEDIA_DATA_DIR || "").trim();
  if (envData) {
    return path.join(path.dirname(path.resolve(envData)), FAIL_SCREENSHOTS_DIR);
  }
  const root = resolveProjectRoot(options);
  if (!root) {
    return path.join(resolveBusinessDataDir(options), "..", FAIL_SCREENSHOTS_DIR);
  }
  return path.join(root, FAIL_SCREENSHOTS_DIR);
}