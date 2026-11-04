"use strict";

import { normalizeTtGraphicDomText } from "./ttGraphicUploadDom.js";

/** 微头条发布页主文案特征（标题区 + 占位符） */
export function pageLooksLikeWeitoutiaoPublishPage(text) {
  const raw = String(text || "");
  if (/发布微头条/.test(raw)) return true;
  if (/有什么新鲜事想告诉大家/.test(raw)) return true;
  return false;
}

/**
 * 微头条正文编辑区遍历顺序：textarea/input 优先，再 contenteditable（与 fillComposer 一致）
 * @param {Array<{ tagName?: string, contentEditable?: boolean }>} candidates
 */
export function pickWeitoutiaoComposerCandidate(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  for (const item of list) {
    const tag = String(item.tagName || "").toUpperCase();
    if (tag === "TEXTAREA" || tag === "INPUT") return item;
  }
  for (const item of list) {
    if (item.contentEditable) return item;
  }
  return null;
}

/** 编辑区 placeholder 是否像微头条短帖输入框 */
export function isWeitoutiaoComposerPlaceholder(placeholder) {
  const norm = normalizeTtGraphicDomText(placeholder);
  if (!norm) return false;
  return norm.includes("新鲜事") || norm.includes("告诉大家");
}

/**
 * 底部工具栏「图片」按钮（排除「上传图片」整页 Tab 文案、文档导入等）
 */
export function isWeitoutiaoToolbarImageHint(label) {
  const norm = normalizeTtGraphicDomText(label);
  if (!norm) return false;
  if (norm.includes("上传图片") || norm.includes("文档导入")) return false;
  if (norm.includes("表情") || norm.includes("视频") || norm.includes("话题")) return false;
  return norm === "图片" || norm.endsWith("图片");
}

/**
 * 从候选节点中挑选工具栏「图片」按钮（优先 BUTTON、文案精确为「图片」、面积适中）
 * @param {Array<{ text: string, width: number, height: number, tagName?: string, x?: number, y?: number }>} candidates
 */
export function pickWeitoutiaoToolbarImageButton(candidates) {
  const norm = normalizeTtGraphicDomText;
  const hits = [];
  for (const c of candidates) {
    if (!isWeitoutiaoToolbarImageHint(c.text)) continue;
    const w = Number(c.width) || 0;
    const h = Number(c.height) || 0;
    if (w < 16 || h < 16 || w > 200 || h > 120) continue;
    const label = norm(c.text);
    hits.push({
      ...c,
      label,
      area: w * h,
      exact: label === "图片",
      isButton: String(c.tagName || "").toUpperCase() === "BUTTON",
    });
  }
  hits.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (a.isButton !== b.isButton) return a.isButton ? -1 : 1;
    return a.area - b.area;
  });
  return hits[0] || null;
}

/** 「发布」主按钮文案（排除「定时发布」等） */
export function isWeitoutiaoPublishButtonLabel(text) {
  const norm = normalizeTtGraphicDomText(text);
  if (!norm) return false;
  if (norm.includes("定时")) return false;
  if (norm.includes("预览")) return false;
  return norm === "发布" || norm === "立即发布";
}

const MIN_COMPOSER_PREVIEW_PX = 36;
const MAX_COMPOSER_PREVIEW_PX = 720;

/**
 * img 元数据是否像微头条编辑区已插入的配图预览（排除上传弹层内缩略图、小 icon）
 * @param {{ width?: number, height?: number, inUploadModal?: boolean, inComposer?: boolean, inImageStrip?: boolean, inRichText?: boolean }} meta
 */
export function looksLikeWeitoutiaoAttachedImagePreview(meta) {
  if (!meta || meta.inUploadModal) return false;
  const w = Number(meta.width) || 0;
  const h = Number(meta.height) || 0;
  if (w < MIN_COMPOSER_PREVIEW_PX || h < MIN_COMPOSER_PREVIEW_PX) return false;
  if (w > MAX_COMPOSER_PREVIEW_PX && h > MAX_COMPOSER_PREVIEW_PX) return false;
  return !!(meta.inRichText || meta.inComposer || meta.inImageStrip);
}

/** file input 快照键（用于识别「本地上传」新挂载的 input） */
export function weitoutiaoFileInputDescriptorKey(desc) {
  if (!desc) return "";
  return [
    String(desc.id || ""),
    String(desc.name || ""),
    String(desc.accept || ""),
    String(desc.index ?? ""),
  ].join("|");
}

/**
 * 优先选用点击「本地上传」后新出现的弹层内 file input
 * @param {Array<{ inUploadPanel?: boolean, index?: number, id?: string, name?: string, accept?: string }>} inputs
 * @param {string[]} baselineKeys 点击「本地上传」前弹层内已有 input 的 descriptor key
 */
export function pickFreshWeitoutiaoPanelFileInput(inputs, baselineKeys = []) {
  const list = Array.isArray(inputs) ? inputs : [];
  const base = new Set(Array.isArray(baselineKeys) ? baselineKeys : []);
  const inPanel = list.filter((i) => i.inUploadPanel);
  const fresh = inPanel.filter(
    (i) => !base.has(weitoutiaoFileInputDescriptorKey(i))
  );
  if (fresh.length) return fresh[fresh.length - 1];
  return pickWeitoutiaoUploadFileInputCandidate(list, { requireInPanel: true });
}

/**
 * @param {Array<{ width?: number, height?: number, inUploadModal?: boolean, inComposer?: boolean, inImageStrip?: boolean }>} candidates
 */
export function countWeitoutiaoAttachedImagePreviews(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  let n = 0;
  for (const item of list) {
    if (looksLikeWeitoutiaoAttachedImagePreview(item)) n += 1;
  }
  return n;
}

/**
 * 上传弹层内 file input 优先；无弹层 input 时不回退到页面其它 input（避免 stale input）
 * @param {Array<{ inUploadPanel?: boolean, index?: number }>} inputs
 * @param {{ requireInPanel?: boolean }} [options]
 */
export function pickWeitoutiaoUploadFileInputCandidate(inputs, options = {}) {
  const { requireInPanel = true } = options;
  const list = Array.isArray(inputs) ? inputs : [];
  if (!list.length) return null;
  const inPanel = list.filter((i) => i.inUploadPanel);
  if (inPanel.length) return inPanel[inPanel.length - 1];
  if (requireInPanel) return null;
  return list[list.length - 1];
}
