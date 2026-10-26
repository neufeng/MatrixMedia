import fs from "fs";
import path from "path";
import { clipboard } from "electron";
import maybeClosePublishWindow from "./closeWindow.js";
import { replyPublishFailure } from "./publishOutcome.js";
import { WAIT_SELECTOR_APPEAR_MS } from "./uploadTimeouts.js";

const TITLE_SELECTORS = [
  ".editor-title textarea",
  "textarea[placeholder*='标题']",
  "textarea[placeholder*='2～30']",
  "textarea[placeholder*='2~30']",
  "textarea[placeholder*='2-30']",
].join(", ");

const EDITOR_SELECTORS = [
  ".ProseMirror[contenteditable='true']",
  ".ProseMirror",
  ".publish-editor [contenteditable='true']",
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
  if (Array.isArray(data?.imagePaths)) {
    merged.push(...data.imagePaths);
  }
  const cover = firstText(article.coverPath, data?.coverPath);
  if (cover) merged.unshift(cover);
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

function readGraphicContent(data) {
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

async function pasteText(page, text) {
  const originalClipboardText = clipboard.readText();
  const modifierKey = process.platform === "darwin" ? "Meta" : "Control";
  try {
    clipboard.writeText(text);
    await page.keyboard.down(modifierKey);
    await page.keyboard.press("KeyV");
  } finally {
    await page.keyboard.up(modifierKey).catch(() => {});
    clipboard.writeText(originalClipboardText);
  }
}

async function setTitle(page, title) {
  await page.waitForSelector(TITLE_SELECTORS, {
    visible: true,
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });
  const ok = await page.evaluate(
    (selector, value) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      el.focus();
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
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return String(el.value || "").trim().length > 0;
    },
    TITLE_SELECTORS.split(",")[0].trim(),
    title
  );
  if (!ok) {
    await page.click(TITLE_SELECTORS.split(",")[0].trim(), { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type(TITLE_SELECTORS.split(",")[0].trim(), title, { delay: 30 });
  }
}

async function setProseMirrorContent(page, content) {
  await page.waitForSelector(EDITOR_SELECTORS, {
    visible: true,
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });
  const probe = String(content || "").trim().slice(0, 24);
  const filled = await page.evaluate(
    (selector, body, probeText) => {
      const editor = document.querySelector(selector);
      if (!editor) return false;
      editor.focus();
      const lines = String(body || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const html = (lines.length ? lines : [body])
        .map((line) => `<p>${line.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
        .join("");
      editor.innerHTML = "";
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertHTML", false, html);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      const text = String(editor.textContent || "").trim();
      return text.length > 0 && (!probeText || text.includes(probeText));
    },
    EDITOR_SELECTORS.split(",")[0].trim(),
    content,
    probe
  );
  if (!filled) {
    await page.click(EDITOR_SELECTORS.split(",")[0].trim());
    await pasteText(page, content);
  }
  await page.waitForTimeout(500);
}

async function uploadViaFileInputs(page, filePaths, label) {
  if (!filePaths.length) return;
  const selector = 'input[type="file"]';
  await page.waitForSelector(selector, { timeout: WAIT_SELECTOR_APPEAR_MS });
  for (const filePath of filePaths) {
    const inputs = await page.$$(selector);
    if (!inputs.length) throw new Error(`未找到${label} file input`);
    let uploaded = false;
    for (const input of inputs) {
      try {
        await input.uploadFile(filePath);
        uploaded = true;
        await page.waitForTimeout(1500);
        break;
      } catch (_) {
        /* 尝试下一个 input */
      }
    }
    if (!uploaded) throw new Error(`${label}上传失败: ${path.basename(filePath)}`);
    console.log(`[tt-graphic] 已上传${label}:`, path.basename(filePath));
  }
}

async function clickButtonByTexts(page, texts) {
  const clicked = await page.evaluate((candidates) => {
    const normalize = (value) =>
      String(value || "").replace(/\s+/g, "").trim();
    const targets = candidates.map(normalize);
    const nodes = Array.from(
      document.querySelectorAll(
        "button, .m-button, [role='button'], a, span, div"
      )
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
      if (
        node.getAttribute("disabled") != null ||
        node.getAttribute("aria-disabled") === "true"
      ) {
        continue;
      }
      node.scrollIntoView({ block: "center", inline: "center" });
      node.click();
      return true;
    }
    return false;
  }, texts);
  if (!clicked) throw new Error(`未找到按钮: ${texts.join(" / ")}`);
}

async function tryCheckPersonalOpinion(page) {
  await page.evaluate(() => {
    const normalize = (value) =>
      String(value || "").replace(/\s+/g, "").trim();
    const labels = Array.from(
      document.querySelectorAll("label, span, div, p")
    );
    for (const label of labels) {
      const text = normalize(label.textContent);
      if (!text.includes("个人观点") && !text.includes("仅供参考")) continue;
      const input =
        label.querySelector("input[type='checkbox']") ||
        label.closest("label")?.querySelector("input[type='checkbox']") ||
        label.parentElement?.querySelector("input[type='checkbox']");
      if (input && !input.checked) input.click();
    }
  });
}

function isGraphicDraftMode(data) {
  return data.publishMode === "draft" || data.publishToDraft === true;
}

async function fillTagsIfPresent(page, tagsText) {
  const tags = String(tagsText || "")
    .split(/[\s,，;；、#]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (!tags.length) return;
  const inputSelector =
    'input[placeholder*="标签"], input[placeholder*="话题"], .tag-input input';
  const hasInput = await page.$(inputSelector);
  if (!hasInput) {
    console.log("[tt-graphic] 未找到标签输入框，跳过标签");
    return;
  }
  for (const tag of tags.slice(0, 5)) {
    await page.click(inputSelector);
    await page.keyboard.type(tag, { delay: 40 });
    await page.waitForTimeout(800);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  }
}

export default async function publishToutiaoGraphic(page, data, window, event) {
  let publishStage = "初始化";
  const draftMode = isGraphicDraftMode(data);
  try {
    const article = data.data || {};
    const title = firstText(article.title, article.bt1, data.bt);
    if (!title) throw new Error("请填写标题（2～30 字）");
    if (title.length < 2 || title.length > 30) {
      throw new Error("头条图文标题需 2～30 个字");
    }

    publishStage = "读取正文";
    const content = readGraphicContent(data);
    const imagePaths = normalizeImagePaths(article, data);
    const coverPath = firstText(
      article.coverPath,
      data.coverPath,
      imagePaths[0] || ""
    );
    const inlineImages =
      coverPath && imagePaths.length
        ? imagePaths.filter((p) => path.resolve(p) !== path.resolve(coverPath))
        : imagePaths;

    publishStage = "填写标题";
    await setTitle(page, title);
    publishStage = "填写正文";
    await setProseMirrorContent(page, content);

    if (inlineImages.length) {
      publishStage = "上传正文配图";
      await uploadViaFileInputs(page, inlineImages, "正文配图");
    }

    if (coverPath) {
      publishStage = "上传封面";
      await uploadViaFileInputs(page, [coverPath], "封面");
    }

    publishStage = "填写标签";
    await fillTagsIfPresent(
      page,
      firstText(article.tags, article.bq, data.tags, data.bq)
    );

    publishStage = "勾选声明";
    await tryCheckPersonalOpinion(page);

    await page.waitForTimeout(800);
    if (draftMode) {
      publishStage = "存草稿";
      await clickButtonByTexts(page, [
        "存草稿",
        "保存草稿",
        "保存至草稿",
        "存入草稿",
      ]);
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: "头条图文已保存草稿",
        publishMode: "draft",
        publishToDraft: true,
      });
    } else {
      publishStage = "预览并发布";
      await clickButtonByTexts(page, ["预览并发布", "发布"]);
      await page.waitForTimeout(1200);

      publishStage = "确认发布";
      await clickButtonByTexts(page, ["确认发布", "立即发布"]);

      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: "头条图文发布成功",
        publishMode: "publish",
        publishToDraft: false,
      });
    }
    maybeClosePublishWindow(data, window);
  } catch (error) {
    const detail = getErrorMessage(error);
    console.error(`[tt-graphic] 发布失败，阶段：${publishStage}`, error);
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message: `头条图文发布失败：${publishStage} - ${detail}`,
    });
  }
}
