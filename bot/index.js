"use strict";

const path = require("path");
const minimist = require("minimist");
const { loadConfig, REPO_ROOT } = require("./lib/config");
const { processOnce } = require("./lib/processor");

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const argv = minimist(process.argv.slice(2), {
    boolean: ["once", "watch", "dry-run", "help"],
    string: ["config"],
    alias: { c: "config", h: "help" },
  });

  if (argv.help) {
    console.log(`MatrixMedia 本机自动发布 Bot（队列 → matrixmedia cli publish）

用法（请在 Steven 的 Mac 本机终端执行，而非云端 VM）：
  node bot/index.js --once [--config /path/to/config.json] [--dry-run]
  node bot/index.js --watch [--config ...]

环境变量：
  MATRIXMEDIA_BIN  覆盖 MatrixMedia 可执行文件路径
  BOT_CONFIG       默认配置文件路径

yarn 快捷方式（仓库根目录）：
  yarn bot:once
  yarn bot:watch
`);
    process.exit(0);
  }

  const configPath =
    argv.config ||
    process.env.BOT_CONFIG ||
    path.join(REPO_ROOT, "bot", "config.example.json");

  const config = loadConfig(configPath);
  if (argv["dry-run"]) {
    config.dryRun = true;
  }

  const once = argv.once || !argv.watch;
  const watch = argv.watch;

  console.log(
    `[bot] 本机模式 | config=${config._meta.configFile} | dryRun=${config.dryRun}`
  );
  console.log(
    `[bot] 队列目录 incoming=${config.queue.incomingDir}`
  );

  if (once && !watch) {
    const result = await processOnce(config);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  console.log(
    `[bot] 监视模式 pollIntervalMs=${config.schedule.pollIntervalMs}（Ctrl+C 退出）`
  );
  for (;;) {
    const result = await processOnce(config);
    if (result.processed > 0 || result.skipped) {
      console.log(new Date().toISOString(), JSON.stringify(result));
    }
    const wait =
      result.waitMs != null
        ? Math.max(result.waitMs, config.schedule.pollIntervalMs)
        : config.schedule.pollIntervalMs;
    await sleep(wait);
  }
}

main().catch((err) => {
  console.error("[bot] 致命错误：", err.message);
  process.exit(1);
});
