"use strict";

import { resolvePublishPlatform } from "../../shared/publishPlatforms.js";

const JUEJIN_ALIASES = new Set(["juejin", "jj", "掘金"]);
const TT_ALIASES = new Set(["tt", "toutiao", "头条"]);

function normalizeArticlePlatform(platform) {
  const raw = String(platform || "").trim();
  const lower = raw.toLowerCase();
  if (JUEJIN_ALIASES.has(raw) || JUEJIN_ALIASES.has(lower)) return "掘金";
  if (TT_ALIASES.has(raw) || TT_ALIASES.has(lower)) return "头条";
  return resolvePublishPlatform(raw);
}

function articleTextType(platform) {
  if (platform === "掘金") return "article";
  if (platform === "头条") return "graphic";
  return null;
}

function readOptionValue(args, index, optionName) {
  const next = args[index + 1];
  if (next === undefined || String(next).startsWith("-")) {
    return { ok: false, error: `缺少 ${optionName} 的值` };
  }
  return { ok: true, value: next, nextIndex: index + 1 };
}

function useNonBlank(value, fallback) {
  const text = String(value || "").trim();
  return text ? value : fallback;
}

function hasNonBlank(value) {
  return String(value || "").trim().length > 0;
}

export function parseImagePathList(raw) {
  return String(raw || "")
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * 解析 `cli publish-article` 后的 argv（不含子命令名 publish-article）
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parsePublishArticleArgs(subArgv) {
  const args = Array.isArray(subArgv) ? subArgv : [];
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, value: { help: true } };
  }

  const out = {
    platform: null,
    textType: null,
    title: null,
    content: "",
    file: null,
    cover: "",
    images: [],
    phone: null,
    partition: null,
    category: "前端",
    tags: "前端 electron",
    summary: "",
    publishAt: null,
    show: false,
    closeWindowAfterPublish: true,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--platform" || a === "-p") {
      const read = readOptionValue(args, i, "--platform");
      if (!read.ok) return { ok: false, error: read.error };
      out.platform = read.value;
      i = read.nextIndex;
    } else if (a === "--title" || a === "-t") {
      const read = readOptionValue(args, i, "--title");
      if (!read.ok) return { ok: false, error: read.error };
      out.title = read.value;
      i = read.nextIndex;
    } else if (a === "--content") {
      const read = readOptionValue(args, i, "--content");
      if (!read.ok) return { ok: false, error: read.error };
      out.content = read.value || "";
      i = read.nextIndex;
    } else if (a === "--file" || a === "-f") {
      const read = readOptionValue(args, i, "--file");
      if (!read.ok) return { ok: false, error: read.error };
      out.file = read.value;
      i = read.nextIndex;
    } else if (a === "--cover") {
      const read = readOptionValue(args, i, "--cover");
      if (!read.ok) return { ok: false, error: read.error };
      out.cover = read.value || "";
      i = read.nextIndex;
    } else if (a === "--images") {
      const read = readOptionValue(args, i, "--images");
      if (!read.ok) return { ok: false, error: read.error };
      out.images.push(...parseImagePathList(read.value));
      i = read.nextIndex;
    } else if (a === "--phone") {
      const read = readOptionValue(args, i, "--phone");
      if (!read.ok) return { ok: false, error: read.error };
      out.phone = String(read.value || "").trim();
      i = read.nextIndex;
    } else if (a === "--partition") {
      const read = readOptionValue(args, i, "--partition");
      if (!read.ok) return { ok: false, error: read.error };
      out.partition = String(read.value || "").trim();
      i = read.nextIndex;
    } else if (a === "--category") {
      const read = readOptionValue(args, i, "--category");
      if (!read.ok) return { ok: false, error: read.error };
      out.category = useNonBlank(read.value, out.category);
      i = read.nextIndex;
    } else if (a === "--tags") {
      const read = readOptionValue(args, i, "--tags");
      if (!read.ok) return { ok: false, error: read.error };
      out.tags = useNonBlank(read.value, out.tags);
      i = read.nextIndex;
    } else if (a === "--summary") {
      const read = readOptionValue(args, i, "--summary");
      if (!read.ok) return { ok: false, error: read.error };
      out.summary = read.value || "";
      i = read.nextIndex;
    } else if (a === "--publish-at") {
      const read = readOptionValue(args, i, "--publish-at");
      if (!read.ok) return { ok: false, error: read.error };
      out.publishAt = read.value;
      i = read.nextIndex;
    } else if (a === "--show") {
      out.show = true;
    } else if (a === "--no-close-window") {
      out.closeWindowAfterPublish = false;
    }
  }

  if (!out.platform) {
    return {
      ok: false,
      error: "缺少 --platform（或 -p），支持 juejin / jj / 掘金 或 tt / toutiao / 头条",
    };
  }

  const pt = normalizeArticlePlatform(out.platform);
  const textType = articleTextType(pt);
  if (!textType) {
    return { ok: false, error: `未知平台: ${out.platform}` };
  }
  out.platform = pt;
  out.textType = textType;

  if (!hasNonBlank(out.partition)) {
    if (!hasNonBlank(out.phone)) {
      return {
        ok: false,
        error: "缺少 --phone 或完整 --partition（与 GUI 一致，如 persist:13800138000头条）",
      };
    }
    const phoneSeg = String(out.phone).split("-")[0];
    out.partition = `persist:${phoneSeg}${out.platform}`;
  }

  if (!out.title || !String(out.title).trim()) {
    return { ok: false, error: "缺少 --title（或 -t）文章标题" };
  }

  if (pt === "头条") {
    const titleLen = String(out.title).trim().length;
    if (titleLen < 2 || titleLen > 30) {
      return { ok: false, error: "头条图文标题需 2～30 个字" };
    }
    out.category = "";
    out.summary = "";
    if (out.tags === "前端 electron") {
      out.tags = "";
    }
  }

  if (!String(out.content || "").trim() && !hasNonBlank(out.file)) {
    return { ok: false, error: "缺少 --content 或 --file（至少提供正文或 Markdown/txt 文件路径）" };
  }

  if (out.show) {
    console.warn("MatrixMedia: CLI publish-article 不显示浏览器窗口，已忽略 --show。");
    out.show = false;
  }

  return { ok: true, value: out };
}

export function publishArticleHelpText() {
  return `
用法: <应用> cli publish-article [选项]

选项:
  -p, --platform <id>   平台：juejin | jj | 掘金 | tt | toutiao | 头条
  -t, --title <text>    标题（必填；头条图文 2～30 字）
      --content <text>  正文；与 --file 至少提供一个
  -f, --file <path>     正文文件（.md / .txt）；与 --content 至少提供一个
      --cover <path>    封面图片（头条图文推荐）
      --images <paths>  配图，多个路径用英文或中文逗号分隔（头条图文）
      --phone <id>      账号手机号（与 GUI 账号树一致，可与 partition 二选一）
      --partition <p>   完整 session partition，如 persist:13800138000头条
      --category <name> 分类（掘金，默认 "前端"）
      --tags <text>     标签（掘金默认 "前端 Electron"；头条可选）
      --summary <text>  摘要（掘金）
      --publish-at <t>  一次性定时发布，格式 "YYYY-MM-DD HH:mm:ss"
      --show            （已忽略）CLI 不显示浏览器窗口
      --no-close-window 发布后不自动关窗（仅 GUI 显示窗口时有效）
  -h, --help            显示帮助

示例:
  matrixmedia cli publish-article -p juejin --phone 13800138000 -t "标题" --content "正文"
  matrixmedia cli publish-article -p tt --phone 13800138000 -t "图文标题" --content "正文" --cover ./cover.jpg --images "./a.jpg,./b.png"
  matrixmedia cli publish-article -p 头条 --partition persist:13800138000头条 -t "标题" -f ./post.md --tags "科技 AI"
`.trim();
}
