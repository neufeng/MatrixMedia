"use strict";

/**
 * 在纯 Node 测试里用 esbuild 打包主进程代码时，将 electron / puppeteer 链路旁路，
 * 避免运行时真实加载 puppeteer-core → @puppeteer/browsers → 旧版 yargs（Node 22+ 下
 * 无后缀 yargs 入口会被当作 ESM，触发 require is not defined）。
 */

const path = require("path");
const { buildSync } = require("esbuild");

const stubDir = path.join(__dirname, "node-test-stubs");

/** @type {Readonly<Record<string, string>>} */
const NODE_TEST_STUB_ALIASES = Object.freeze({
  electron: path.join(stubDir, "electron.cjs"),
  "puppeteer-core": path.join(stubDir, "puppeteer-core.cjs"),
  "puppeteer-extra": path.join(stubDir, "puppeteer-extra.cjs"),
  "puppeteer-in-electron": path.join(stubDir, "puppeteer-in-electron.cjs"),
  "puppeteer-extra-plugin-stealth": path.join(
    stubDir,
    "puppeteer-extra-plugin-stealth.cjs"
  ),
  "@puppeteer/browsers": path.join(stubDir, "puppeteer-browsers.cjs"),
});

const STUB_PACKAGE_NAMES = new Set(Object.keys(NODE_TEST_STUB_ALIASES));

/**
 * buildSync 封装：用 alias 把 electron / puppeteer 指到桩文件；勿再把上述包放进 external。
 *
 * @param {import('esbuild').BuildOptions} options
 * @param {Record<string, string>} [extraAliases]
 */
function buildSyncForNodeTest(options, extraAliases) {
  const external = Array.isArray(options.external) ? options.external : [];
  const filteredExternal = external.filter((id) => !STUB_PACKAGE_NAMES.has(id));
  const alias = {
    ...NODE_TEST_STUB_ALIASES,
    ...(options.alias || {}),
    ...(extraAliases || {}),
  };
  buildSync({
    ...options,
    alias,
    external: filteredExternal,
  });
}

module.exports = {
  NODE_TEST_STUB_ALIASES,
  buildSyncForNodeTest,
};