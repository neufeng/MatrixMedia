"use strict";

/**
 * 测试视频 fixture：ffmpeg 生成 6 秒 720x1280 竖屏测试卡（含静音音轨）。
 * 体积极小（<200KB），走真实上传链路但不会占用平台空间配额。
 *
 * 编码器按 libx264 → h264_videotoolbox → mpeg4 依次回退，
 * 兼容受限构建的 ffmpeg（如仅启用 videotoolbox 的桌面版）。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ENCODER_FALLBACKS = [
  ["-c:v", "libx264", "-preset", "veryfast"],
  ["-c:v", "h264_videotoolbox"],
  ["-c:v", "mpeg4", "-q:v", "5"],
];

function generateWithFallback(ffmpegPath, outPath) {
  const baseArgs = [
    "-y",
    "-f", "lavfi",
    "-i", "testsrc2=size=720x1280:rate=24:duration=6",
    "-f", "lavfi",
    "-i", "anullsrc=r=44100:cl=mono",
    "-shortest",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
  ];
  const errors = [];
  for (const encoderArgs of ENCODER_FALLBACKS) {
    const r = spawnSync(ffmpegPath, [...baseArgs, ...encoderArgs, outPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (r.status === 0 && fs.existsSync(outPath)) return encoderArgs[1];
    errors.push(`${encoderArgs[1]}: ${String(r.stderr || "").slice(-200)}`);
    // 失败可能留下损坏文件，清掉再试下一个编码器
    try {
      fs.unlinkSync(outPath);
    } catch (_) {
      /* nothing to clean */
    }
  }
  throw new Error(
    `ffmpeg 生成测试视频失败（已尝试 ${ENCODER_FALLBACKS.length} 种编码器）：\n${errors.join("\n")}`
  );
}

function ensureVideo({ ffmpegPath, outPath, force = false }) {
  if (!ffmpegPath) {
    throw new Error(
      "未找到 ffmpeg，无法生成测试视频。请安装 ffmpeg，或用 --video 指定一个已有 mp4 文件"
    );
  }
  if (fs.existsSync(outPath) && !force) return outPath;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const encoder = generateWithFallback(ffmpegPath, outPath);
  console.log(`已生成测试视频（编码器 ${encoder}）: ${outPath}`);
  return outPath;
}

module.exports = { ensureVideo };
