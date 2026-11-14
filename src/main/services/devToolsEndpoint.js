"use strict";

import http from "http";

/**
 * CDP 单次调用超时（puppeteer 默认 180s）。
 * 弱网/大文件下 Runtime.callFunctionOn 很容易被 180s 砍断，
 * 报错原文就是「Increase the 'protocolTimeout' setting」。
 */
const envTimeout = Number(process.env.MM_PROTOCOL_TIMEOUT_MS);
export const DEVTOOLS_PROTOCOL_TIMEOUT_MS =
  Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 600000;

/**
 * 读取 Electron DevTools 的 /json/version（puppeteer-in-electron 内部同款）。
 * 抽成独立模块：puppeteer-in-electron 的 connect 不透传 protocolTimeout，
 * 我们需要自己连一次；这段 I/O 也才好写单测。
 *
 * @param {number|string} port 远程调试端口
 * @param {number} [timeoutMs]
 * @returns {Promise<object>} 形如 { webSocketDebuggerUrl, Browser, ... }
 */
export function readDevToolsVersion(port, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/json/version", timeout: timeoutMs },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`/json/version 返回 HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`/json/version 不是合法 JSON: ${e.message}`));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("读取 /json/version 超时")));
    req.on("error", reject);
  });
}
