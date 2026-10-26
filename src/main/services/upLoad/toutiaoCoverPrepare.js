"use strict";

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import {
  TT_COVER_MAX_BYTES,
  TT_COVER_MIN_HEIGHT,
  TT_COVER_MIN_WIDTH,
  meetsToutiaoCoverMinSize,
  scaleToMeetMinimum,
} from "../../../shared/toutiaoCover.js";

function loadNativeImage() {
  try {
    // eslint-disable-next-line global-require
    const { nativeImage } = require("electron");
    return nativeImage;
  } catch {
    return null;
  }
}

function readImageSize(nativeImage, filePath) {
  const img = nativeImage.createFromPath(filePath);
  if (!img || img.isEmpty()) return null;
  return img.getSize();
}

function writeUpscaledPng(nativeImage, sourcePath, destPath, targetSize) {
  const img = nativeImage.createFromPath(sourcePath);
  if (!img || img.isEmpty()) {
    throw new Error("无法读取封面源图");
  }
  let out = img;
  const size = img.getSize();
  if (
    !meetsToutiaoCoverMinSize(size.width, size.height) ||
    size.width !== targetSize.width ||
    size.height !== targetSize.height
  ) {
    out = img.resize({
      width: targetSize.width,
      height: targetSize.height,
      quality: "best",
    });
  }
  let buffer = out.toPNG();
  if (buffer.length > TT_COVER_MAX_BYTES) {
    buffer = out.toJPEG(85);
    if (buffer.length > TT_COVER_MAX_BYTES) {
      buffer = out.toJPEG(70);
    }
    const jpegPath = destPath.replace(/\.png$/i, ".jpg");
    fs.writeFileSync(jpegPath, buffer);
    return jpegPath;
  }
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

function tryFfmpegFrame(videoPath, outputPath) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "1",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-y",
      outputPath,
    ],
    { timeout: 45000 }
  );
  return (
    result.status === 0 &&
    fs.existsSync(outputPath) &&
    fs.statSync(outputPath).size > 0
  );
}

/**
 * 生成满足头条最低分辨率的封面文件路径（可能为临时文件）。
 * @returns {Promise<{ path: string, cleanup?: () => void } | null>}
 */
export async function prepareToutiaoCoverFile({
  videoPath,
  coverPath,
  tempDir,
  nativeImage = loadNativeImage(),
  fsImpl = fs,
} = {}) {
  if (!nativeImage) return null;

  const workDir =
    tempDir ||
    fsImpl.mkdtempSync(path.join(os.tmpdir(), "mm-tt-cover-"));
  const cleanup =
    tempDir == null
      ? () => {
          try {
            fsImpl.rmSync(workDir, { recursive: true, force: true });
          } catch (_) {
            /* ignore */
          }
        }
      : undefined;

  let sourcePath = coverPath && fsImpl.existsSync(coverPath) ? coverPath : "";
  if (!sourcePath) {
    const framePath = path.join(workDir, "frame.png");
    if (videoPath && fsImpl.existsSync(videoPath) && tryFfmpegFrame(videoPath, framePath)) {
      sourcePath = framePath;
    }
  }
  if (!sourcePath) {
    cleanup?.();
    return null;
  }

  const size = readImageSize(nativeImage, sourcePath);
  if (!size) {
    cleanup?.();
    return null;
  }

  const target = meetsToutiaoCoverMinSize(size.width, size.height)
    ? { width: size.width, height: size.height }
    : scaleToMeetMinimum(size.width, size.height, TT_COVER_MIN_WIDTH, TT_COVER_MIN_HEIGHT);

  const outPath = path.join(workDir, "toutiao-cover.png");
  try {
    const finalPath = writeUpscaledPng(nativeImage, sourcePath, outPath, target);
    return { path: finalPath, cleanup };
  } catch (e) {
    console.warn("[tt] 生成头条封面失败:", e?.message || e);
    cleanup?.();
    return null;
  }
}
