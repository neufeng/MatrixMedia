"use strict";

/**
 * 发布自动化窗口的出声策略（仅影响播放输出，不修改素材文件、不做转码）。
 *
 * - Electron：BrowserWindow.webContents.setAudioMuted(true)
 * - 页面内：<video>/<audio> 默认 muted + 监听动态插入（平台上传后预览常自动 play）
 *
 * 平台仍可播放画面用于上传/转码进度检测；用户不会在系统扬声器听到声音。
 */

/** 注入到发布页（含后续导航的新文档） */
export const PUBLISH_PAGE_AUDIO_MUTE_BOOTSTRAP = `(() => {
  if (window.__mmPublishAudioMuted) return;
  window.__mmPublishAudioMuted = true;
  const apply = (el) => {
    if (!el || (el.tagName !== "VIDEO" && el.tagName !== "AUDIO")) return;
    try {
      el.muted = true;
      el.defaultMuted = true;
      el.setAttribute("muted", "");
      if (typeof el.volume === "number") el.volume = 0;
    } catch (_) {
      /* ignore */
    }
  };
  const scan = () => {
    try {
      document.querySelectorAll("video,audio").forEach(apply);
    } catch (_) {
      /* ignore */
    }
  };
  scan();
  try {
    const obs = new MutationObserver(() => scan());
    const root = document.documentElement || document.body;
    if (root) obs.observe(root, { childList: true, subtree: true });
  } catch (_) {
    /* ignore */
  }
})();`;

/** 供单测：确认注入脚本不包含改文件/转码类关键字 */
export const FORBIDDEN_SNIPPET_MARKERS = [
  "ffmpeg",
  "writeFile",
  "unlink",
  "createWriteStream",
  "transcode",
];