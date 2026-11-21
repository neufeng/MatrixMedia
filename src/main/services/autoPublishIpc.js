"use strict";

import { normalizeXaiSettingsInput } from "../../shared/xaiSettings.js";
import { runAutoPublishTaskNow } from "./autoPublishScheduler.js";

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

export function registerAutoPublishIpc(ipcMain, { store, xaiStore, app, testXai, engineDeps = {} }) {
  ipcMain.handle("autoPublish:list", wrap(async () => store.list()));

  ipcMain.handle(
    "autoPublish:save",
    wrap(async (input) => {
      const isNew = !input || !input.id;
      const task = store.saveTask(input || {}, { isNew });
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