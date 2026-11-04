"use strict";

import { normalizeTtGraphicDomText } from "./ttGraphicUploadDom.js";

/** 微头条发布页主文案特征（标题区 + 占位符） */
export function pageLooksLikeWeitoutiaoPublishPage(text) {
  const raw = String(text || "");
  if (/发布微头条/.test(raw)) return true;
  if (/有什么新鲜事想告诉大家/.test(raw)) return true;
  return false;
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
