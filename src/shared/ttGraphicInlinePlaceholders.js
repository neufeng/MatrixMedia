"use strict";

import path from "path";

/** 整行占位：`[图1：filename.jpg]` 或 `[图1:filename.jpg]` */
export const TT_GRAPHIC_IMAGE_MARKER_LINE_RE =
  /^\[图(\d+)[：:]([^\]]*)\]\s*$/;

/** 整行 Markdown 图片：`![alt](path)` */
export const TT_GRAPHIC_MARKDOWN_IMAGE_LINE_RE =
  /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

/**
 * 将正文拆成有序片段：text（保留换行）与 image 占位（不含占位行文字）。
 * @returns {Array<{ type: 'text', content: string } | { type: 'image', markerIndex?: number, filenameHint?: string, markdownPath?: string, alt?: string }>}
 */
export function parseTtGraphicBodySegments(rawContent) {
  const segments = [];
  const lines = String(rawContent || "").split("\n");
  const textBuffer = [];

  const flushText = () => {
    if (!textBuffer.length) return;
    segments.push({ type: "text", content: textBuffer.join("\n") });
    textBuffer.length = 0;
  };

  let markerOrdinal = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    const markerMatch = trimmed.match(TT_GRAPHIC_IMAGE_MARKER_LINE_RE);
    if (markerMatch) {
      flushText();
      markerOrdinal += 1;
      segments.push({
        type: "image",
        markerIndex: markerOrdinal,
        filenameHint: String(markerMatch[2] || "").trim(),
      });
      continue;
    }
    const mdMatch = trimmed.match(TT_GRAPHIC_MARKDOWN_IMAGE_LINE_RE);
    if (mdMatch) {
      flushText();
      segments.push({
        type: "image",
        markdownPath: String(mdMatch[2] || "").trim(),
        alt: String(mdMatch[1] || "").trim(),
      });
      continue;
    }
    textBuffer.push(line);
  }
  flushText();
  return segments;
}

export function bodyHasInlineImagePlaceholders(rawContent) {
  const lines = String(rawContent || "").split("\n");
  return lines.some((line) => {
    const trimmed = line.trim();
    return (
      TT_GRAPHIC_IMAGE_MARKER_LINE_RE.test(trimmed) ||
      TT_GRAPHIC_MARKDOWN_IMAGE_LINE_RE.test(trimmed)
    );
  });
}

function basenameMatchesHint(filePath, hint) {
  const h = String(hint || "").trim();
  if (!h) return false;
  const base = path.basename(filePath);
  const hintBase = path.basename(h);
  return base === hintBase || base === h || filePath.endsWith(h);
}

/**
 * 为 image 片段绑定本地路径：优先占位内文件名，否则按占位出现顺序对应 inlineImages 列表。
 */
export function resolveTtGraphicImageSegments(segments, inlineImagePaths) {
  const paths = Array.isArray(inlineImagePaths)
    ? inlineImagePaths.map((p) => String(p || "").trim()).filter(Boolean)
    : [];
  const used = new Set();
  let orderFallback = 0;

  const takeByHint = (hint) => {
    for (const p of paths) {
      if (used.has(p)) continue;
      if (basenameMatchesHint(p, hint)) {
        used.add(p);
        return p;
      }
    }
    return "";
  };

  const takeByOrder = () => {
    while (orderFallback < paths.length) {
      const p = paths[orderFallback];
      orderFallback += 1;
      if (!used.has(p)) {
        used.add(p);
        return p;
      }
    }
    return "";
  };

  const resolved = segments.map((seg) => {
    if (seg.type !== "image") return seg;
    let filePath = takeByHint(seg.filenameHint);
    if (!filePath && seg.markdownPath) {
      filePath = takeByHint(seg.markdownPath);
      if (!filePath) {
        const abs = path.resolve(seg.markdownPath);
        if (paths.includes(abs)) filePath = abs;
      }
    }
    if (!filePath) filePath = takeByOrder();
    return { ...seg, filePath };
  });

  const unusedPaths = paths.filter((p) => !used.has(p));
  return { segments: resolved, unusedPaths };
}

/** 草稿探测用：拼接可见正文（已去掉占位行） */
export function ttGraphicVisibleTextProbe(segments, maxLen = 24) {
  const text = segments
    .filter((s) => s.type === "text")
    .map((s) => s.content)
    .join("\n");
  return String(text || "").trim().slice(0, maxLen);
}
