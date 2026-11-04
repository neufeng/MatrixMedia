import fs from "fs";
import path from "path";
import { clipboard } from "electron";
import maybeClosePublishWindow from "./closeWindow.js";
import { replyPublishFailure } from "./publishOutcome.js";
import { WAIT_SELECTOR_APPEAR_MS } from "./uploadTimeouts.js";
import {
  pageTextLooksLikeInlineImageUploadPanel,
  pickTtGraphicLocalUploadButton,
} from "../../../shared/ttGraphicUploadDom.js";
import {
  pageLooksLikeWeitoutiaoPublishPage,
  resolveWeitoutiaoAttachedImageCount,
  pageTextLooksLikeUploadModalStagingHint,
  pageTextLooksLikeWeitoutiaoUploadModalOpen,
  pickFreshWeitoutiaoPanelFileInput,
  pickWeitoutiaoToolbarImageButton,
  pickWeitoutiaoUploadModalConfirmButton,
  weitoutiaoFileInputDescriptorKey,
} from "../../../shared/ttWeitoutiaoDom.js";

const FILE_INPUT_POLL_STEP_MS = 400;
const IMAGE_PANEL_WAIT_MS = 15000;
const FILE_CHOOSER_TIMEOUT_MS = 20000;
const FILE_INPUT_POLL_TIMEOUT_MS = 20000;
const IMAGE_PREVIEW_VERIFY_MS = 20000;
const FILE_CHOOSER_ATTEMPTS = 2;
const UPLOAD_MODAL_CONFIRM_MS = 20000;
const UPLOAD_MODAL_CLOSE_WAIT_MS = 15000;
const PANEL_OPEN_ATTEMPTS = 4;

const COMPOSER_SELECTORS = [
  'textarea[placeholder*="新鲜事"]',
  'textarea[placeholder*="告诉大家"]',
  ".weitoutiao-editor textarea",
  ".publish-editor textarea",
  '[contenteditable="true"][data-placeholder*="新鲜事"]',
  '[contenteditable="true"]',
].join(", ");

function getErrorMessage(error) {
  if (!error) return "未知错误";
  return error.message || (typeof error === "string" ? error : String(error));
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeImagePaths(article, data) {
  const fromData = Array.isArray(article.imagePaths)
    ? article.imagePaths
    : Array.isArray(article.images)
      ? article.images
      : [];
  const merged = [...fromData];
  if (Array.isArray(data?.imagePaths)) merged.push(...data.imagePaths);
  const seen = new Set();
  const out = [];
  for (const item of merged) {
    const text = String(item || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const abs = path.resolve(text);
    if (!fs.existsSync(abs)) {
      throw new Error(`图片不存在: ${text}`);
    }
    out.push(abs);
  }
  return out;
}

function readWeitoutiaoContent(data) {
  const article = data.data || {};
  const direct = String(article.content || "");
  if (direct.trim()) return direct;

  const filePath =
    article.articleFilePath || article.contentFile || data.articleFilePath;
  if (!filePath) throw new Error("请填写正文（--content）或正文文件（--file）");

  const absolutePath = path.resolve(filePath);
  const ext = path.extname(absolutePath).toLowerCase();
  if (![".md", ".txt"].includes(ext)) {
    throw new Error("正文文件仅支持 .md 或 .txt");
  }
  const fileContent = fs.readFileSync(absolutePath, "utf-8");
  if (!String(fileContent || "").trim()) throw new Error("正文为空");
  return fileContent;
}

function modifierKeyForPlatform() {
  return process.platform === "darwin" ? "Meta" : "Control";
}

async function pasteText(page, text) {
  const originalClipboardText = clipboard.readText();
  const modifierKey = modifierKeyForPlatform();
  try {
    clipboard.writeText(text);
    await page.keyboard.down(modifierKey);
    await page.keyboard.press("KeyV");
  } finally {
    await page.keyboard.up(modifierKey).catch(() => {});
    clipboard.writeText(originalClipboardText);
  }
}

async function waitForWeitoutiaoComposer(page) {
  await page.waitForFunction(
    () => {
      const bodyText = document.body ? document.body.innerText : "";
      if (!/发布微头条|有什么新鲜事想告诉大家/.test(bodyText)) return false;
      const ta = document.querySelector(
        'textarea[placeholder*="新鲜事"], textarea[placeholder*="告诉大家"]'
      );
      if (ta) return true;
      const ce = document.querySelector('[contenteditable="true"]');
      return !!ce;
    },
    { timeout: WAIT_SELECTOR_APPEAR_MS }
  );
  await page.waitForSelector(COMPOSER_SELECTORS, {
    visible: true,
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });
}

async function fillComposer(page, content) {
  // 先 textarea，再 contenteditable；勿只点 COMPOSER_SELECTORS 第一项（线上多为 contenteditable）
  const filled = await page.evaluate((value) => {
    const candidates = [];
    const push = (el) => {
      if (el && !candidates.includes(el)) candidates.push(el);
    };
    document
      .querySelectorAll(
        'textarea[placeholder*="新鲜事"], textarea[placeholder*="告诉大家"], .weitoutiao-editor textarea, .publish-editor textarea'
      )
      .forEach(push);
    document
      .querySelectorAll(
        '[contenteditable="true"][data-placeholder*="新鲜事"], [contenteditable="true"]'
      )
      .forEach(push);
    for (const el of candidates) {
      try {
        el.focus();
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
          const proto =
            el.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) setter.call(el, value);
          else el.value = value;
          el.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              data: value,
              inputType: "insertText",
            })
          );
          if (String(el.value || "").trim().length > 0) return true;
        } else {
          el.textContent = value;
          el.dispatchEvent(new InputEvent("input", { bubbles: true }));
          if (String(el.textContent || el.innerText || "").trim().length > 0)
            return true;
        }
      } catch (_) {
        /* try next */
      }
    }
    return false;
  }, content);
  if (!filled) {
    const clicked = await page.evaluate(() => {
      const el =
        document.querySelector(
          'textarea[placeholder*="新鲜事"], textarea[placeholder*="告诉大家"]'
        ) ||
        document.querySelector(
          '[contenteditable="true"][data-placeholder*="新鲜事"]'
        ) ||
        document.querySelector('[contenteditable="true"]');
      if (!el) return false;
      el.click();
      el.focus();
      return true;
    });
    if (!clicked) {
      throw new Error(
        "未找到微头条正文编辑框（textarea 或 contenteditable）"
      );
    }
    await pasteText(page, content);
  }
  await page.waitForTimeout(500);
}

function listPageContexts(page) {
  const contexts = [page];
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) contexts.push(frame);
  }
  return contexts;
}

async function readContextBodyText(context) {
  try {
    return await context.evaluate(() =>
      document.body ? document.body.innerText : ""
    );
  } catch {
    return "";
  }
}

async function findInlineImageUploadPanelContext(page) {
  for (const ctx of listPageContexts(page)) {
    const text = await readContextBodyText(ctx);
    if (pageTextLooksLikeInlineImageUploadPanel(text)) return ctx;
  }
  return null;
}

async function collectToolbarImageClickCandidates(page) {
  return page.evaluate(() => {
    const norm = (v) => String(v || "").replace(/\s+/g, "").trim();
    const roots = [];
    const placeholders = document.querySelectorAll(
      'textarea[placeholder*="新鲜事"], textarea[placeholder*="告诉大家"]'
    );
    for (const ta of placeholders) {
      let p = ta.parentElement;
      for (let i = 0; i < 8 && p; i += 1) {
        roots.push(p);
        p = p.parentElement;
      }
    }
    if (!roots.length) roots.push(document.body);
    const out = [];
    const seen = new Set();
    for (const root of roots) {
      const nodes = root.querySelectorAll(
        "button, [role='button'], span, div, a, i"
      );
      for (const el of nodes) {
        const text = norm(el.textContent || "");
        if (text !== "图片" && !text.endsWith("图片")) continue;
        if (text.length > 6) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          text,
          width: rect.width,
          height: rect.height,
          tagName: el.tagName,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        });
      }
    }
    return out;
  });
}

async function clickWeitoutiaoToolbarImage(page) {
  const candidates = await collectToolbarImageClickCandidates(page);
  const picked = pickWeitoutiaoToolbarImageButton(candidates);
  if (!picked) {
    throw new Error("未找到微头条工具栏「图片」按钮");
  }
  await page.mouse.click(picked.x, picked.y);
  return true;
}

async function collectLocalUploadClickCandidates(context) {
  return context.evaluate(() => {
    const norm = (v) => String(v || "").replace(/\s+/g, "").trim();
    let panel = null;
    let panelArea = Infinity;
    for (const el of document.querySelectorAll(
      "[role='dialog'], .byte-modal, [class*='modal'], [class*='Modal'], [class*='drawer'], [class*='Drawer'], section, div"
    )) {
      const text = String(el.innerText || "");
      if (!/上传图片/.test(text) || !/本地上传/.test(text) || !/扫码上传/.test(text)) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 120) continue;
      const area = rect.width * rect.height;
      if (area < panelArea) {
        panelArea = area;
        panel = el;
      }
    }
    const scope = panel || document.body;
    const nodes = scope.querySelectorAll("button, [role='button'], span, div, a");
    const out = [];
    for (const el of nodes) {
      const text = norm(el.textContent || "");
      if (!text.includes("本地上传")) continue;
      const rect = el.getBoundingClientRect();
      out.push({
        text,
        width: rect.width,
        height: rect.height,
        tagName: el.tagName,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      });
    }
    return out;
  });
}

async function waitForInlineImageUploadPanel(page, timeoutMs = IMAGE_PANEL_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ctx = await findInlineImageUploadPanelContext(page);
    if (ctx) return ctx;
    await page.waitForTimeout(300);
  }
  return null;
}

async function collectWeitoutiaoImagePreviewProbe(page) {
  return page.evaluate(() => {
    const isUploadModalEl = (el) => {
      const modal = el.closest(
        "[role='dialog'], .byte-modal, [class*='modal'], [class*='Modal'], [class*='drawer'], [class*='Drawer']"
      );
      if (!modal) return false;
      const text = String(modal.innerText || "");
      return /本地上传/.test(text) && /扫码上传/.test(text);
    };

    const bodyText = document.body ? document.body.innerText : "";

    const composerRoots = new Set();
    const attachmentRoots = new Set();
    const pushRootChain = (el, target, depth = 8) => {
      if (!el) return;
      let p = el;
      for (let i = 0; i < depth && p; i += 1) {
        target.add(p);
        p = p.parentElement;
      }
    };

    document
      .querySelectorAll(
        'textarea[placeholder*="新鲜事"], textarea[placeholder*="告诉大家"], .weitoutiao-editor, .publish-editor, [contenteditable="true"]'
      )
      .forEach((el) => pushRootChain(el, composerRoots));

    const stripSelector =
      '[class*="image-list"], [class*="ImageList"], [class*="picture-list"], [class*="PictureList"], [class*="upload-list"], [class*="photo-list"], [class*="img-list"], [class*="picture"], [class*="Picture"], [class*="image-card"], [class*="ImageCard"]';
    document.querySelectorAll(stripSelector).forEach((el) => {
      pushRootChain(el, composerRoots);
      pushRootChain(el, attachmentRoots);
    });

    for (const el of document.querySelectorAll("div, span, p, section")) {
      const text = String(el.textContent || "");
      if (!/共\s*\d+\s*张/.test(text) || !/还能上传/.test(text)) continue;
      pushRootChain(el, attachmentRoots, 6);
      pushRootChain(el.parentElement, attachmentRoots, 4);
    }

    const composerEl =
      document.querySelector(".weitoutiao-editor") ||
      document.querySelector(".publish-editor") ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('textarea[placeholder*="新鲜事"]');
    if (composerEl) {
      const card =
        composerEl.closest(
          ".weitoutiao-editor, .publish-editor, [class*='weitoutiao'], [class*='Weitoutiao'], [class*='editor-wrap'], [class*='Editor']"
        ) || composerEl.parentElement;
      if (card) pushRootChain(card, attachmentRoots, 3);
    }

    const containsRoot = (roots, node) => {
      for (const root of roots) {
        if (root.contains(node)) return true;
      }
      return false;
    };

    const pushCandidate = (node, rect, extra = {}) => {
      const inUploadModal = isUploadModalEl(node);
      const inComposer = containsRoot(composerRoots, node);
      const inImageStrip = !!node.closest?.(stripSelector);
      const inRichText = !!node.closest?.('[contenteditable="true"]');
      const inAttachmentBar =
        !inUploadModal &&
        (containsRoot(attachmentRoots, node) ||
          (inComposer && !inRichText && rect.width >= 36 && rect.height >= 36));
      return {
        width: rect.width,
        height: rect.height,
        src: String(node.currentSrc || node.src || "").slice(0, 120),
        inUploadModal,
        inComposer,
        inImageStrip,
        inRichText,
        inAttachmentBar,
        ...extra,
      };
    };

    const candidates = [];
    for (const img of document.querySelectorAll("img")) {
      const rect = img.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      candidates.push(pushCandidate(img, rect));
    }

    for (const el of document.querySelectorAll("div, span, li, a")) {
      const style = getComputedStyle(el);
      const bg = style.backgroundImage || "";
      if (!bg.includes("url(")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 36 || rect.height < 36) continue;
      candidates.push(
        pushCandidate(el, rect, { hasBackgroundImage: true, src: bg.slice(0, 120) })
      );
    }

    return { bodyText, candidates };
  });
}

async function readAttachedImagePreviewCount(page) {
  const probe = await collectWeitoutiaoImagePreviewProbe(page);
  return resolveWeitoutiaoAttachedImageCount(
    probe.candidates,
    probe.bodyText
  );
}

async function waitForAttachedImageCount(page, minCount, timeoutMs = IMAGE_PREVIEW_VERIFY_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await readAttachedImagePreviewCount(page);
    if (n >= minCount) return n;
    await page.waitForTimeout(500);
  }
  const finalCount = await readAttachedImagePreviewCount(page);
  throw new Error(
    `配图预览未出现（期望至少 ${minCount} 张，当前 ${finalCount} 张）`
  );
}

async function collectFileInputCandidates(context) {
  return context.evaluate(() => {
    let panel = null;
    let panelArea = Infinity;
    for (const el of document.querySelectorAll(
      "[role='dialog'], .byte-modal, [class*='modal'], [class*='Modal'], [class*='drawer'], [class*='Drawer'], section, div"
    )) {
      const text = String(el.innerText || "");
      if (!/上传图片/.test(text) || !/本地上传/.test(text) || !/扫码上传/.test(text)) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 120) continue;
      const area = rect.width * rect.height;
      if (area < panelArea) {
        panelArea = area;
        panel = el;
      }
    }
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.map((input, index) => ({
      index,
      inUploadPanel: !!(panel && panel.contains(input)),
      id: input.id || "",
      name: input.name || "",
      accept: input.accept || "",
    }));
  });
}

async function listPanelFileInputBaselineKeys(context) {
  const descriptors = await collectFileInputCandidates(context);
  return descriptors
    .filter((d) => d.inUploadPanel)
    .map((d) => weitoutiaoFileInputDescriptorKey(d));
}

function isMainFrameContext(page, context) {
  return context === page || context === page.mainFrame();
}

async function clickModalLocalUpload(page, panelContext = null) {
  const ctx = panelContext || (await findInlineImageUploadPanelContext(page)) || page;
  const candidates = await collectLocalUploadClickCandidates(ctx);
  const picked = pickTtGraphicLocalUploadButton(candidates);
  if (!picked) throw new Error("弹层内未找到「本地上传」");
  if (isMainFrameContext(page, ctx)) {
    // 与 ttGraphic 封面/正文一致：主文档用真实鼠标点击，便于触发系统 FileChooser
    await page.mouse.click(picked.x, picked.y);
    return picked;
  }
  await ctx.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const clickTarget =
        el?.closest('label, button, [role="button"], a') || el;
      const root =
        clickTarget?.closest("div, section, label, li") || clickTarget?.parentElement;
      const fileInput = root?.querySelector?.('input[type="file"]');
      if (fileInput) {
        const label = root?.querySelector?.(`label[for="${fileInput.id}"]`);
        if (label && typeof label.click === "function") {
          label.click();
          return;
        }
      }
      if (clickTarget) {
        clickTarget.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
        );
        if (typeof clickTarget.click === "function") clickTarget.click();
      }
    },
    { x: picked.x, y: picked.y }
  );
  return picked;
}

/**
 * 微头条真实路径：点「本地上传」→ 系统选文件 → accept（与 ttGraphic 正文配图相同）
 */
async function acceptLocalUploadViaFileChooser(page, panelContext, absPath) {
  const chooserPromise = page.waitForFileChooser({
    timeout: FILE_CHOOSER_TIMEOUT_MS,
  });
  await clickModalLocalUpload(page, panelContext);
  const chooser = await chooserPromise;
  await chooser.accept([absPath]);
}

async function dismissStuckNativeFileDialog(page) {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(250);
  }
}

async function uploadFreshPanelFileInput(
  page,
  filePath,
  timeoutMs,
  panelContext,
  baselineKeys
) {
  const ctx = panelContext || page;
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    const descriptors = await collectFileInputCandidates(ctx);
    const picked = pickFreshWeitoutiaoPanelFileInput(descriptors, baselineKeys);
    if (picked) {
      const handles = await ctx.$$('input[type="file"]');
      const input = handles[picked.index];
      if (input) {
        try {
          await input.uploadFile(filePath);
          await input.evaluate((el) => {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          });
          await input.dispose();
          for (const h of handles) {
            if (h !== input) await h.dispose().catch(() => {});
          }
          await page.waitForTimeout(1500);
          return true;
        } catch (e) {
          lastError = e?.message || String(e);
          await input.dispose().catch(() => {});
          for (const h of handles) await h.dispose().catch(() => {});
        }
      }
    }
    await page.waitForTimeout(FILE_INPUT_POLL_STEP_MS);
  }
  throw new Error(
    lastError
      ? `本地上传未挂载可用 file input（${lastError}）`
      : "本地上传未挂载可用 file input（超时）"
  );
}

async function tryClickByTexts(page, texts) {
  try {
    await clickButtonByTexts(page, texts);
    return true;
  } catch (_) {
    return false;
  }
}

async function clickButtonByTexts(page, texts) {
  const clicked = await page.evaluate((candidates) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, "").trim();
    const targets = candidates.map(normalize);
    const nodes = Array.from(
      document.querySelectorAll("button, .m-button, [role='button'], a, span, div")
    );
    for (const node of nodes) {
      const text = normalize(node.textContent);
      if (!text) continue;
      if (!targets.some((target) => text.includes(target))) continue;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        continue;
      }
      let target = node.closest("button, [role='button'], a, .m-button") || node;
      target.scrollIntoView({ block: "center", inline: "center" });
      if (typeof target.click === "function") target.click();
      else
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
        );
      return true;
    }
    return false;
  }, texts);
  if (!clicked) throw new Error(`未找到按钮: ${texts.join(" / ")}`);
}

async function readUploadModalProbe(page) {
  return page.evaluate(() => {
    const norm = (v) => String(v || "").replace(/\s+/g, "").trim();
    const bodyText = document.body ? document.body.innerText : "";
    let panel = null;
    let panelArea = Infinity;
    for (const el of document.querySelectorAll(
      "[role='dialog'], .byte-modal, [class*='modal'], [class*='Modal'], [class*='drawer'], [class*='Drawer'], section, div"
    )) {
      const text = String(el.innerText || "");
      if (!/上传图片/.test(text) || !/本地上传/.test(text) || !/扫码上传/.test(text)) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 120) continue;
      const area = rect.width * rect.height;
      if (area < panelArea) {
        panelArea = area;
        panel = el;
      }
    }
    const scope = panel || document.body;
    const confirmCandidates = [];
    for (const el of scope.querySelectorAll(
      "button, .m-button, [role='button'], a, span"
    )) {
      if (norm(el.textContent) !== "确定") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 48 || rect.height < 22 || rect.width > 260) continue;
      const tagName =
        el.tagName === "SPAN"
          ? el.closest("button, [role='button'], .m-button")?.tagName || el.tagName
          : el.tagName;
      confirmCandidates.push({
        text: "确定",
        width: rect.width,
        height: rect.height,
        tagName,
        top: rect.top,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      });
    }
    return { bodyText, confirmCandidates };
  });
}

async function isWeitoutiaoUploadModalOpen(page) {
  const probe = await readUploadModalProbe(page);
  return pageTextLooksLikeWeitoutiaoUploadModalOpen(probe.bodyText);
}

/**
 * 选图后点弹层 footer「确定」并等待弹层关闭（勿点页面其它「插入」、勿 Escape 丢图）
 */
async function confirmAndCloseWeitoutiaoUploadModal(page) {
  const deadline = Date.now() + UPLOAD_MODAL_CONFIRM_MS;
  let clickedOk = false;
  while (Date.now() < deadline) {
    const probe = await readUploadModalProbe(page);
    const modalOpen = pageTextLooksLikeWeitoutiaoUploadModalOpen(probe.bodyText);
    if (!modalOpen) {
      console.log("[tt-weitoutiao] 上传弹层已关闭");
      return;
    }

    const staging = pageTextLooksLikeUploadModalStagingHint(probe.bodyText);
    const picked = pickWeitoutiaoUploadModalConfirmButton(probe.confirmCandidates);
    if (staging && picked) {
      await page.mouse.click(picked.x, picked.y);
      clickedOk = true;
      console.log("[tt-weitoutiao] 已点击上传弹层 footer「确定」");
      await page.waitForTimeout(1500);
      const closeDeadline = Date.now() + UPLOAD_MODAL_CLOSE_WAIT_MS;
      while (Date.now() < closeDeadline) {
        if (!(await isWeitoutiaoUploadModalOpen(page))) {
          console.log("[tt-weitoutiao] 上传弹层已关闭");
          return;
        }
        await page.waitForTimeout(400);
      }
      continue;
    }

    await page.waitForTimeout(500);
  }

  if (await isWeitoutiaoUploadModalOpen(page)) {
    const probe = await readUploadModalProbe(page);
    const staging = pageTextLooksLikeUploadModalStagingHint(probe.bodyText);
    if (staging) {
      throw new Error(
        "上传弹层内已有待确认缩略图，但未能通过 footer「确定」插入编辑区（请勿 Escape 关闭）"
      );
    }
    throw new Error("上传弹层未能关闭");
  }
  if (!clickedOk) {
    throw new Error("未找到上传弹层 footer「确定」按钮");
  }
}

async function openWeitoutiaoImageUploadPanel(page) {
  let panelContext = null;
  for (let attempt = 0; attempt < PANEL_OPEN_ATTEMPTS; attempt += 1) {
    await clickWeitoutiaoToolbarImage(page);
    await page.waitForTimeout(600);
    const panelWaitMs =
      attempt >= PANEL_OPEN_ATTEMPTS - 1 ? IMAGE_PANEL_WAIT_MS : 5000;
    panelContext =
      (await waitForInlineImageUploadPanel(page, panelWaitMs)) ||
      (await findInlineImageUploadPanelContext(page));
    if (panelContext) return panelContext;
  }
  throw new Error("未能打开微头条「上传图片」弹层");
}

async function uploadOneWeitoutiaoImage(page, filePath, expectedPreviewCount) {
  const abs = path.resolve(filePath);
  const previewBefore = await readAttachedImagePreviewCount(page);
  const panelContext = await openWeitoutiaoImageUploadPanel(page);
  await page.waitForTimeout(400);

  let acceptedViaChooser = false;
  for (let attempt = 0; attempt < FILE_CHOOSER_ATTEMPTS; attempt += 1) {
    try {
      await acceptLocalUploadViaFileChooser(page, panelContext, abs);
      acceptedViaChooser = true;
      console.log(
        "[tt-weitoutiao] 系统选文件器已选图:",
        path.basename(filePath)
      );
      break;
    } catch (err) {
      console.warn(
        `[tt-weitoutiao] FileChooser 第 ${attempt + 1} 次失败:`,
        err?.message || err
      );
      await dismissStuckNativeFileDialog(page);
    }
  }

  if (acceptedViaChooser) {
    await page.waitForTimeout(2000);
    await confirmAndCloseWeitoutiaoUploadModal(page);
  } else {
    console.warn(
      "[tt-weitoutiao] FileChooser 不可用，最后手段：本地上传新挂载的弹层 file input"
    );
    const baselineKeys = await listPanelFileInputBaselineKeys(panelContext);
    await clickModalLocalUpload(page, panelContext);
    await page.waitForTimeout(800);
    await uploadFreshPanelFileInput(
      page,
      abs,
      FILE_INPUT_POLL_TIMEOUT_MS,
      panelContext,
      baselineKeys
    );
    await confirmAndCloseWeitoutiaoUploadModal(page);
  }

  if (await isWeitoutiaoUploadModalOpen(page)) {
    await confirmAndCloseWeitoutiaoUploadModal(page);
  }

  const minCount = Math.max(expectedPreviewCount, previewBefore + 1);
  const after = await waitForAttachedImageCount(page, minCount);
  console.log(
    "[tt-weitoutiao] 配图预览已确认:",
    path.basename(filePath),
    `预览 ${previewBefore}->${after}`
  );
}

async function uploadWeitoutiaoImages(page, filePaths) {
  let expected = 0;
  for (const filePath of filePaths) {
    expected += 1;
    await uploadOneWeitoutiaoImage(page, filePath, expected);
  }
  const finalCount = await readAttachedImagePreviewCount(page);
  if (finalCount < filePaths.length) {
    throw new Error(
      `配图数量不足：期望 ${filePaths.length} 张，编辑区可见 ${finalCount} 张`
    );
  }
}

async function clickWeitoutiaoPublish(page) {
  const clicked = await page.evaluate(() => {
    const norm = (v) => String(v || "").replace(/\s+/g, "").trim();
    const publishBtn = document.querySelector("button.publish-content");
    if (publishBtn) {
      publishBtn.scrollIntoView({ block: "center" });
      publishBtn.click();
      return "button.publish-content";
    }
    const nodes = Array.from(
      document.querySelectorAll("button, .m-button, [role='button']")
    );
    for (const node of nodes) {
      const text = norm(node.textContent);
      if (text.includes("定时")) continue;
      if (text !== "发布" && text !== "立即发布") continue;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (style.display === "none" || rect.width <= 0 || rect.height <= 0) continue;
      node.scrollIntoView({ block: "center" });
      node.click();
      return text;
    }
    return "";
  });
  if (!clicked) throw new Error("未找到「发布」按钮");
  console.log("[tt-weitoutiao] 已点击发布:", clicked);
}

function isDraftMode(data) {
  return data.publishMode === "draft" || data.publishToDraft === true;
}

export default async function publishToutiaoWeitoutiao(page, data, window, event) {
  let publishStage = "初始化";
  const draftMode = isDraftMode(data);
  try {
    publishStage = "等待编辑页";
    const bodyProbe = await page.evaluate(() =>
      document.body ? document.body.innerText.slice(0, 500) : ""
    );
    if (!pageLooksLikeWeitoutiaoPublishPage(bodyProbe)) {
      console.warn("[tt-weitoutiao] 页面文案未完全匹配，仍尝试继续");
    }
    await waitForWeitoutiaoComposer(page);

    publishStage = "读取正文";
    const content = readWeitoutiaoContent(data);
    const imagePaths = normalizeImagePaths(data.data || {}, data);

    publishStage = "填写正文";
    await fillComposer(page, content);

    if (imagePaths.length) {
      publishStage = "上传配图";
      await uploadWeitoutiaoImages(page, imagePaths);
    }

    await page.waitForTimeout(800);

    if (draftMode) {
      publishStage = "存草稿";
      if (await isWeitoutiaoUploadModalOpen(page)) {
        throw new Error("存草稿前上传弹层仍打开，配图可能未插入编辑区");
      }
      const saved = await tryClickByTexts(page, [
        "存草稿",
        "保存草稿",
        "存入草稿",
      ]);
      if (!saved) {
        console.log("[tt-weitoutiao] 未找到存草稿按钮，视为已填写内容");
      }
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: "头条微头条已保存草稿",
        publishMode: "draft",
        publishToDraft: true,
      });
    } else {
      publishStage = "发布";
      if (await isWeitoutiaoUploadModalOpen(page)) {
        throw new Error("发布前上传弹层仍打开，配图可能未插入编辑区");
      }
      await clickWeitoutiaoPublish(page);
      await page.waitForTimeout(2000);
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: "头条微头条发布成功",
        publishMode: "publish",
        publishToDraft: false,
      });
    }
    maybeClosePublishWindow(data, window);
  } catch (error) {
    const detail = getErrorMessage(error);
    console.error(`[tt-weitoutiao] 发布失败，阶段：${publishStage}`, error);
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message: `头条微头条发布失败：${publishStage} - ${detail}`,
    });
  }
}
