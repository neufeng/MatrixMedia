"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_MAC_BIN =
  "/Applications/matrixmedia.app/Contents/MacOS/matrixmedia";

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * 解析本机 MatrixMedia 启动方式（Steven Mac 为主路径）
 * @param {import('./config').loadConfig extends Function ? ReturnType<import('./config').loadConfig> : any} config
 */
function resolveInvoker(config) {
  const mm = config.matrixMedia || {};
  const repoRoot = mm.repoRoot || config._meta?.repoRoot;

  if (mm.bin) {
    return { mode: "installed", bin: mm.bin, cwd: repoRoot || process.cwd() };
  }

  if (fileExists(DEFAULT_MAC_BIN)) {
    return { mode: "installed", bin: DEFAULT_MAC_BIN, cwd: process.cwd() };
  }

  const electronBin = repoRoot
    ? path.join(repoRoot, "node_modules", "electron", "dist", "electron")
    : null;
  const electronBinMac = repoRoot
    ? path.join(
        repoRoot,
        "node_modules",
        "electron",
        "dist",
        "Electron.app",
        "Contents",
        "MacOS",
        "Electron"
      )
    : null;

  if (electronBinMac && fileExists(electronBinMac)) {
    return { mode: "dev", bin: electronBinMac, cwd: repoRoot };
  }
  if (electronBin && fileExists(electronBin)) {
    return { mode: "dev", bin: electronBin, cwd: repoRoot };
  }

  return { mode: "installed", bin: "matrixmedia", cwd: process.cwd() };
}

/**
 * @param {ReturnType<typeof resolveInvoker>} invoker
 * @param {string[]} cliArgs  不含 leading `cli`，例如 ['accounts','--json']
 */
function buildSpawnArgs(invoker, cliArgs) {
  const args = invoker.mode === "dev" ? [".", "cli", ...cliArgs] : ["cli", ...cliArgs];
  return { command: invoker.bin, args, cwd: invoker.cwd };
}

/**
 * @param {ReturnType<typeof resolveInvoker>} invoker
 * @param {string[]} cliArgs
 * @param {{ timeoutMs?: number, env?: Record<string,string> }} opts
 */
function runMatrixCli(invoker, cliArgs, opts = {}) {
  const { command, args, cwd } = buildSpawnArgs(invoker, cliArgs);
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;

  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...opts.env };
    if (invoker.mode === "dev") {
      env.ELECTRON_RUN_AS_NODE = "";
    } else {
      delete env.ELECTRON_RUN_AS_NODE;
    }

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `MatrixMedia CLI 超时（${timeoutMs}ms）：${command} ${args.join(" ")}`
        )
      );
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `无法启动 MatrixMedia（${command}）：${err.message}。请在本机安装 MatrixMedia 或设置 matrixMedia.bin / MATRIXMEDIA_BIN`
        )
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, command, args, cwd });
    });
  });
}

module.exports = {
  DEFAULT_MAC_BIN,
  resolveInvoker,
  buildSpawnArgs,
  runMatrixCli,
};
