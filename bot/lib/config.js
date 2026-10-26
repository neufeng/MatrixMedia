"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");

function loadYaml(raw) {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    return require("js-yaml").load(raw);
  } catch (e) {
    if (e.code === "MODULE_NOT_FOUND") {
      throw new Error(
        "读取 YAML 配置需要 js-yaml：在仓库根目录执行 yarn add -D js-yaml，或改用 config.json"
      );
    }
    throw e;
  }
}

function loadConfigFile(configPath) {
  const abs = path.resolve(configPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`配置文件不存在：${abs}`);
  }
  const raw = fs.readFileSync(abs, "utf8");
  if (/\.ya?ml$/i.test(abs)) {
    return loadYaml(raw);
  }
  return JSON.parse(raw);
}

function resolvePath(baseDir, p) {
  if (!p || path.isAbsolute(p)) {
    return p;
  }
  return path.resolve(baseDir, p);
}

/**
 * @param {string} configPath
 * @param {{ repoRoot?: string }} opts
 */
function loadConfig(configPath, opts = {}) {
  const configFile = path.resolve(configPath);
  const configDir = path.dirname(configFile);
  const repoRoot = opts.repoRoot || REPO_ROOT;
  const raw = loadConfigFile(configFile);

  const queue = raw.queue || {};
  const matrixMedia = raw.matrixMedia || {};

  const incomingDir = resolvePath(configDir, queue.incomingDir || "queue/incoming");
  const processingDir = resolvePath(configDir, queue.processingDir || "queue/processing");
  const doneDir = resolvePath(configDir, queue.doneDir || "queue/done");
  const failedDir = resolvePath(configDir, queue.failedDir || "queue/failed");
  const stateFile = resolvePath(
    configDir,
    raw.stateFile || path.join("queue", ".bot-state.json")
  );

  return {
    ...raw,
    _meta: { configFile, configDir, repoRoot },
    dryRun: Boolean(raw.dryRun),
    concurrency: Math.max(1, Number(raw.concurrency) || 1),
    rateLimitMs: Math.max(0, Number(raw.rateLimitMs) ?? 60_000),
    maxPostsPerDay: Math.max(0, Number(raw.maxPostsPerDay) ?? 20),
    defaults: {
      title: raw.defaults?.title ?? "{{filename}}",
      description: raw.defaults?.description ?? "",
      tags: raw.defaults?.tags ?? "",
      platforms: Array.isArray(raw.defaults?.platforms)
        ? raw.defaults.platforms
        : ["tt", "xhs"],
      name: raw.defaults?.name ?? "{{filename}}",
    },
    accounts: raw.accounts || {},
    queue: {
      incomingDir,
      processingDir,
      doneDir,
      failedDir,
    },
    stateFile,
    schedule: {
      pollIntervalMs: Math.max(1000, Number(raw.schedule?.pollIntervalMs) ?? 30_000),
      cron: raw.schedule?.cron || null,
    },
    matrixMedia: {
      /** 本机 MatrixMedia 可执行文件，Mac 默认 .app 内二进制 */
      bin:
        matrixMedia.bin ||
        process.env.MATRIXMEDIA_BIN ||
        process.env.BOT_MATRIXMEDIA_BIN ||
        null,
      /** 源码仓库根目录；设则 dev 模式用 electron . cli … */
      repoRoot: matrixMedia.repoRoot || null,
      preferHttp: Boolean(matrixMedia.preferHttp),
      httpBaseUrl: matrixMedia.httpBaseUrl || "http://127.0.0.1:30088",
      httpTimeoutMs: Number(matrixMedia.httpTimeoutMs) || 120_000,
      cliTimeoutMs: Number(matrixMedia.cliTimeoutMs) || 45 * 60 * 1000,
    },
  };
}

module.exports = { loadConfig, REPO_ROOT };
