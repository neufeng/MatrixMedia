"use strict";

const { runMatrixCli } = require("./matrixCli");

/**
 * @param {ReturnType<import('./config').loadConfig>} config
 * @param {ReturnType<typeof import('./matrixCli').resolveInvoker>} invoker
 * @param {{ platform: string, phone: string }} account
 */
async function checkAccountLoggedIn(config, invoker, account) {
  const { platform, phone } = account;
  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      message: `[dry-run] 跳过 accounts 预检：${platform} / ${phone}`,
    };
  }

  const result = await runMatrixCli(
    invoker,
    ["accounts", "-p", platform, "--phone", phone, "--json"],
    { timeoutMs: 120_000 }
  );

  if (result.code !== 0) {
    return {
      ok: false,
      message: `cli accounts 失败（退出码 ${result.code}）：${result.stderr || result.stdout}`,
      result,
    };
  }

  let rows;
  try {
    rows = JSON.parse(result.stdout.trim());
  } catch {
    return {
      ok: false,
      message: `cli accounts --json 输出无法解析为 JSON：${result.stdout.slice(0, 500)}`,
      result,
    };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      ok: false,
      message: `未找到账号：平台 ${platform}，phone/partition ${phone}。请先在 MatrixMedia GUI 登录并保存账号。`,
      result,
    };
  }

  const row = rows.find(
    (r) =>
      r.phone === phone ||
      r.partition === phone ||
      String(r.partition || "").includes(phone)
  );
  const target = row || rows[0];

  if (!target.loggedIn) {
    return {
      ok: false,
      message: `账号未登录或 Cookie 已过期：${platform} / ${phone}（${target.reason || "loggedIn=false"}）。请在本机 GUI 重新登录。`,
      result,
      account: target,
    };
  }

  return { ok: true, account: target, result };
}

module.exports = { checkAccountLoggedIn };
