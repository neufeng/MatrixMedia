import fs from "fs";
import path from "path";
import { clipboard, nativeImage } from "electron";
import maybeClosePublishWindow from "./closeWindow.js";
import { replyPublishFailure } from "./publishOutcome.js";
import { WAIT_SELECTOR_APPEAR_MS } from "./uploadTimeouts.js";

/** 打开上传弹层后，轮询 file input 的上限（单次上传步骤） */
const GRAPHIC_FILE_INPUT_POLL_MS = 90 * 1000;
const FILE_INPUT_POLL_STEP_MS = 400;
/** 头条图文页无「存草稿」按钮，需等待底部自动保存状态 */
const DRAFT_AUTO_SAVE_WAIT_MS = 120 * 1000;
/** Mac 实测：展示封面「+」常需 2～3 次才出现本地上传 / #upload-drag-input */
const COVER_MODAL_OPEN_ATTEMPTS = 4;

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
  let sawAny = false;
  let emptyStreak = 0;
  while (Date.now() < deadline) {
    const inputs = await page.$$('input[type="file"]');
    if (!inputs.length) {
      emptyStreak += 1;
      if (!sawAny && emptyStreak * FILE_INPUT_POLL_STEP_MS >= 8000) {
        throw new Error("未找到可用的 file input");
      }
    } else {
      emptyStreak = 0;
      sawAny = true;
    }
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


async function uploadViaFileChooserOrInput(page, filePath, openDialogFn) {
  const abs = path.resolve(filePath);
  // Prefer native file chooser (Toutiao often has no pre-existing input)
  let opened = false;
  try {
    const chooserPromise = page
      .waitForFileChooser({ timeout: 12000 })
      .catch((err) => {
        return { __chooserError: err };
      });
    await openDialogFn();
    opened = true;
    const chooser = await chooserPromise;
    if (chooser && !chooser.__chooserError) {
      await chooser.accept([abs]);
      await page.waitForTimeout(1500);
      await confirmImageUploadModal(page);
      return;
    }
    console.warn(
      "[tt-graphic] fileChooser 不可用，回退 input 轮询:",
      chooser && chooser.__chooserError
        ? chooser.__chooserError.message
        : "no chooser"
    );
  } catch (chooserErr) {
    console.warn(
      "[tt-graphic] fileChooser 流程异常，回退 input 轮询:",
      chooserErr && chooserErr.message ? chooserErr.message : chooserErr
    );
  }
  if (!opened) {
    await openDialogFn();
  }
  // 「+」点开后可能稍晚才挂上 input
  await page.waitForTimeout(800);
  const inputCount = await page.$$eval('input[type="file"]', (els) => els.length);
  console.log("[tt-graphic] 当前 file input 数量:", inputCount);
  await uploadFileThroughPolling(page, abs, GRAPHIC_FILE_INPUT_POLL_MS);
  await confirmImageUploadModal(page);
  await dismissUploadModals(page);
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

  await page.waitForTimeout(500);
  console.log("[tt-graphic] 插图弹层已打开，等待点击本地上传");
}

async function openCoverUploadDialog(page) {
  // 滚到「展示封面」区域
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("div, section, label, span"));
    for (const el of all) {
      const t = String(el.textContent || "").replace(/\s+/g, "");
      if (t.includes("展示封面") && t.length < 40) {
        el.scrollIntoView({ block: "center" });
        return;
      }
    }
  });
  await page.waitForTimeout(400);
  await tryClickByTexts(page, ["单图"]);
  await page.waitForTimeout(300);

  // 只点「展示封面」附近的大号「+」上传框
  const plus = await page.evaluate(() => {
    const norm = (v) => String(v || "").replace(/\s+/g, "").trim();
    // 找到包含展示封面的容器
    let root = null;
    for (const el of document.querySelectorAll("div, section")) {
      const t = norm(el.textContent).slice(0, 80);
      if (t.includes("展示封面") && (t.includes("单图") || t.includes("三图") || t.includes("无封面"))) {
        root = el;
        break;
      }
    }
    const scope = root || document.body;
    const nodes = scope.querySelectorAll(
      "button, [role='button'], div, span, .fake-upload-trigger, [class*='upload'], [class*='plus'], [class*='add'], [class*='cover']"
    );
    const candidates = [];
    for (const el of nodes) {
      const label = norm(el.getAttribute("aria-label") || el.getAttribute("title") || "");
      const text = norm(el.textContent || "");
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) continue;
      if (rect.width > 420 || rect.height > 420) continue;
      const isPlus =
        label === "+" ||
        text === "+" ||
        text === "＋" ||
        (text.length <= 2 && (text.includes("+") || text.includes("＋"))) ||
        (el.className && String(el.className).includes("fake-upload"));
      if (!isPlus && text.length > 0 && text !== "+" && text !== "＋") continue;
      // 空盒子也算（只有 + 子节点）
      if (!isPlus) {
        const child = norm(el.innerText || "");
        if (child !== "+" && child !== "＋" && child !== "") continue;
      }
      candidates.push({
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        w: rect.width,
        h: rect.height,
      });
    }
    // 偏好较大的上传槽
    candidates.sort((a, b) => b.w * b.h - a.w * a.h);
    return candidates[0] || null;
  });
  if (!plus) {
    throw new Error("未找到展示封面区域的「+」");
  }
  console.log("[tt-graphic] 点击展示封面+", plus);
  await page.mouse.click(plus.x, plus.y);
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]')).map((el, idx) => ({
      idx,
      accept: el.getAttribute("accept") || "",
      cls: String(el.className || "").slice(0, 80),
      id: el.id || "",
      multiple: !!el.multiple,
      display: getComputedStyle(el).display,
      inCover: !!(el.closest("[class*='cover'], [class*='Cover'], [class*='poster']")),
    }));
    const texts = Array.from(document.querySelectorAll("button, [role='button']"))
      .map((el) => String(el.textContent || "").replace(/\s+/g, "").trim().slice(0, 20))
      .filter(Boolean)
      .slice(0, 40);
    return { inputs, texts };
  });
  console.log("[tt-graphic] 封面+后 inputs=", JSON.stringify(after.inputs));
  console.log("[tt-graphic] 封面+后 buttons=", JSON.stringify(after.texts));
}



async function clickModalLocalUpload(page) {
  const clicked = await page.evaluate(() => {
    const norm = (v) => String(v || "").replace(/\s+/g, "").trim();
    const nodes = Array.from(
      document.querySelectorAll("button, [role='button'], span, div, a")
    );
    const hits = [];
    for (const el of nodes) {
      const label = norm(el.textContent || "");
      if (label !== "本地上传") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 16 || rect.width > 400) continue;
      hits.push({
        area: rect.width * rect.height,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      });
    }
    hits.sort((a, b) => a.area - b.area);
    return hits[0] || null;
  });
  if (!clicked) throw new Error("弹层内未找到「本地上传」");
  await page.mouse.click(clicked.x, clicked.y);
}

async function uploadGraphicInlineImage(page, filePath) {
  await dismissAssistantOverlay(page);
  const abs = path.resolve(filePath);
  const imgBefore = await page.evaluate(() => {
    const ed = document.querySelector(".ProseMirror");
    return ed ? ed.querySelectorAll("img").length : 0;
  });

  // 打开工具栏插图弹层（不要在 open 里点本地上传）
  await openInlineImageUploadDialog(page);
  await page.waitForTimeout(600);

  // 与「本地上传」点击同时等待 FileChooser（头条弹层走系统选文件）
  let accepted = false;
  try {
    const chooserPromise = page.waitForFileChooser({ timeout: 20000 });
    await clickModalLocalUpload(page);
    const chooser = await chooserPromise;
    await chooser.accept([abs]);
    accepted = true;
    console.log("[tt-graphic] 正文配图 fileChooser 已接受");
    await page.waitForTimeout(2000);
    // 上传后弹层可能进入选图/裁剪，点确定/插入
    for (const label of ["确定", "确认", "插入", "完成", "下一步", "使用"]) {
      const ok = await tryClickByTexts(page, [label]);
      if (ok) {
        console.log("[tt-graphic] 配图弹层确认:", label);
        await page.waitForTimeout(1200);
      }
    }
    // 等编辑器出现图片，最多 15s
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const n = await page.evaluate(() => {
        const ed = document.querySelector(".ProseMirror");
        return ed ? ed.querySelectorAll("img").length : 0;
      });
      if (n > imgBefore) break;
      await page.waitForTimeout(500);
    }
  } catch (err) {
    console.warn(
      "[tt-graphic] 正文配图 fileChooser 失败:",
      err && err.message ? err.message : err
    );
    // 取消可能卡住的系统文件框
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  if (!accepted) {
    // 回退：弹层打开后轮询 input（有时本地上传会挂上隐藏 input）
    const beforeInputs = await page.$$eval('input[type="file"]', (els) => els.length);
    try {
      await clickModalLocalUpload(page);
    } catch (_) {}
    await page.waitForTimeout(1000);
    await uploadFileThroughPolling(page, abs, 20000);
    console.log(
      "[tt-graphic] 正文配图 input 回退上传, inputs before=",
      beforeInputs
    );
  }

  await confirmImageUploadModal(page);
  await dismissUploadModals(page);
  // 再确保弹层关掉
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

  const imgAfter = await page.evaluate(() => {
    const ed = document.querySelector(".ProseMirror");
    return ed ? ed.querySelectorAll("img").length : 0;
  });
  if (imgAfter <= imgBefore) {
    throw new Error("正文配图上传后编辑器内图片数量未增加");
  }
  console.log(
    "[tt-graphic] 正文配图已上传:",
    path.basename(filePath),
    `imgs ${imgBefore}->${imgAfter}`
  );
}

/**
 * 展示封面：多次点「+」直至弹层出现 → pending FileChooser 再点「本地上传」→ 弹层「确定」→ 校验预览。
 * 行为来自 Mac `--publish` 实测（见 publish-live-14）；正式发布指定 coverPath 时失败由上层 throw，不选「无封面」。
 */
async function uploadGraphicCover(page, filePath) {
  await dismissAssistantOverlay(page);
  const abs = path.resolve(filePath);

  // 点到展示封面上传弹层（常需第二次 + 才会出现本地上传 / #upload-drag-input）
  let opened = false;
  for (let i = 0; i < COVER_MODAL_OPEN_ATTEMPTS; i += 1) {
    await openCoverUploadDialog(page);
    const state = await page.evaluate(() => {
      const hasLocal = Array.from(
        document.querySelectorAll("button, [role='button'], span, div")
      ).some(
        (el) =>
          String(el.textContent || "").replace(/\s+/g, "").trim() === "本地上传"
      );
      return {
        hasLocal,
        inputCount: document.querySelectorAll('input[type="file"]').length,
        hasDrag: !!document.querySelector("#upload-drag-input"),
      };
    });
    console.log("[tt-graphic] 封面弹层状态", state);
    if (state.hasLocal || state.hasDrag || state.inputCount > 0) {
      opened = true;
      break;
    }
    await page.waitForTimeout(400);
  }
  if (!opened) throw new Error("未能打开封面上传弹层");

  let okUpload = false;
  // 与正文配图相同：本地上传 + FileChooser（最稳）
  try {
    const chooserPromise = page.waitForFileChooser({ timeout: 20000 });
    await clickModalLocalUpload(page);
    console.log("[tt-graphic] 封面已点本地上传，等待 FileChooser");
    const chooser = await chooserPromise;
    await chooser.accept([abs]);
    okUpload = true;
    console.log("[tt-graphic] 封面 fileChooser 已接受");
  } catch (err) {
    console.warn(
      "[tt-graphic] 封面 FileChooser 失败，回退 input:",
      err && err.message ? err.message : err
    );
  }

  if (!okUpload) {
    const handles = await page.$$("#upload-drag-input, input[type='file']");
    const ordered = [];
    for (const h of handles) {
      const id = await h.evaluate((el) => el.id || "");
      if (id === "upload-drag-input") ordered.unshift(h);
      else ordered.push(h);
    }
    for (const input of ordered) {
      try {
        await input.uploadFile(abs);
        await input.evaluate((el) => {
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        });
        okUpload = true;
        console.log("[tt-graphic] 已写入封面 file input + change");
        break;
      } catch (e) {
        console.warn("[tt-graphic] input.uploadFile 失败:", e && e.message);
      }
    }
    for (const h of handles) await h.dispose().catch(() => {});
  }
  if (!okUpload) throw new Error("封面文件未能写入");

  await page.waitForTimeout(2500);
  // 截图便于确认上传后弹层形态
  try {
    const shotDir = path.join(process.cwd(), "fail-screenshots");
    fs.mkdirSync(shotDir, { recursive: true });
    const shotPath = path.join(shotDir, `头条-cover-after-accept-${Date.now()}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });
    console.log("[tt-graphic] 封面选文件后截图:", shotPath);
  } catch (_) {}

  // 不依赖 modal class：等「已上传」出现后点文案恰好为「确定」的按钮（可短重试）
  let confirmed = { ok: false, reason: "pending", okBtn: null, thumb: null, uploadedHint: false };
  const confirmDeadline = Date.now() + 12000;
  while (Date.now() < confirmDeadline) {
    confirmed = await page.evaluate(() => {
    const norm = (v) => String(v || "").replace(/\s+/g, "").trim();
    let thumb = null;
    for (const img of document.querySelectorAll("img")) {
      const rect = img.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40 || rect.width > 400) continue;
      // 上传弹层里的缩略图通常在中下部
      if (rect.top < 120) continue;
      thumb = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      break;
    }
    const oks = [];
    for (const el of document.querySelectorAll(
      "button, .m-button, [role='button'], span, div, a"
    )) {
      if (norm(el.textContent) !== "确定") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 48 || rect.height < 24 || rect.width > 200) continue;
      oks.push({
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        w: rect.width,
        h: rect.height,
        top: rect.top,
      });
    }
    // 偏好更靠下的确定（弹层底栏）
    oks.sort((a, b) => b.top - a.top);
    return {
      ok: oks.length > 0,
      reason: oks.length ? "coords" : "no-ok-btn",
      thumb,
      okBtn: oks[0] || null,
      uploadedHint: /已上传/.test(document.body ? document.body.innerText : ""),
    };
    });
    if (confirmed.uploadedHint && confirmed.okBtn) break;
    await page.waitForTimeout(500);
  }
  console.log("[tt-graphic] 封面弹层确定:", confirmed);
  if (confirmed.thumb) {
    await page.mouse.click(confirmed.thumb.x, confirmed.thumb.y);
    await page.waitForTimeout(400);
  }
  if (confirmed.okBtn) {
    await page.mouse.click(confirmed.okBtn.x, confirmed.okBtn.y);
    console.log("[tt-graphic] 已鼠标点击确定", confirmed.okBtn);
  } else {
    // 兜底文案点击
    await tryClickByTexts(page, ["确定"]);
  }
  await page.waitForTimeout(3000);

  try {
    const shotDir = path.join(process.cwd(), "fail-screenshots");
    const shotPath = path.join(shotDir, `头条-cover-after-ok-${Date.now()}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });
    console.log("[tt-graphic] 点确定后截图:", shotPath);
  } catch (_) {}

  await dismissUploadModals(page);

  let coverOk = false;
  const coverDeadline = Date.now() + 25000;
  while (Date.now() < coverDeadline) {
    coverOk = await page.evaluate(() => {
      const norm = (v) => String(v || "").replace(/\s+/g, "");
      const labels = Array.from(document.querySelectorAll("div, span, label, p"));
      let anchor = null;
      for (const el of labels) {
        const text = norm(el.textContent);
        if (text === "展示封面" || text.startsWith("展示封面")) {
          anchor = el;
          break;
        }
      }
      const roots = [];
      if (anchor) {
        roots.push(anchor.parentElement);
        if (anchor.parentElement) roots.push(anchor.parentElement.parentElement);
        if (anchor.parentElement && anchor.parentElement.parentElement) {
          roots.push(anchor.parentElement.parentElement.parentElement);
        }
      }
      document
        .querySelectorAll("[class*='cover'], [class*='Cover'], [class*='poster']")
        .forEach((n) => roots.push(n));
      for (const root of roots) {
        if (!root) continue;
        for (const img of root.querySelectorAll("img")) {
          const rect = img.getBoundingClientRect();
          if (rect.width < 40 || rect.height < 40) continue;
          const src = String(img.src || "");
          if (!src || src.startsWith("data:image/svg")) continue;
          return true;
        }
      }
      // 弹层内已有预览图也算上传成功进行中
      for (const img of document.querySelectorAll("[role='dialog'] img, .byte-modal img")) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 40 && rect.height > 40 && img.src) return true;
      }
      return false;
    });
    if (coverOk) break;
    await tryClickByTexts(page, ["确定", "确认", "完成", "保存"]);
    await page.waitForTimeout(800);
  }
  if (!coverOk) {
    const snip = await page.evaluate(() => {
      const t = document.body ? document.body.innerText : "";
      const m = t.match(/展示封面[\s\S]{0,120}/);
      return m ? m[0].replace(/\s+/g, " ").slice(0, 160) : "";
    });
    console.warn("[tt-graphic] 封面校验失败片段:", snip);
    throw new Error("封面上传后展示封面区域仍无图片");
  }
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
    console.warn("[tt-graphic] 正文配图上传失败且无封面，草稿模式将继续仅保存文字");
  }
  if (successCount === 0 && coverPath) {
    console.warn(
      "[tt-graphic] 正文配图均未成功，将继续使用封面完成草稿/发布"
    );
  }
  await dismissUploadModals(page);
}


async function readGraphicDraftStatus(page) {
  return page.evaluate(() => {
    const norm = (value) => String(value || "").replace(/\s+/g, "").trim();
    const chunks = [];
    const nodes = document.querySelectorAll(
      "span, div, p, label, [class*='status'], [class*='footer']"
    );
    for (const node of nodes) {
      const text = norm(node.textContent);
      if (!text || text.length > 40) continue;
      if (
        text.includes("草稿保存中") ||
        text.includes("草稿已保存") ||
        text.includes("草稿保存成功") ||
        text.includes("已保存")
      ) {
        chunks.push(text);
      }
    }
    return chunks.join("|");
  });
}

async function editorStillHasProbeContent(page, probe) {
  const selector = EDITOR_SELECTORS.split(",")[0].trim();
  const probeText = String(probe || "").trim().slice(0, 24);
  return page.evaluate(
    (sel, snippet) => {
      const text = String(document.querySelector(sel)?.textContent || "").trim();
      if (!text) return false;
      return !snippet || text.includes(snippet);
    },
    selector,
    probeText
  );
}

/**
 * 图文页底部仅「草稿保存中…」，无「存草稿」按钮；等待自动保存完成。
 */
async function waitForGraphicDraftSaved(page, contentProbe, timeoutMs = DRAFT_AUTO_SAVE_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  let sawSaving = false;
  const startedAt = Date.now();

  while (Date.now() < deadline) {
    if (!(await editorStillHasProbeContent(page, contentProbe))) {
      throw new Error("等待自动存草稿时正文丢失");
    }

    const status = await readGraphicDraftStatus(page);
    if (status.includes("草稿保存中")) sawSaving = true;
    const saved =
      status.includes("草稿已保存") ||
      status.includes("草稿保存成功") ||
      (status.includes("已保存") && !status.includes("保存中"));

    if (saved) {
      await page.waitForTimeout(600);
      return { ok: true, via: "status-saved" };
    }
    if (sawSaving && status && !status.includes("草稿保存中")) {
      await page.waitForTimeout(600);
      return { ok: true, via: "saving-cleared" };
    }

    if (!sawSaving && Date.now() - startedAt > 8000) {
      console.log(
        "[tt-graphic] 未检测到「草稿保存中」，正文已写入，按自动草稿处理"
      );
      await page.waitForTimeout(2000);
      return { ok: true, via: "soft-autosave" };
    }

    await page.waitForTimeout(500);
  }

  if (await editorStillHasProbeContent(page, contentProbe)) {
    console.warn("[tt-graphic] 等待草稿状态超时，正文仍在，视为已自动存草稿");
    return { ok: true, via: "timeout-soft" };
  }
  return { ok: false, via: "timeout" };
}

async function dismissUploadModals(page) {
  for (let round = 0; round < 3; round += 1) {
    const closed = await page.evaluate(() => {
      const dialogs = Array.from(
        document.querySelectorAll(
          "[role='dialog'], .byte-modal, [class*='modal'], [class*='Modal'], [class*='dialog']"
        )
      ).filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return (
          rect.width > 80 &&
          rect.height > 80 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      });
      if (!dialogs.length) return false;
      for (const dialog of dialogs) {
        const text = String(dialog.innerText || "");
        if (!/上传图片|本地上传|扫码上传/.test(text)) continue;
        const candidates = dialog.querySelectorAll(
          "button, [role='button'], span, i, svg, div"
        );
        for (const el of candidates) {
          const label = String(
            el.getAttribute("aria-label") || el.getAttribute("title") || ""
          ).trim();
          const cls = String(el.className || "");
          const t = String(el.textContent || "").trim();
          const looksClose =
            label === "关闭" ||
            label.toLowerCase() === "close" ||
            cls.includes("close") ||
            cls.includes("Close") ||
            t === "×" ||
            t === "x" ||
            t === "X";
          if (!looksClose) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4 || rect.width > 60) continue;
          // 优先右上角
          if (rect.top > dialog.getBoundingClientRect().top + 80) continue;
          el.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
          );
          if (typeof el.click === "function") el.click();
          return true;
        }
      }
      return false;
    });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    const still = await page.evaluate(() => {
      const text = document.body ? document.body.innerText : "";
      return /本地上传/.test(text) && /扫码上传/.test(text) && /上传图片/.test(text);
    });
    if (!still) return;
    if (!closed) {
      // 坐标点右上角关闭
      const box = await page.evaluate(() => {
        const dialogs = Array.from(
          document.querySelectorAll(
            "[role='dialog'], .byte-modal, [class*='modal'], [class*='Modal']"
          )
        );
        for (const d of dialogs) {
          const text = String(d.innerText || "");
          if (!/本地上传/.test(text)) continue;
          const r = d.getBoundingClientRect();
          if (r.width < 80) continue;
          return { x: r.right - 24, y: r.top + 24 };
        }
        return null;
      });
      if (box) {
        await page.mouse.click(box.x, box.y);
        await page.waitForTimeout(400);
      }
    }
  }
}

async function clickExactButton(page, labels) {
  const clicked = await page.evaluate((candidates) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, "").trim();
    const targets = candidates.map(normalize);
    const nodes = Array.from(
      document.querySelectorAll("button, .m-button, [role='button'], a")
    );
    // 精确匹配优先
    for (const exact of [true, false]) {
      for (const node of nodes) {
        const text = normalize(node.textContent);
        if (!text) continue;
        if (text.includes("定时")) continue;
        const hit = exact
          ? targets.some((t) => text === t)
          : targets.some(
              (t) => text.includes(t) && text.length <= t.length + 4 && text !== "定时发布"
            );
        if (!hit) continue;
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
        if (typeof node.click === "function") node.click();
        else
          node.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
          );
        return text;
      }
    }
    return "";
  }, labels);
  if (!clicked) throw new Error(`未找到按钮: ${labels.join(" / ")}`);
  return clicked;
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
      let target = node;
      if (typeof target.click !== "function") {
        target =
          node.closest("button, [role='button'], a, .m-button") || node.parentElement || node;
      }
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
    // 仅显式 --cover / coverPath 才走封面位；勿把首张配图冒充封面（封面控件常找不到）
    const coverPath = firstText(article.coverPath, data.coverPath);
    const inlineImages = coverPath
      ? imagePaths.filter((p) => path.resolve(p) !== path.resolve(coverPath))
      : imagePaths;

    publishStage = "填写标题";
    await setTitle(page, title);
    publishStage = "填写正文";
    await setProseMirrorContent(page, content);

    if (coverPath) {
      publishStage = "上传封面";
      try {
        await uploadGraphicCover(page, coverPath);
      } catch (coverErr) {
        const msg =
          coverErr && coverErr.message ? coverErr.message : String(coverErr);
        await dismissUploadModals(page);
        if (!draftMode) {
          throw new Error(
            `指定了封面但未能写入展示封面区域（正式发布不会改选「无封面」）: ${msg}`
          );
        }
        console.warn("[tt-graphic] 草稿模式封面上传失败，尝试改选「无封面」:", msg);
        await tryClickByTexts(page, ["无封面"]);
      }
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
      // 图文编辑页底部无「存草稿」按钮，依赖平台自动保存；状态栏常见「草稿保存中…」
      const draftResult = await waitForGraphicDraftSaved(page, content);
      if (!draftResult.ok) {
        const clicked = await tryClickByTexts(page, [
          "存草稿",
          "保存草稿",
          "保存至草稿",
          "存入草稿",
        ]);
        if (!clicked) {
          throw new Error(
            "图文页无存草稿按钮，且未观察到自动保存完成（请确认正文已填入）"
          );
        }
      } else {
        console.log("[tt-graphic] 草稿自动保存确认:", draftResult.via);
      }
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        message: "头条图文已保存草稿",
        publishMode: "draft",
        publishToDraft: true,
      });
    } else {
      publishStage = "预览并发布";
      await dismissUploadModals(page);
      await page.waitForTimeout(600);
      let stillModal = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : "";
        return /本地上传/.test(text) && /扫码上传/.test(text);
      });
      if (stillModal) {
        console.warn("[tt-graphic] 弹层仍在，尝试强制移除 DOM");
        await page.evaluate(() => {
          const nodes = document.querySelectorAll(
            "[role='dialog'], .byte-modal, [class*='modal'], [class*='Modal'], .byte-drawer"
          );
          nodes.forEach((n) => {
            const text = String(n.innerText || "");
            if (/本地上传|扫码上传|上传图片/.test(text)) n.remove();
          });
          document.querySelectorAll(".byte-modal-wrapper, .byte-modal-mask, [class*='mask']").forEach((n) => {
            const style = getComputedStyle(n);
            if (style.position === "fixed" || style.position === "absolute") n.remove();
          });
        });
        await page.waitForTimeout(500);
        stillModal = await page.evaluate(() => {
          const text = document.body ? document.body.innerText : "";
          return /本地上传/.test(text) && /扫码上传/.test(text);
        });
      }
      if (stillModal) {
        throw new Error("上传图片弹层未能关闭，无法预览并发布");
      }
      // 优先红按钮「预览并发布」；若页面是「发布」则直接发
      let previewClicked = "";
      try {
        previewClicked = await clickExactButton(page, ["预览并发布"]);
      } catch (_) {
        previewClicked = await clickExactButton(page, ["发布"]);
      }
      console.log("[tt-graphic] 已点击:", previewClicked);
      await page.waitForTimeout(2500);

      // 若已直接点「发布」且无确认框，视为进入发布流程
      publishStage = "确认发布";
      let confirmed = previewClicked === "发布";
      const confirmLabels = ["确认发布", "立即发布", "确定发布", "发布"];
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const diag = await page.evaluate(() => {
          const norm = (v) => String(v || "").replace(/\s+/g, "").trim();
          return Array.from(
            document.querySelectorAll("button, .m-button, [role='button']")
          )
            .map((el) => {
              const text = norm(el.textContent);
              const rect = el.getBoundingClientRect();
              if (!text || rect.width < 2 || rect.height < 2) return null;
              return text.slice(0, 30);
            })
            .filter(Boolean)
            .slice(0, 30);
        });
        console.log("[tt-graphic] 确认阶段可见按钮:", JSON.stringify(diag));
        const tip = await page.evaluate(() => {
          const t = document.body ? document.body.innerText : "";
          const m = t.match(/请.{0,20}封面|封面.{0,20}|无法发布.{0,30}|请上传.{0,20}/);
          return m ? m[0] : "";
        });
        if (tip) console.log("[tt-graphic] 页面提示:", tip);
        const hit = await page.evaluate((labels) => {
          const normalize = (value) =>
            String(value || "").replace(/\s+/g, "").trim();
          const targets = labels.map(normalize);
          const nodes = Array.from(
            document.querySelectorAll("button, .m-button, [role='button'], a")
          );
          for (const node of nodes) {
            const text = normalize(node.textContent);
            if (!targets.includes(text)) continue;
            if (text.includes("定时")) continue;
            if (text.includes("预览")) continue;
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
            return text;
          }
          return "";
        }, confirmLabels);
        if (hit) {
          console.log("[tt-graphic] 确认点击:", hit);
          confirmed = true;
          break;
        }
        await page.waitForTimeout(800);
      }
      if (!confirmed) {
        const shotDir = path.join(process.cwd(), "fail-screenshots");
        fs.mkdirSync(shotDir, { recursive: true });
        const shotPath = path.join(shotDir, `头条-confirm-${Date.now()}.png`);
        await page.screenshot({ path: shotPath, fullPage: true });
        console.log("[tt-graphic] 确认失败截图:", shotPath);
        throw new Error(`未找到按钮: ${confirmLabels.join(" / ")}`);
      }
      await page.waitForTimeout(2000);

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
