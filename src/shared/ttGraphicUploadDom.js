"use strict";

/** DOM 文案归一化（与 ttGraphic 内 page.evaluate 一致） */
export function normalizeTtGraphicDomText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

/**
 * 正文插图「上传图片」页/弹层：含 Tab 与本地上传、扫码上传（用户文档 UI 流程）。
 */
export function pageTextLooksLikeInlineImageUploadPanel(text) {
  const raw = String(text || "");
  return (
    /上传图片/.test(raw) && /本地上传/.test(raw) && /扫码上传/.test(raw)
  );
}

/**
 * 工具栏「插入图片」按钮的 aria/title 文案是否匹配（排除封面等）。
 */
export function isToolbarImageInsertHint(label) {
  const norm = normalizeTtGraphicDomText(label).toLowerCase();
  if (!norm) return false;
  if (norm.includes("封面") || norm.includes("展示封面")) return false;
  if (norm.includes("扫码") || norm.includes("上传图片")) return false;
  if (norm.includes("插入图片") || norm.includes("添加图片")) return true;
  if (norm.includes("image") && !norm.includes("link")) return true;
  if (norm === "图片" || norm.endsWith("图片")) return norm.length <= 8;
  return false;
}

/**
 * 从候选可点击节点 metadata 中选出「本地上传」按钮（优先精确文案、最小面积）。
 * @param {Array<{ text: string, width: number, height: number, tagName?: string }>} candidates
 */
export function pickTtGraphicLocalUploadButton(candidates) {
  const norm = normalizeTtGraphicDomText;
  const hits = [];
  for (const c of candidates) {
    const label = norm(c.text);
    if (!label.includes("本地上传")) continue;
    const w = Number(c.width) || 0;
    const h = Number(c.height) || 0;
    if (w < 20 || h < 16 || w > 600) continue;
    // 跳过把两个按钮文案拼在一起的大容器
    if (label.includes("扫码上传") && label.length > 16) continue;
    hits.push({
      ...c,
      label,
      area: w * h,
      exact: label === "本地上传",
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
