"use strict";

import { PUBLISH_PAGE_AUDIO_MUTE_BOOTSTRAP } from "../../shared/publishAudioPolicy.js";

/**
 * 发布任务专用：静音 BrowserWindow 系统音频输出（不改视频文件）。
 * @param {import('electron').BrowserWindow | null | undefined} win
 */
export function mutePublishBrowserWindow(win) {
  if (!win || (typeof win.isDestroyed === "function" && win.isDestroyed())) return;
  const wc = win.webContents;
  if (!wc || (typeof wc.isDestroyed === "function" && wc.isDestroyed())) return;
  try {
    wc.setAudioMuted(true);
  } catch (e) {
    console.warn("[publish-audio] setAudioMuted 失败:", e && e.message);
  }
}

/**
 * 发布页内媒体元素静音（与窗口级静音叠加，覆盖后续动态插入的 preview video）。
 * @param {import('puppeteer-core').Page | null | undefined} page
 */
export async function mutePublishPuppeteerPage(page) {
  if (!page || typeof page.evaluateOnNewDocument !== "function") return;
  try {
    await page.evaluateOnNewDocument(PUBLISH_PAGE_AUDIO_MUTE_BOOTSTRAP);
    await page.evaluate(PUBLISH_PAGE_AUDIO_MUTE_BOOTSTRAP);
  } catch (e) {
    console.warn("[publish-audio] 页面静音注入失败:", e && e.message);
  }
}

/** 真实 Chrome 发布（小红书）追加启动参数，仅静音输出 */
export const REAL_CHROME_MUTE_AUDIO_ARG = "--mute-audio";