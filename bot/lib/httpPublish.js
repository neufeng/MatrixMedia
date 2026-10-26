"use strict";

const http = require("http");
const https = require("https");

function requestJson(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += c;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, body: raw });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`HTTP 请求超时 ${timeoutMs}ms`));
    });
    req.write(data);
    req.end();
  });
}

/**
 * GUI 已启动时使用 localhost:30088（与 docs/http-api.md 对齐的精简载荷）
 */
async function publishViaHttp(config, fields, account) {
  const base = config.matrixMedia.httpBaseUrl.replace(/\/$/, "");
  const url = `${base}/publish`;
  const payload = {
    platform: account.platform,
    phone: account.phone,
    filePath: fields.file,
    title: fields.title,
    description: fields.description,
    tags: fields.tags,
    bookName: fields.name,
    publishAt: fields.publishAt || undefined,
  };

  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      message: `[dry-run] POST ${url}`,
      payload,
    };
  }

  const { statusCode, body } = await requestJson(
    url,
    payload,
    config.matrixMedia.httpTimeoutMs
  );
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    json = { raw: body };
  }

  if (statusCode >= 400 || json.success === false) {
    return {
      ok: false,
      message: `HTTP 发布失败 ${statusCode}：${json.message || body.slice(0, 300)}`,
      json,
    };
  }
  return { ok: true, json };
}

async function probeHttp(config) {
  const base = config.matrixMedia.httpBaseUrl.replace(/\/$/, "");
  return new Promise((resolve) => {
    const parsed = new URL(`${base}/platforms`);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(`${base}/platforms`, { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

module.exports = { publishViaHttp, probeHttp };
