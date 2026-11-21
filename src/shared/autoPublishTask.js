"use strict";

/**
 * 应用内 AI 定时发帖任务：纯逻辑（调度、校验、下次运行时间）。
 * 时区固定 Asia/Shanghai（UTC+8，无夏令时）。
 */

export const AUTO_PUBLISH_TZ = "Asia/Shanghai";
export const AUTO_PUBLISH_TZ_OFFSET = "+08:00";

export const SCHEDULE_TYPES = ["once", "daily"];
export const AUTO_PUBLISH_TEXT_TYPES = ["weitoutiao"];
export const AUTO_PUBLISH_PLATFORMS = ["头条"];

/** 仅 JSON 布尔 true 视为开启；避免 Boolean('false') 等陷阱 */
export function isStrictTrue(value) {
  return value === true;
}

/** 执行层：是否应以「仅生成、不发帖」模式运行 */
export function shouldAutoPublishDryRun(task) {
  return !task || !isStrictTrue(task.allowRealPublish);
}

const MAX_NAME = 80;
const MAX_PROMPT = 4000;
const WEITOUTIAO_MIN = 40;
const WEITOUTIAO_MAX = 100;

export const DEFAULT_WEITOUTIAO_PROMPT_HINT =
  "生成一条微头条短帖正文，40～80 字，口语自然，最多不超过 100 字。不要编造未经核实的时事或金融数据；若用户未提供可核实素材，请写通用观点或生活向内容，并避免称「最新消息」「刚刚发生」等。";

export const NEWS_DISCLAIMER_SYSTEM =
  "你不是新闻机构。除非用户在提示词中提供了可逐条核实的引用来源，否则不得把模型推断当作已证实的新闻或行情事实。" +
  "涉及时事、财经、政策时只能做概括性评论或明确标注「以下为观点而非实时新闻」。";

/** @returns {{ year, month, day, hour, minute, second }} 上海本地各字段（字符串，已补零） */
export function getShanghaiParts(ms = Date.now()) {
  const parts = {};
  new Intl.DateTimeFormat("en-CA", {
    timeZone: AUTO_PUBLISH_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(new Date(ms))
    .forEach((p) => {
      if (p.type !== "literal") parts[p.type] = p.value;
    });
  return parts;
}

export function shanghaiYmd(ms = Date.now()) {
  const p = getShanghaiParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 上海本地 ymd + hms → UTC 毫秒 */
export function shanghaiLocalToUtcMs(ymd, hms = "00:00:00") {
  const text = `${String(ymd).trim()}T${String(hms).trim()}${AUTO_PUBLISH_TZ_OFFSET}`;
  const t = Date.parse(text);
  if (Number.isNaN(t)) throw new Error("无效的上海本地日期时间");
  return t;
}

export function parseYmdHms(text) {
  const s = String(text || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return { ok: false, error: "时间格式应为 YYYY-MM-DD HH:mm:ss（上海时间）" };
  return { ok: true, ymd: `${m[1]}-${m[2]}-${m[3]}`, hms: `${m[4]}:${m[5]}:${m[6]}` };
}

export function parseDailyTime(text) {
  const s = String(text || "").trim();
  const m = s.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return { ok: false, error: "每日时间格式应为 HH:mm 或 HH:mm:ss（上海时间）" };
  const sec = m[3] != null ? m[3] : "00";
  return { ok: true, hms: `${m[1]}:${m[2]}:${sec}` };
}

/**
 * 计算某任务的下一次触发时刻（UTC ms）。若已过期且无未来档，返回 null。
 * @param {object} task
 * @param {number} afterMs 从此刻之后找下一次（默认 now）
 */
export function computeNextRunAt(task, afterMs = Date.now()) {
  if (!task || task.enabled !== true) return null;
  const schedule = task.schedule || {};
  const type = schedule.type || "once";
  const endDate = String(schedule.endDate || "").trim();
  const maxRuns = schedule.maxRuns != null ? Number(schedule.maxRuns) : null;
  const runCount = Number(task.runCount) || 0;

  if (maxRuns != null && !Number.isNaN(maxRuns) && runCount >= maxRuns) return null;

  if (type === "once") {
    const parsed = parseYmdHms(schedule.onceAt);
    if (!parsed.ok) return null;
    const at = shanghaiLocalToUtcMs(parsed.ymd, parsed.hms);
    if (at <= afterMs) return null;
    if (endDate && parsed.ymd > endDate) return null;
    return at;
  }

  if (type === "daily") {
    const daily = parseDailyTime(schedule.dailyTime || "10:00:00");
    if (!daily.ok) return null;
    let cursorYmd = shanghaiYmd(afterMs);
    for (let i = 0; i < 400; i++) {
      const at = shanghaiLocalToUtcMs(cursorYmd, daily.hms);
      if (endDate && cursorYmd > endDate) return null;
      if (at > afterMs) {
        if (maxRuns != null && !Number.isNaN(maxRuns) && runCount >= maxRuns) return null;
        return at;
      }
      const nextDay = shanghaiLocalToUtcMs(cursorYmd, "23:59:59") + 1000;
      cursorYmd = shanghaiYmd(nextDay);
    }
    return null;
  }

  return null;
}

/** 启动后：若错过了当前档，只前进到下一档，不补发 */
export function advanceAfterMissedRun(task, nowMs = Date.now()) {
  const next = computeNextRunAt(task, nowMs - 1);
  if (next == null) return { ...task, nextRunAt: null };
  if (next <= nowMs) {
    const bumped = computeNextRunAt(task, nowMs);
    return { ...task, nextRunAt: bumped };
  }
  return { ...task, nextRunAt: next };
}

export function normalizeAutoPublishTaskInput(input, { isNew = false } = {}) {
  if (!input || typeof input !== "object") return { ok: false, message: "任务不能为空" };
  const name = String(input.name || "").trim();
  if (!name) return { ok: false, message: "请填写任务名称" };
  if (name.length > MAX_NAME) return { ok: false, message: "任务名称过长" };

  const pt = String(input.pt || "头条").trim();
  if (!AUTO_PUBLISH_PLATFORMS.includes(pt)) {
    return { ok: false, message: `当前仅支持平台：${AUTO_PUBLISH_PLATFORMS.join("、")}` };
  }
  const phone = String(input.phone || "").trim();
  if (!phone) return { ok: false, message: "请选择发布账号" };

  const textType = String(input.textType || "weitoutiao").trim();
  if (!AUTO_PUBLISH_TEXT_TYPES.includes(textType)) {
    return { ok: false, message: "当前仅支持微头条图文" };
  }

  const topicPrompt = String(input.topicPrompt || "").trim();
  if (!topicPrompt) return { ok: false, message: "请填写选题 / 提示词" };
  if (topicPrompt.length > MAX_PROMPT) return { ok: false, message: "提示词过长" };

  const scheduleType = String((input.schedule && input.schedule.type) || "once").trim();
  if (!SCHEDULE_TYPES.includes(scheduleType)) return { ok: false, message: "不支持的调度类型" };

  const schedule = { type: scheduleType };
  if (scheduleType === "once") {
    const parsed = parseYmdHms(input.schedule && input.schedule.onceAt);
    if (!parsed.ok) return { ok: false, message: parsed.error };
    schedule.onceAt = `${parsed.ymd} ${parsed.hms}`;
  } else {
    const daily = parseDailyTime((input.schedule && input.schedule.dailyTime) || "10:00");
    if (!daily.ok) return { ok: false, message: daily.error };
    schedule.dailyTime = daily.hms;
  }
  const endDate = String((input.schedule && input.schedule.endDate) || "").trim();
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { ok: false, message: "截止日期格式应为 YYYY-MM-DD" };
  }
  schedule.endDate = endDate;
  const maxRuns = input.schedule && input.schedule.maxRuns;
  if (maxRuns != null && maxRuns !== "") {
    const n = Number(maxRuns);
    if (!Number.isFinite(n) || n < 1) return { ok: false, message: "最大执行次数须为正整数" };
    schedule.maxRuns = Math.floor(n);
  }

  const enabled = isStrictTrue(input.enabled);
  const allowRealPublish = isStrictTrue(input.allowRealPublish);

  const record = {
    id: input.id
      ? String(input.id)
      : `apt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name,
    pt,
    phone,
    textType,
    topicPrompt,
    imagePrompt: String(input.imagePrompt || "").trim().slice(0, MAX_PROMPT),
    generateImage: input.generateImage !== false,
    schedule,
    enabled,
    allowRealPublish,
    dryRunOnly: input.dryRunOnly === true,
    chatModel: String(input.chatModel || "").trim(),
    imageModel: String(input.imageModel || "").trim(),
    runCount: Number(input.runCount) || 0,
    createdAt: input.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  record.nextRunAt = enabled ? computeNextRunAt(record) : null;
  return { ok: true, value: record };
}

export function clipWeitoutiaoContent(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const chars = Array.from(t);
  if (chars.length > WEITOUTIAO_MAX) t = chars.slice(0, WEITOUTIAO_MAX).join("");
  return t;
}

export function buildWeitoutiaoGenerateMessages(topicPrompt, extraHint = "") {
  const userTask =
    `${DEFAULT_WEITOUTIAO_PROMPT_HINT}\n\n用户选题：\n${topicPrompt}` +
    (extraHint ? `\n\n补充：${extraHint}` : "");
  return [
    { role: "system", content: NEWS_DISCLAIMER_SYSTEM },
    { role: "user", content: userTask },
  ];
}

export function buildImagePromptFromTopic(topicPrompt, imagePrompt) {
  if (imagePrompt) return String(imagePrompt).trim();
  return `为以下微头条配图，风格清新、无水印、无文字叠字，内容贴合但不逐字复述：${String(topicPrompt).slice(0, 200)}`;
}

export function previewContent(text, len = 60) {
  const t = String(text || "").replace(/\s+/g, " ");
  return t.length <= len ? t : t.slice(0, len) + "…";
}