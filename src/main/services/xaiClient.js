"use strict";

import axios from "axios";
import fs from "fs";
import path from "path";
import {
  buildWeitoutiaoGenerateMessages,
  buildImagePromptFromTopic,
  clipWeitoutiaoContent,
} from "../../shared/autoPublishTask.js";
import { extractCompletionText } from "../../shared/aiContent.js";
import { redactSecret } from "../../shared/xaiSettings.js";

export const XAI_CHAT_TIMEOUT_MS = 90 * 1000;
export const XAI_IMAGE_TIMEOUT_MS = 120 * 1000;
export const XAI_TEST_TIMEOUT_MS = 25 * 1000;

function describeHttpError(status, body) {
  const remote =
    (body && body.error && (body.error.message || body.error.code)) ||
    (body && body.message) ||
    "";
  const suffix = remote ? `：${String(remote).slice(0, 200)}` : "";
  if (status === 401 || status === 403) return `xAI API Key 无效或没有权限（${status}）${suffix}`;
  if (status === 404) return `xAI 接口或模型不存在（404）${suffix}`;
  if (status === 429) return `xAI 请求过于频繁或额度不足（429）${suffix}`;
  if (status >= 500) return `xAI 服务暂时不可用（${status}）${suffix}`;
  return `xAI 接口返回错误（${status}）${suffix}`;
}

function toFriendlyError(error, apiKey) {
  let message;
  if (error && error.response) {
    message = describeHttpError(error.response.status, error.response.data);
  } else if (error && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT" || /timeout/i.test(error.message || ""))) {
    message = "xAI 请求超时，请检查网络或稍后重试";
  } else if (error && ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN"].includes(error.code)) {
    message = `无法连接到 xAI（${error.code}），请检查网络`;
  } else {
    message = (error && error.message) || "xAI 请求失败";
  }
  return new Error(redactSecret(message, apiKey));
}

function authHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

export async function xaiChatCompletion(
  { baseURL, apiKey, model, messages, maxTokens = 256, timeoutMs = XAI_CHAT_TIMEOUT_MS, signal },
  { http = axios } = {}
) {
  try {
    if (signal && signal.aborted) throw Object.assign(new Error("canceled"), { code: "ERR_CANCELED" });
    const res = await http.request({
      signal,
      method: "POST",
      url: `${baseURL}/chat/completions`,
      data: { model, messages, temperature: 0.85, stream: false, max_tokens: maxTokens },
      timeout: timeoutMs,
      headers: authHeaders(apiKey),
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const text = extractCompletionText(res && res.data);
    if (!text) throw new Error("xAI 文本接口返回格式不正确（缺少 choices[0].message.content）");
    return text;
  } catch (error) {
    throw toFriendlyError(error, apiKey);
  }
}

export async function generateWeitoutiaoText(provider, topicPrompt, options = {}) {
  const messages = buildWeitoutiaoGenerateMessages(topicPrompt, options.extraHint);
  const model = String(options.chatModel || provider.chatModel || "").trim() || provider.chatModel;
  const raw = await xaiChatCompletion({
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
    model,
    messages,
    maxTokens: 220,
    signal: options.signal,
  });
  const body = clipWeitoutiaoContent(raw.replace(/^["'「]|["'」]$/g, "").trim());
  if (!body) throw new Error("xAI 未生成有效正文");
  return { content: body, model };
}

function extractImagePayload(data) {
  const list = data && Array.isArray(data.data) ? data.data : [];
  const first = list[0] || {};
  if (first.b64_json) return { kind: "b64", value: first.b64_json };
  if (first.url) return { kind: "url", value: first.url };
  return null;
}

export async function xaiGenerateImage(
  { baseURL, apiKey, model, prompt, timeoutMs = XAI_IMAGE_TIMEOUT_MS, signal },
  { http = axios } = {}
) {
  try {
    const res = await http.request({
      signal,
      method: "POST",
      url: `${baseURL}/images/generations`,
      data: {
        model,
        prompt,
        n: 1,
        response_format: "b64_json",
        aspect_ratio: "1:1",
        resolution: "1k",
      },
      timeout: timeoutMs,
      headers: authHeaders(apiKey),
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const payload = extractImagePayload(res && res.data);
    if (!payload) throw new Error("xAI 图片接口未返回 data[0].b64_json 或 url");
    return payload;
  } catch (error) {
    throw toFriendlyError(error, apiKey);
  }
}

export async function saveXaiImageToDir(payload, dir, { http = axios, fileSystem = fs, now = () => Date.now() } = {}) {
  fileSystem.mkdirSync(dir, { recursive: true });
  const fileName = `xai-${now()}.jpg`;
  const filePath = path.join(dir, fileName);
  if (payload.kind === "b64") {
    const buf = Buffer.from(String(payload.value), "base64");
    if (!buf.length) throw new Error("xAI 返回的图片 base64 为空");
    fileSystem.writeFileSync(filePath, buf);
    return filePath;
  }
  const res = await http.request({
    method: "GET",
    url: payload.value,
    responseType: "arraybuffer",
    timeout: 60 * 1000,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  fileSystem.writeFileSync(filePath, Buffer.from(res.data));
  return filePath;
}

export async function generateWeitoutiaoImage(provider, topicPrompt, imagePrompt, options = {}) {
  const prompt = buildImagePromptFromTopic(topicPrompt, imagePrompt);
  const model = String(options.imageModel || provider.imageModel || "").trim() || provider.imageModel;
  const payload = await xaiGenerateImage({
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
    model,
    prompt,
    signal: options.signal,
  });
  return { payload, model, prompt };
}

/** 连接测试：极短 chat 请求 */
export async function testXaiConnection(provider, deps = {}) {
  const started = Date.now();
  await xaiChatCompletion(
    {
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
      model: provider.chatModel,
      messages: [{ role: "user", content: "只回复一个字：好" }],
      maxTokens: 8,
      timeoutMs: XAI_TEST_TIMEOUT_MS,
    },
    deps
  );
  return { latencyMs: Date.now() - started };
}