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
  pickWeitoutiaoToolbarImageButton,
} from "../../../shared/ttWeitoutiaoDom.js";

const FILE_INPUT_POLL_STEP_MS = 400;
const IMAGE_PANEL_WAIT_MS = 12000;
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
  const selector = COMPOSER_SELECTORS.split(",")[0].trim();
  const filled = await page.evaluate(
    (sel, value) => {
      const el = document.querySelector(sel);
      if (!el) return false;
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
          new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" })
        );
        return String(el.value || "").trim().length > 0;
      }
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return String(el.textContent || "").trim().length > 0;
    },
    selector,
    content
  );
  if (!filled) {
    await page.click(selector);
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
    const nodes = document.querySelectorAll(
      "button, [role='button'], span, div, a"
    );
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

async function uploadFileThroughPolling(page, filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    const inputs = await page.$$('input[type="file"]');
    for (let i = inputs.length - 1; i >= 0; i -= 1) {
      const input = inputs[i];
      try {
        await input.uploadFile(filePath);
        await input.dispose();
        await page.waitForTimeout(1200);
        return true;
      } catch (e) {
        lastError = e?.message || String(e);
        await input.dispose().catch(() => {});
      }
    }
    await page.waitForTimeout(FILE_INPUT_POLL_STEP_MS);
  }
  throw new Error(lastError || "未找到可用的 file input");
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

async function uploadOneWeitoutiaoImage(page, filePath) {
  const abs = path.resolve(filePath);
  let panelContext = null;
  for (let attempt = 0; attempt < PANEL_OPEN_ATTEMPTS; attempt += 1) {
    await clickWeitoutiaoToolbarImage(page);
    await page.waitForTimeout(600);
    panelContext = await findInlineImageUploadPanelContext(page);
    if (panelContext) break;
    const inputCount = await page.$$eval('input[type="file"]', (els) => els.length);
    if (inputCount > 0) break;
  }

  let accepted = false;
  try {
    const chooserPromise = page.waitForFileChooser({ timeout: 15000 });
    if (panelContext) {
      await clickModalLocalUpload(page, panelContext);
    }
    const chooser = await chooserPromise;
    await chooser.accept([abs]);
    accepted = true;
  } catch (err) {
    console.warn(
      "[tt-weitoutiao] fileChooser 失败，尝试 input 回退:",
      err?.message || err
    );
  }

  if (!accepted) {
    if (panelContext) {
      try {
        await clickModalLocalUpload(page, panelContext);
      } catch (_) {}
    }
    await uploadFileThroughPolling(page, abs, IMAGE_PANEL_WAIT_MS);
  }

  for (const label of ["确定", "确认", "完成", "插入", "下一步", "使用"]) {
    await tryClickByTexts(page, [label]);
    await page.waitForTimeout(500);
  }
  await dismissUploadModals(page);
  console.log("[tt-weitoutiao] 已上传图片:", path.basename(filePath));
}

async function uploadWeitoutiaoImages(page, filePaths) {
  for (const filePath of filePaths) {
    try {
      await uploadOneWeitoutiaoImage(page, filePath);
    } catch (e) {
      console.warn(
        `[tt-weitoutiao] 配图上传失败（${path.basename(filePath)}）:`,
        e?.message || e
      );
    }
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
