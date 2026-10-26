import fs from "fs";
import path from "path";
import { clipboard } from "electron";
import maybeClosePublishWindow from "./closeWindow.js";
import { replyPublishFailure } from "./publishOutcome.js";
import { WAIT_SELECTOR_APPEAR_MS } from "./uploadTimeouts.js";

/** 打开上传弹层后，轮询 file input 的上限（单次上传步骤） */
const GRAPHIC_FILE_INPUT_POLL_MS = 90 * 1000;
const FILE_INPUT_POLL_STEP_MS = 400;

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

async function tryClickByTexts(page, texts) {
  try {
    await clickButtonByTexts(page, texts);
    return true;
  } catch (_) {
    return false;
  }
}

async function dismissAssistantOverlay(page) {
  await page.evaluate(() => {
    const norm = (value) => String(value || "").replace(/\s+/g, "").trim();
    const panels = document.querySelectorAll(
      "[class*='assistant'], [class*='Assistant'], [class*='creative-assist']"
    );
    for (const panel of panels) {
      const rect = panel.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 80) continue;
      const closeCandidates = panel.querySelectorAll(
        "button, [role='button'], span, i, svg"
      );
      for (const el of closeCandidates) {
        const label = norm(
          el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            el.textContent ||
            ""
        );
        if (
          label === "关闭" ||
          label === "收起" ||
          label.includes("关闭") ||
          label.includes("收起")
        ) {
          el.click();
          return;
        }
      }
    }
  });
}

/**
 * 短周期轮询 file input，避免 waitForSelector 长时间阻塞触发 protocolTimeout。
 */
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
        await page.waitForTimeout(1500);
        return true;
      } catch (e) {
        lastError = e?.message || String(e);
        await input.dispose().catch(() => {});
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

async function confirmImageUploadModal(page) {
  await tryClickByTexts(page, ["确定", "确认", "完成", "插入", "下一步"]);
  await page.waitForTimeout(600);
}

async function openInlineImageUploadDialog(page) {
  const editorSelector = EDITOR_SELECTORS.split(",")[0].trim();
  await page.click(editorSelector).catch(() => {});
  await page.waitForTimeout(300);

  const opened = await page.evaluate(() => {
    const norm = (value) => String(value || "").replace(/\s+/g, "").trim();
    const hints = ["插入图片", "图片", "添加图片", "image", "Image"];
    const toolbarRoots = Array.from(
      document.querySelectorAll(
        ".syl-toolbar, .editor-toolbar, .publish-editor-toolbar, [class*='toolbar']"
      )
    );
    const scopes = toolbarRoots.length ? toolbarRoots : [document.body];

    for (const scope of scopes) {
      const nodes = scope.querySelectorAll(
        "button, [role='button'], span, div, i"
      );
      for (const node of nodes) {
        const label = norm(
          node.getAttribute("aria-label") ||
            node.getAttribute("title") ||
            node.textContent ||
            ""
        );
        if (!label) continue;
        if (label.length > 24 && !node.getAttribute("aria-label")) continue;
        if (!hints.some((hint) => label.toLowerCase().includes(norm(hint).toLowerCase()))) {
          continue;
        }
        const rect = node.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        node.scrollIntoView({ block: "center", inline: "center" });
        node.click();
        return true;
      }
    }

    for (const scope of scopes) {
      const byClass = scope.querySelector(
        '[data-name="image"], [class*="image-btn"], button[class*="image"]'
      );
      if (byClass) {
        byClass.click();
        return true;
      }
    }
    return false;
  });

  if (!opened) {
    await tryClickByTexts(page, ["插入图片", "图片", "添加图片"]);
  }
  await page.waitForTimeout(500);
  await tryClickByTexts(page, [
    "本地上传",
    "上传图片",
    "本地图片",
    "电脑上传",
    "从本地上传",
  ]);

  const hasInput = await page.$('input[type="file"]');
  if (!hasInput) {
    await page.evaluate(() => {
      const bar = document.querySelector(
        ".syl-toolbar, .editor-toolbar, [class*='toolbar']"
      );
      if (!bar) return;
      const items = bar.querySelectorAll(
        ".syl-toolbar-button, button, [role='button'], span"
      );
      for (const item of items) {
        const hint = String(
          item.getAttribute("title") ||
            item.getAttribute("aria-label") ||
            item.textContent ||
            ""
        ).toLowerCase();
        if (hint.includes("图") || hint.includes("image")) {
          item.click();
          return;
        }
      }
      if (items.length >= 10) {
        items[9].click();
      }
    });
    await page.waitForTimeout(500);
    await tryClickByTexts(page, ["本地上传", "上传图片", "本地图片"]);
  }
}

async function openCoverUploadDialog(page) {
  await tryClickByTexts(page, ["发文设置"]);
  await page.waitForTimeout(800);

  await tryClickByTexts(page, [
    "封面设置",
    "封面",
    "添加封面",
    "上传封面",
    "设置封面",
    "单图",
  ]);

  const triggerSelectors = [
    ".article-cover .fake-upload-trigger",
    ".cover-container .fake-upload-trigger",
    ".form-item-poster .fake-upload-trigger",
    ".xigua-poster-editor .fake-upload-trigger",
    ".fake-upload-trigger",
    "[class*='cover'] [class*='upload']",
  ];
  for (const selector of triggerSelectors) {
    const handle = await page.$(selector);
    if (!handle) continue;
    await handle.evaluate((el) => el.click());
    await handle.dispose();
    await page.waitForTimeout(400);
    break;
  }

  await tryClickByTexts(page, [
    "本地上传",
    "上传封面",
    "替换封面",
    "从本地上传",
    "上传图片",
  ]);
}

async function uploadGraphicInlineImage(page, filePath) {
  await dismissAssistantOverlay(page);
  await openInlineImageUploadDialog(page);
  await uploadFileThroughPolling(page, filePath, GRAPHIC_FILE_INPUT_POLL_MS);
  await confirmImageUploadModal(page);
  console.log("[tt-graphic] 正文配图已上传:", path.basename(filePath));
}

async function uploadGraphicCover(page, filePath) {
  await dismissAssistantOverlay(page);
  await openCoverUploadDialog(page);
  await uploadFileThroughPolling(page, filePath, GRAPHIC_FILE_INPUT_POLL_MS);
  await confirmImageUploadModal(page);
  console.log("[tt-graphic] 封面已上传:", path.basename(filePath));
}

async function uploadInlineImagesResilient(page, filePaths, coverPath) {
  if (!filePaths.length) return;
  let successCount = 0;
  for (const filePath of filePaths) {
    try {
      await uploadGraphicInlineImage(page, filePath);
      successCount += 1;
    } catch (e) {
      console.warn(
        `[tt-graphic] 正文配图上传失败（${path.basename(filePath)}）:`,
        e?.message || e
      );
    }
  }
  if (successCount === 0 && !coverPath) {
    throw new Error("正文配图上传失败，且未提供封面");
  }
  if (successCount === 0 && coverPath) {
    console.warn(
      "[tt-graphic] 正文配图均未成功，将继续使用封面完成草稿/发布"
    );
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

    if (coverPath) {
      publishStage = "上传封面";
      await uploadGraphicCover(page, coverPath);
    }

    if (inlineImages.length) {
      publishStage = "上传正文配图";
      await uploadInlineImagesResilient(page, inlineImages, coverPath);
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
