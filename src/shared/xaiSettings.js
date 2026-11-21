"use strict";

/**
 * xAI 官方 API 默认与校验（主进程 / 渲染进程 / 测试共用）。
 * 文档：https://docs.x.ai — Chat: POST /v1/chat/completions；图片: POST /v1/images/generations
 */

import { maskApiKey, redactSecret } from "./aiContent.js";

export const XAI_DEFAULT_BASE_URL = "https://api.x.ai/v1";
export const XAI_DEFAULT_CHAT_MODEL = "grok-4-fast";
export const XAI_DEFAULT_IMAGE_MODEL = "grok-imagine-image-2.0";

const MAX_KEY = 500;

export function normalizeXaiBaseURL(raw) {
  let url = String(raw || "").trim();
  url = url.replace(/\/+$/, "");
  return url || XAI_DEFAULT_BASE_URL;
}

export function validateXaiApiKey(apiKey) {
  const k = String(apiKey || "").trim();
  if (!k) return { ok: false, message: "请填写 xAI API Key" };
  if (k.length > MAX_KEY) return { ok: false, message: "API Key 过长" };
  if (/\s/.test(k)) return { ok: false, message: "API Key 不能包含空格或换行" };
  return { ok: true, value: k };
}

export function normalizeXaiSettingsInput(input) {
  if (!input || typeof input !== "object") return { ok: false, message: "配置不能为空" };
  const chatModel = String(input.chatModel || XAI_DEFAULT_CHAT_MODEL).trim();
  const imageModel = String(input.imageModel || XAI_DEFAULT_IMAGE_MODEL).trim();
  const baseURL = normalizeXaiBaseURL(input.baseURL);
  const apiKey = String(input.apiKey || "").trim();
  if (!chatModel) return { ok: false, message: "请填写文本生成模型" };
  if (!imageModel) return { ok: false, message: "请填写图片生成模型" };
  if (apiKey) {
    const kv = validateXaiApiKey(apiKey);
    if (!kv.ok) return kv;
  }
  return {
    ok: true,
    value: { baseURL, chatModel, imageModel, apiKey },
  };
}

export function toPublicXaiSettings(stored, { maskedKey = "", keyError = "", secureStorage = false } = {}) {
  return {
    baseURL: stored.baseURL || XAI_DEFAULT_BASE_URL,
    chatModel: stored.chatModel || XAI_DEFAULT_CHAT_MODEL,
    imageModel: stored.imageModel || XAI_DEFAULT_IMAGE_MODEL,
    hasKey: Boolean(stored.key && stored.key.data),
    maskedKey,
    keyError,
    secureStorage,
    updatedAt: stored.updatedAt || 0,
  };
}

export { maskApiKey, redactSecret };