"use strict";

import { normalizeXaiSettingsInput } from "../../shared/xaiSettings.js";
import { buildAutoPublishAccountOptions } from "../../shared/autoPublishAccountOptions.js";
import { runAutoPublishTaskNow } from "./autoPublishScheduler.js";
import { findAccountRecordFlexible, listAllAccountRecords } from "./accountLookup.js";

function isLocalAppSender(event) {
  try {
    const frame = new URL(String((event && event.senderFrame && event.senderFrame.url) || ""));
    return (
      (frame.protocol === "file:" && !frame.hostname) ||
      (["http:", "https:"].includes(frame.protocol) && ["localhost", "127.0.0.1"].includes(frame.hostname))
    );
  } catch (_) {
    return false;
  }
}

function wrap(handler) {
  return async (event, ...args) => {
    if (!isLocalAppSender(event)) return { ok: false, message: "不允许外部页面访问 AI 定时发帖" };
    try {
      return { ok: true, ...(await handler(...args)) };
    } catch (error) {
      return { ok: false, message: (error && error.message) || "操作失败" };
    }
  };
}

export function registerAutoPublishIpc(
  ipcMain,
  {
    store,
    xaiStore,
    app,
    testXai,
    engineDeps = {},
    listAccounts = listAllAccountRecords,
    findAccountRecord = findAccountRecordFlexible,
  } = {}
) {
  ipcMain.handle("autoPublish:list", wrap(async () => store.list()));

  ipcMain.handle(
    "autoPublish:list-accounts",
    wrap(async (payload) => {
      const platform = String((payload && payload.pt) || "头条").trim();
      const accounts = buildAutoPublishAccountOptions(listAccounts(), platform);
      return {
        accounts,
        emptyHint:
          accounts.length > 0
            ? ""
            : `未找到「${platform}」账号。请先在「媒体平台管理」添加对应平台账号并登录，再回到本页刷新。`,
      };
    })
  );

  ipcMain.handle(
    "autoPublish:save",
    wrap(async (input) => {
      const idText = input && input.id != null ? String(input.id).trim() : "";
      const isNew = !idText;
      const v = input || {};
      const pt = String(v.pt || "头条").trim();
      const phone = String(v.phone || "").trim();
      if (!phone) throw new Error("请选择发布账号");
      const record = findAccountRecord({ phone, pt });
      if (!record) {
        throw new Error(
          `所选账号在本地记录中不存在或与平台「${pt}」不匹配，请重新选择（phone=${phone}）`
        );
      }
      const task = store.saveTask({ ...v, phone: String(record.phone).trim(), pt }, { isNew });
      return { task, ...store.list() };
    })
  );

  ipcMain.handle(
    "autoPublish:remove",
    wrap(async (id) => {
      store.removeTask(id);
      return store.list();
    })
  );

  ipcMain.handle(
    "autoPublish:set-enabled",
    wrap(async ({ id, enabled }) => {
      const task = store.setEnabled(id, enabled);
      return { task, ...store.list() };
    })
  );

  ipcMain.handle(
    "autoPublish:run-now",
    wrap(async (id) => {
      await runAutoPublishTaskNow(store, xaiStore, app, id, engineDeps);
      return store.list();
    })
  );

  ipcMain.handle("xai:get-settings", wrap(async () => ({ settings: xaiStore.getPublic() })));

  ipcMain.handle(
    "xai:save-settings",
    wrap(async (input) => ({ settings: xaiStore.save(input || {}) }))
  );

  ipcMain.handle(
    "xai:clear-key",
    wrap(async () => ({ settings: xaiStore.clearKey() }))
  );

  ipcMain.handle(
    "xai:test",
    wrap(async (input) => {
      let provider;
      if (input && input.apiKey) {
        const normalized = normalizeXaiSettingsInput(input);
        if (!normalized.ok) throw new Error(normalized.message);
        provider = { ...normalized.value, apiKey: normalized.value.apiKey };
      } else if (input && input.useSaved) {
        provider = xaiStore.resolve();
      } else {
        const normalized = normalizeXaiSettingsInput({ ...input, apiKey: input && input.apiKey });
        if (normalized.ok && normalized.value.apiKey) {
          provider = normalized.value;
        } else {
          provider = xaiStore.resolve();
        }
      }
      return testXai(provider);
    })
  );
}