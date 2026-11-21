"use strict";

import fs from "fs";
import path from "path";
import {
  normalizeXaiSettingsInput,
  toPublicXaiSettings,
  maskApiKey,
  XAI_DEFAULT_BASE_URL,
  XAI_DEFAULT_CHAT_MODEL,
  XAI_DEFAULT_IMAGE_MODEL,
} from "../../shared/xaiSettings.js";

const FILE_VERSION = 1;

function emptyData() {
  return { version: FILE_VERSION, baseURL: XAI_DEFAULT_BASE_URL, chatModel: XAI_DEFAULT_CHAT_MODEL, imageModel: XAI_DEFAULT_IMAGE_MODEL, key: null, updatedAt: 0 };
}

/**
 * xAI API Key 单例本地存储（仅主进程）。
 * 文件：<userData>/xai-settings.json，权限 0600。
 */
export function createXaiKeyStore({ filePath, safeStorage = null, fileSystem = fs, now = () => Date.now() } = {}) {
  if (!filePath) throw new Error("缺少 xAI 配置文件路径");

  function canEncrypt() {
    try {
      return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
    } catch (_) {
      return false;
    }
  }

  function encodeKey(plain) {
    if (!plain) return null;
    if (canEncrypt()) {
      return { enc: "safeStorage", data: safeStorage.encryptString(plain).toString("base64") };
    }
    return { enc: "plain", data: Buffer.from(plain, "utf8").toString("base64") };
  }

  function decodeKey(stored) {
    if (!stored || !stored.data) return "";
    const buf = Buffer.from(String(stored.data), "base64");
    if (stored.enc === "safeStorage") {
      if (!canEncrypt()) {
        throw new Error("系统加密存储不可用，无法读取已保存的 xAI API Key，请重新填写");
      }
      return safeStorage.decryptString(buf);
    }
    return buf.toString("utf8");
  }

  function read() {
    let raw;
    try {
      raw = fileSystem.readFileSync(filePath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") return emptyData();
      throw error;
    }
    try {
      const data = JSON.parse(raw);
      return { ...emptyData(), ...data, version: FILE_VERSION };
    } catch (_) {
      throw new Error("xAI 配置文件已损坏：" + filePath);
    }
  }

  function write(data) {
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fileSystem.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    fileSystem.renameSync(tmp, filePath);
    try {
      fileSystem.chmodSync(filePath, 0o600);
    } catch (_) {
      /* ignore on Windows */
    }
  }

  function toPublic(data) {
    let masked = "";
    let keyError = "";
    try {
      masked = maskApiKey(decodeKey(data.key));
    } catch (error) {
      keyError = error.message;
    }
    return toPublicXaiSettings(data, { maskedKey: masked, keyError, secureStorage: canEncrypt() });
  }

  return {
    isSecure: canEncrypt,

    getPublic() {
      return toPublic(read());
    },

    /** apiKey 留空表示沿用已保存 Key */
    save(input) {
      const normalized = normalizeXaiSettingsInput(input || {});
      if (!normalized.ok) throw new Error(normalized.message);
      const v = normalized.value;
      const data = read();
      if (!v.apiKey && !(data.key && data.key.data)) {
        throw new Error("请填写 xAI API Key");
      }
      const next = {
        version: FILE_VERSION,
        baseURL: v.baseURL,
        chatModel: v.chatModel,
        imageModel: v.imageModel,
        key: v.apiKey ? encodeKey(v.apiKey) : data.key,
        updatedAt: now(),
      };
      write(next);
      return toPublic(next);
    },

    clearKey() {
      const data = read();
      data.key = null;
      data.updatedAt = now();
      write(data);
      return toPublic(data);
    },

    resolve() {
      const data = read();
      const apiKey = decodeKey(data.key);
      if (!apiKey) throw new Error("尚未配置 xAI API Key，请先在「AI 定时发帖 → xAI 设置」填写");
      return {
        baseURL: data.baseURL || XAI_DEFAULT_BASE_URL,
        chatModel: data.chatModel || XAI_DEFAULT_CHAT_MODEL,
        imageModel: data.imageModel || XAI_DEFAULT_IMAGE_MODEL,
        apiKey,
      };
    },
  };
}