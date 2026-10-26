"use strict";

import path from "path";

/** 旧版：文档/MatrixMedia（Mac 上常见 ~/Documents/MatrixMedia） */
export const LEGACY_DOCUMENTS_APP_FOLDER = "MatrixMedia";

/** 新版：文档/web/MatrixMedia（与项目目录 ~/Documents/web/MatrixMedia 对齐） */
export const DOCUMENTS_APP_FOLDER_PARTS = ["web", "MatrixMedia"];

export const PERSISTENT_DATA_SUBDIR = "data";
export const FAIL_SCREENSHOTS_SUBDIR = "fail-screenshots";

export function joinDocumentsAppRoot(documentsPath) {
  return path.join(documentsPath, ...DOCUMENTS_APP_FOLDER_PARTS);
}

export function joinLegacyDocumentsAppRoot(documentsPath) {
  return path.join(documentsPath, LEGACY_DOCUMENTS_APP_FOLDER);
}

export function joinDocumentsDataDir(documentsPath) {
  return path.join(joinDocumentsAppRoot(documentsPath), PERSISTENT_DATA_SUBDIR);
}

export function joinDocumentsFailScreenshotDir(documentsPath) {
  return path.join(
    joinDocumentsAppRoot(documentsPath),
    FAIL_SCREENSHOTS_SUBDIR
  );
}

export function dirHasContent(dir, fs = require("fs")) {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * 将旧版 文档/MatrixMedia/{data,fail-screenshots} 复制到 文档/web/MatrixMedia/…
 * 仅在新目录为空且旧目录有内容时迁移；不删除旧目录。
 */
export function migrateLegacyDocumentsAppFolder(documentsPath, fs = require("fs")) {
  const legacyRoot = joinLegacyDocumentsAppRoot(documentsPath);
  const newRoot = joinDocumentsAppRoot(documentsPath);
  if (!fs.existsSync(legacyRoot)) return;

  for (const sub of [PERSISTENT_DATA_SUBDIR, FAIL_SCREENSHOTS_SUBDIR]) {
    const from = path.join(legacyRoot, sub);
    const to = path.join(newRoot, sub);
    if (!dirHasContent(from, fs) || dirHasContent(to, fs)) continue;
    try {
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) {
        const src = path.join(from, name);
        const dest = path.join(to, name);
        fs.cpSync(src, dest, { recursive: true });
      }
    } catch (e) {
      console.error(
        "MatrixMedia: 迁移文档目录 MatrixMedia → web/MatrixMedia 失败",
        sub,
        e
      );
    }
  }
}
