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
  countWeitoutiaoAttachedImagePreviews,
  pageLooksLikeWeitoutiaoPublishPage,
  pickWeitoutiaoToolbarImageButton,
  pickWeitoutiaoUploadFileInputCandidate,
} from "../../../shared/ttWeitoutiaoDom.js";

const FILE_INPUT_POLL_STEP_MS = 400;
const IMAGE_PANEL_WAIT_MS = 15000;
const FILE_CHOOSER_TIMEOUT_MS = 20000;
const FILE_INPUT_POLL_TIMEOUT_MS = 20000;
const IMAGE_PREVIEW_VERIFY_MS = 20000;
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

async function collectWeitoutiaoImagePreviewCandidates(page) {
  return page.evaluate(() => {
    const isUploadModal = (el) => {
      const modal = el.closest(
        "[role='dialog'], .byte-modal, [class*='modal'], [class*='Modal'], [class*='drawer'], [class*='Drawer']"
      );
      if (!modal) return false;
      const text = String(modal.innerText || "");
      return /本地上传/.test(text) && /扫码上传/.test(text);
    };

    const composerRoots = new Set();
    const pushRoot = (el) => {
      if (!el) return;
      let p = el;
      for (let i = 0; i < 8 && p; i += 1) {
        composerRoots.add(p);
        p = p.parentElement;
      }
    };
    document
      .querySelectorAll(
        'textarea[placeholder*="新鲜事"], textarea[placeholder*="告诉大家"], .weitoutiao-editor, .publish-editor, [contenteditable="true"]'
      )
      .forEach(pushRoot);

    const stripSelector =
      '[class*="image-list"], [class*="ImageList"], [class*="picture-list"], [class*="PictureList"], [class*="upload-list"], [class*="photo-list"], [class*="img-list"]';
    document.querySelectorAll(stripSelector).forEach(pushRoot);

    const out = [];
    for (const img of document.querySelectorAll("img")) {
      const rect = img.getBoundingClientRect();
      let inComposer = false;
      for (const root of composerRoots) {
        if (root.contains(img)) {
          inComposer = true;
          break;
        }
      }
      const inImageStrip = !!img.closest(stripSelector);
      out.push({
        width: rect.width,
        height: rect.height,
        src: String(img.currentSrc || img.src || "").slice(0, 120),
        inUploadModal: isUploadModal(img),
        inComposer,
        inImageStrip,
      });
    }
    return out;
  });
}

async function readAttachedImagePreviewCount(page) {
  const candidates = await collectWeitoutiaoImagePreviewCandidates(page);
  return countWeitoutiaoAttachedImagePreviews(candidates);
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
      accept: input.accept || "",
    }));
  });
}

async function clickModalLocalUpload(page, panelContext = null) {
  const ctx = panelContext || (await findInlineImageUploadPanelContext(page)) || page;
  const candidates = await collectLocalUploadClickCandidates(ctx);
  const picked = pickTtGraphicLocalUploadButton(candidates);
  if (!picked) throw new Error("弹层内未找到「本地上传」");
  await ctx.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const clickTarget = el?.closest("button, [role='button'], a") || el;
      if (clickTarget) {
        clickTarget.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
        );
        if (typeof clickTarget.click === "function") clickTarget.click();
      }
    },
    { x: picked.x, y: picked.y }
  );
}

async function uploadFileThroughPolling(page, filePath, timeoutMs, panelContext = null) {
  const ctx = panelContext || page;
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  let sawAny = false;
  let emptyStreak = 0;
  while (Date.now() < deadline) {
    const descriptors = await collectFileInputCandidates(ctx);
    if (!descriptors.length) {
      emptyStreak += 1;
      if (!sawAny && emptyStreak * FILE_INPUT_POLL_STEP_MS >= 8000) {
        throw new Error("未找到可用的 file input（上传弹层未挂载）");
      }
    } else {
      emptyStreak = 0;
      sawAny = true;
    }
    const picked = pickWeitoutiaoUploadFileInputCandidate(descriptors, {
      requireInPanel: !!panelContext,
    });
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
      ? `未找到可用的 file input（${lastError}）`
      : "未找到可用的 file input"
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

async function dismissUploadModals(page) {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    const still = await page.evaluate(() => {
      const text = document.body ? document.body.innerText : "";
      return /本地上传/.test(text) && /扫码上传/.test(text);
    });
    if (!still) return;
  }
}

async function confirmWeitoutiaoImageUploadModal(page) {
  for (const label of ["确定", "确认", "完成", "插入", "下一步", "使用"]) {
    const ok = await tryClickByTexts(page, [label]);
    if (ok) {
      console.log("[tt-weitoutiao] 配图弹层确认:", label);
      await page.waitForTimeout(800);
    }
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

  let accepted = false;
  try {
    const chooserPromise = page.waitForFileChooser({
      timeout: FILE_CHOOSER_TIMEOUT_MS,
    });
    await clickModalLocalUpload(page, panelContext);
    const chooser = await chooserPromise;
    await chooser.accept([abs]);
    accepted = true;
    console.log("[tt-weitoutiao] fileChooser 已接受:", path.basename(filePath));
    await page.waitForTimeout(2000);
    await confirmWeitoutiaoImageUploadModal(page);
  } catch (err) {
    console.warn(
      "[tt-weitoutiao] fileChooser 失败，尝试 input 回退:",
      err?.message || err
    );
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  if (!accepted) {
    try {
      await clickModalLocalUpload(page, panelContext);
    } catch (_) {
      /* 弹层可能仍打开 */
    }
    await page.waitForTimeout(800);
    await uploadFileThroughPolling(
      page,
      abs,
      FILE_INPUT_POLL_TIMEOUT_MS,
      panelContext
    );
    await confirmWeitoutiaoImageUploadModal(page);
  }

  await dismissUploadModals(page);
  for (let i = 0; i < 4; i += 1) {
    const still = await page.evaluate(() => {
      const text = document.body ? document.body.innerText : "";
      return /本地上传/.test(text) && /扫码上传/.test(text);
    });
    if (!still) break;
    await page.keyboard.press("Escape").catch(() => {});
    await dismissUploadModals(page);
    await page.waitForTimeout(400);
  }

  const minCount = Math.max(expectedPreviewCount, previewBefore + 1);
  const after = await waitForAttachedImageCount(page, minCount);
  console.log(
    "[tt-weitoutiao] 已上传图片:",
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
      await dismissUploadModals(page);
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
