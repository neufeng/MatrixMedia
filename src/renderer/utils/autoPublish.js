import { ipcRenderer } from "electron";

async function invoke(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || !res.ok) throw new Error((res && res.message) || "操作失败");
  return res;
}

export const listAutoPublish = () => invoke("autoPublish:list");
/** @param {{ pt?: string }} payload */
export const listAutoPublishAccounts = (payload) => invoke("autoPublish:list-accounts", payload || {});
export const saveAutoPublishTask = (input) => invoke("autoPublish:save", input);
export const removeAutoPublishTask = (id) => invoke("autoPublish:remove", id);
export const setAutoPublishEnabled = (id, enabled) => invoke("autoPublish:set-enabled", { id, enabled });
export const runAutoPublishNow = (id) => invoke("autoPublish:run-now", id);

export const getXaiSettings = () => invoke("xai:get-settings");
export const saveXaiSettings = (input) => invoke("xai:save-settings", input);
export const clearXaiKey = () => invoke("xai:clear-key");
export const testXaiSettings = (input) => invoke("xai:test", input);

export function onAutoPublishChanged(callback) {
  const fn = () => callback();
  ipcRenderer.on("autoPublish:changed", fn);
  return () => ipcRenderer.removeListener("autoPublish:changed", fn);
}