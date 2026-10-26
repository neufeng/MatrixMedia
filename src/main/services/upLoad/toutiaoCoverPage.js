"use strict";

import fs from "fs";
import {
  isToutiaoLowResCoverHint,
  pageTextSuggestsLowToutiaoCover,
  parseResolutionPair,
} from "../../../shared/toutiaoCover.js";
import { WAIT_SELECTOR_APPEAR_MS } from "./uploadTimeouts.js";

export async function readToutiaoCoverHintFromPage(page) {
  try {
    return await page.evaluate(() => {
      const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
      const chunks = [];
      const selectors = [
        ".form-item-poster",
        ".video-form-item-control",
        ".xigua-poster-editor",
        ".byte-modal",
        ".Dialog-container",
        "body",
      ];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const t = norm(el.textContent);
          if (t && (t.includes("封面") || t.includes("618"))) chunks.push(t);
        });
      }
      return chunks.join("\n");
    });
  } catch {
    return "";
  }
}

export async function isToutiaoLowResCoverModalVisible(page) {
  try {
    return await page.evaluate(() => {
      const norm = (t) => String(t || "").replace(/\s+/g, "").trim();
      const isLow = (raw) => {
        if (!raw) return false;
        if (raw.includes("上传更清晰的封面")) return true;
        if (raw.includes("替换封面") && raw.includes("分辨率")) return true;
        if (raw.includes("618") && raw.includes("1000")) return true;
        const m = raw.match(/(\d{2,5})\s*[×x*]\s*(\d{2,5})/i);
        if (m) {
          const w = parseInt(m[1], 10);
          const h = parseInt(m[2], 10);
          if (w > 0 && h > 0 && (w < 618 || h < 1000)) return true;
        }
        return false;
      };
      const modals = document.querySelectorAll(
        ".byte-modal, .Dialog-container, [role='dialog']"
      );
      for (const modal of modals) {
        const rect = modal.getBoundingClientRect();
        const style = window.getComputedStyle(modal);
        if (
          rect.width < 10 ||
          rect.height < 10 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          continue;
        }
        const text = norm(modal.textContent);
        if (isLow(text)) return true;
      }
      return false;
    });
  } catch {
    return false;
  }
}

export async function pageNeedsToutiaoCoverUpscale(page) {
  const text = await readToutiaoCoverHintFromPage(page);
  if (isToutiaoLowResCoverHint(text) || pageTextSuggestsLowToutiaoCover(text)) {
    return true;
  }
  const pair = parseResolutionPair(text);
  return pair ? pair.width < 618 || pair.height < 1000 : false;
}

async function clickButtonByTexts(page, texts, rootSelector) {
  return page.evaluate(
    ({ labels, rootSel }) => {
      const norm = (t) => String(t || "").replace(/\s+/g, "").trim();
      const root = rootSel ? document.querySelector(rootSel) : document;
      const scope = root || document;
      const nodes = scope.querySelectorAll(
        "button, .m-button, [role='button'], a, span"
      );
      for (const el of nodes) {
        const t = norm(el.textContent);
        if (!labels.some((l) => t === l || t.includes(l))) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        el.scrollIntoView({ block: "center", inline: "center" });
        el.click();
        return { ok: true, text: t };
      }
      return { ok: false };
    },
    { labels: texts, rootSel: rootSelector }
  );
}

export async function clickToutiaoReplaceCoverEntry(page) {
  const modalFirst = await clickButtonByTexts(page, ["替换封面"], ".byte-modal");
  if (modalFirst?.ok) return modalFirst;
  return clickButtonByTexts(page, ["替换封面", "上传封面", "本地上传"], null);
}

export async function uploadToutiaoCoverImage(page, filePath) {
  if (await isToutiaoLowResCoverModalVisible(page)) {
    await clickToutiaoReplaceCoverEntry(page);
    await page.waitForTimeout(800);
  }

  const triggerSelectors = [
    ".form-item-poster .fake-upload-trigger",
    ".video-form-item-control .fake-upload-trigger",
    ".xigua-poster-editor .fake-upload-trigger",
    ".fake-upload-trigger",
  ];
  for (const sel of triggerSelectors) {
    const handle = await page.$(sel);
    if (!handle) continue;
    await handle.evaluate((el) => el.click());
    await handle.dispose();
    await page.waitForTimeout(500);
    break;
  }

  const deadline = Date.now() + WAIT_SELECTOR_APPEAR_MS;
  while (Date.now() < deadline) {
    const inputs = await page.$$('input[type="file"]');
    for (const input of inputs) {
      try {
        await input.uploadFile(filePath);
        await input.dispose();
        return true;
      } catch (_) {
        await input.dispose();
      }
    }
    await page.waitForTimeout(400);
  }
  return false;
}

export async function captureToutiaoCoverPreviewToFile(page, outputPath, fsImpl = fs) {
  const selectors = [
    ".form-item-poster img",
    ".xigua-poster-editor img",
    ".cover-preview img",
    ".video-form-item-control img",
  ];
  for (const sel of selectors) {
    const handle = await page.$(sel);
    if (!handle) continue;
    const box = await handle.boundingBox();
    await handle.dispose();
    if (!box || box.width < 8 || box.height < 8) continue;
    await page.screenshot({
      path: outputPath,
      type: "png",
      clip: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
    });
    if (fsImpl.existsSync(outputPath) && fsImpl.statSync(outputPath).size > 0) {
      return true;
    }
  }
  return false;
}

export async function confirmToutiaoCoverAfterUpload(page, clickReadyElement) {
  const nextSelector =
    "body .Dialog-container .m-poster-upgrade .footer .m-button.red, body .Dialog-container .footer .m-button.red";
  try {
    await clickReadyElement(page, nextSelector, "头条封面上传下一步", 8000);
  } catch (_) {
    /* 部分新版上传后直接进编辑器 */
  }
  await page.waitForTimeout(800);
  try {
    await clickReadyElement(
      page,
      ".base-content-wrap .btn-sure",
      "头条封面上传确认",
      8000
    );
  } catch (_) {
    await page.evaluate(() => {
      const el = document.querySelector(".base-content-wrap .btn-sure");
      if (el) el.click();
    });
  }
  await page.waitForTimeout(500);
  try {
    await clickReadyElement(
      page,
      ".Dialog-container .footer .m-button.red",
      "头条封面弹窗确认",
      8000
    );
  } catch (_) {
    await page.evaluate(() => {
      const el = document.querySelector(".Dialog-container .footer .m-button.red");
      if (el) el.click();
    });
  }
  await page.waitForTimeout(1000);
}
