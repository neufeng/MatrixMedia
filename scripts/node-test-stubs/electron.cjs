"use strict";

module.exports = {
  ipcMain: { handle() {}, on() {}, emit() {} },
  app: { getPath() { return ""; } },
  BrowserWindow: { getAllWindows() { return []; } },
  dialog: {},
  safeStorage: null,
};