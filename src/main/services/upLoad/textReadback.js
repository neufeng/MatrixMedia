"use strict";

/**
 * 写入回读校验的公共判据（2026-10-31 review 反馈）。
 *
 * 两个坑：
 * 1) `String.prototype.slice(0, 8)` 按 UTF-16 code unit 切，标题前 8 单元里含 emoji
 *    且恰好跨在边界上时会切出孤立代理对，`includes` 永远不命中 → 把正常的发布误中止。
 *    改用 Array.from 按码点切。
 * 2) 平台富文本会把空格归一成 &nbsp;(U+00A0)、插入零宽字符、把换行折成空格，
 *    回读串与源串不一定逐字节相等。比较前先做视觉等价归一。
 * 3) 一次写不进去不一定是失败（聚焦丢失、IME 未提交）。先重输一次再判失败，
 *    避免把正常发布直接中止。
 */

/** 按码点取前 n 个字符（emoji 不会被切半） */
export function head(str, n = 8) {
  const s = String(str == null ? "" : str);
  return Array.from(s).slice(0, n).join("");
}

/** 比较用的归一化：去掉 &nbsp;/零宽字符与所有空白（中文语境下空白不承载语义） */
export function normalizeForCompare(str) {
  return String(str == null ? "" : str)
    .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, "");
}

/**
 * 回读内容是否命中期望前缀。期望串为空时视为「无约束」（调用方本就不该校验空内容）。
 */
export function matchesHead(typed, expected, n = 8) {
  const want = normalizeForCompare(head(expected, n));
  if (!want) return true;
  return normalizeForCompare(typed).includes(want);
}

/**
 * 清空目标输入框并整段重写（用于回读不一致时的第二次尝试）。
 * 富文本编辑器（contenteditable）上 clickCount 三击不可靠，用全选快捷键。
 */
export async function replaceAllText(page, target, value, delay = 60) {
  await target.click();
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  try {
    await page.keyboard.down(mod);
    await page.keyboard.press("a");
    await page.keyboard.up(mod);
    await page.keyboard.press("Backspace");
  } catch (_) {
    /* 快捷键失败就退回追加写：至少内容还在，由上层的回读判定兜底 */
  }
  await page.keyboard.type(value, { delay });
}
