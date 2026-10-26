"use strict";

/** 头条竖屏封面最低像素要求（平台弹窗文案：不低于 618×1000） */
export const TT_COVER_MIN_WIDTH = 618;
export const TT_COVER_MIN_HEIGHT = 1000;
export const TT_COVER_MAX_BYTES = 20 * 1024 * 1024;

const RESOLUTION_PAIR_RE = /(\d{2,5})\s*[×x*]\s*(\d{2,5})/i;

export function parseResolutionPair(text) {
  const m = String(text || "").match(RESOLUTION_PAIR_RE);
  if (!m) return null;
  const width = parseInt(m[1], 10);
  const height = parseInt(m[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

export function meetsToutiaoCoverMinSize(
  width,
  height,
  minW = TT_COVER_MIN_WIDTH,
  minH = TT_COVER_MIN_HEIGHT
) {
  return width >= minW && height >= minH;
}

/**
 * 等比放大到同时满足最小宽、高（取较大缩放比）。
 */
export function scaleToMeetMinimum(
  width,
  height,
  minW = TT_COVER_MIN_WIDTH,
  minH = TT_COVER_MIN_HEIGHT
) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const scale = Math.max(minW / w, minH / h, 1);
  return {
    width: Math.ceil(w * scale),
    height: Math.ceil(h * scale),
  };
}

export function isToutiaoLowResCoverHint(text) {
  const raw = String(text || "");
  if (!raw) return false;
  if (raw.includes("上传更清晰的封面")) return true;
  if (raw.includes("替换封面") && raw.includes("分辨率")) return true;
  if (raw.includes("618") && raw.includes("1000")) return true;
  const pair = parseResolutionPair(raw);
  if (pair && !meetsToutiaoCoverMinSize(pair.width, pair.height)) return true;
  return false;
}

/** 页面上「当前封面分辨率为 …」类提示 */
export function pageTextSuggestsLowToutiaoCover(bodyText) {
  const text = String(bodyText || "");
  if (!text.includes("封面") || !text.includes("分辨率")) return false;
  if (text.includes("618") || text.includes("1000")) return true;
  const pair = parseResolutionPair(text);
  return pair ? !meetsToutiaoCoverMinSize(pair.width, pair.height) : false;
}
