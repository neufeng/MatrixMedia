"use strict";

/**
 * 矩媒 CLI 的 spawn 封装：捕获 stdout/stderr、解析最终回执 JSON、
 * 提取 [publish] 诊断行与 App 版本号。
 *
 * CLI 的机器可读回执是一行 JSON（channel=puppeteerFile-done）：
 * - 退出码 0：{ status: true, resultStatus, publishMode, draftVerified?, draftUrlUnchanged?, message }
 * - 退出码 4：{ status: false, resultStatus: "needs_attention", outcome, needsAttention: true, ... }
 * - 退出码 3：失败（stderr 文本）
 * 其中 draftVerified / draftUrlUnchanged 仅在含草稿校验逻辑（#42 修复）的 App 上输出。
 */

const { spawn } = require("child_process");
const readline = require("readline");

/**
 * 执行一条矩媒 CLI 命令
 * @param {string} cmd 可执行文件（打包 App 的二进制，或本地 electron）
 * @param {string[]} args 完整 argv（含 "cli" 子命令；dev 模式需先带应用路径 "."）
 * @param {object} options
 * @param {string} [options.cwd] 工作目录（dev 模式须为项目根）
 * @param {number} [options.timeoutMs]
 * @param {(line: string, isErr: boolean) => void} [options.onLine]
 */
function runCli(cmd, args, { cwd, timeoutMs = 300000, onLine } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ code: -1, spawnError: String((e && e.message) || e), stdout: [], stderr: [] });
      return;
    }

    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch (_) {
        /* already dead */
      }
    }, timeoutMs);

    const attach = (stream, isErr) => {
      const rl = readline.createInterface({ input: stream });
      rl.on("line", (line) => {
        (isErr ? stderr : stdout).push(line);
        if (onLine) {
          try {
            onLine(line, isErr);
          } catch (_) {
            /* 回调异常不影响采集 */
          }
        }
      });
    };
    attach(child.stdout, false);
    attach(child.stderr, true);

    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        spawnError: String((e && e.message) || e),
        stdout,
        stderr,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, stdout, stderr });
    });
  });
}

/** 从输出行里找最后一行机器回执 JSON（channel=puppeteerFile-done） */
function parseReceipt(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = (lines[i] || "").trim();
    if (!l.startsWith("{")) continue;
    try {
      const o = JSON.parse(l);
      if (o && o.channel === "puppeteerFile-done") return o;
    } catch (_) {
      /* not json */
    }
  }
  return null;
}

/** CLI 启动首行会打印 App 版本（如 "0.13.0 -------"） */
function parseAppVersion(lines) {
  for (const l of lines) {
    const m = String(l).match(/^\s*(\d+\.\d+\.\d+)/);
    if (m) return m[1];
  }
  return "";
}

/** 提取平台自动化诊断行（[publish]/[dy]/[sph]...），用于校准 #42 的信号文案 */
function collectEvidence(lines) {
  return lines.filter((l) =>
    /\[(publish|dy|sph|blbl|bjh|tt|ks|xhs)\]/.test(l)
  );
}

/** cli accounts --json：返回账号数组 + App 版本 */
async function fetchAccounts(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs || 90000;
  const cwd = opts.cwd;
  const r = await runCli(cmd, args, { cwd, timeoutMs });
  const version = parseAppVersion(r.stdout);
  // JSON 数组独占首行（stdout 里还有 [startup] 等日志行，不能用 indexOf("[") 定位）
  const startLine = r.stdout.findIndex((l) => /^\s*\[\s*$/.test(l));
  const endLine = r.stdout.map((l) => /^\s*\]\s*$/.test(l)).lastIndexOf(true);
  let accounts = [];
  if (startLine >= 0 && endLine > startLine) {
    try {
      const parsed = JSON.parse(r.stdout.slice(startLine, endLine + 1).join("\n"));
      if (Array.isArray(parsed)) accounts = parsed;
    } catch (_) {
      /* 解析失败按空处理 */
    }
  }
  return { accounts, version, raw: r };
}

module.exports = { runCli, parseReceipt, parseAppVersion, collectEvidence, fetchAccounts };
