"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildJobFields,
  buildGraphicJobFields,
  isGraphicJob,
} = require("./templates");
const { checkAccountLoggedIn } = require("./preflight");
const { runMatrixCli, resolveInvoker } = require("./matrixCli");
const { publishViaHttp, probeHttp } = require("./httpPublish");
const { discoverJobs, resolveVideoPath } = require("./jobs");
const {
  readState,
  checkRateLimits,
  recordPublish,
} = require("./state");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function moveJobTree(fromDir, toDir, label) {
  ensureDir(toDir);
  const dest = path.join(toDir, `${path.basename(fromDir)}-${timestamp()}`);
  fs.renameSync(fromDir, dest);
  return dest;
}

function writeLog(logPath, lines) {
  fs.appendFileSync(logPath, lines.join("\n") + "\n", "utf8");
}

function accountForPlatform(config, platform) {
  const acc = config.accounts[platform];
  if (!acc) {
    return null;
  }
  const phone = acc.phone || acc.partition;
  if (!phone) {
    return null;
  }
  return { platform, phone, partition: acc.partition || phone };
}

function buildPublishArticleCliArgs(platform, account, fields) {
  const args = [
    "publish-article",
    "-p",
    platform,
    "--phone",
    account.phone,
    "-t",
    fields.title,
  ];
  if (fields.content) {
    args.push("--content", fields.content);
  }
  if (fields.contentFile) {
    args.push("--file", fields.contentFile);
  }
  if (fields.cover) {
    args.push("--cover", fields.cover);
  }
  if (Array.isArray(fields.images) && fields.images.length) {
    args.push("--images", fields.images.join(","));
  }
  if (fields.tags) {
    args.push("--tags", fields.tags);
  }
  if (fields.publishAt) {
    args.push("--publish-at", fields.publishAt);
  }
  return args;
}

function buildPublishCliArgs(platform, account, fields) {
  const args = [
    "publish",
    "-p",
    platform,
    "--phone",
    account.phone,
    "-f",
    fields.file,
    "-t",
    fields.title,
  ];
  if (fields.description) {
    args.push("--description", fields.description);
  }
  if (fields.tags) {
    args.push("--tags", fields.tags);
  }
  if (fields.name) {
    args.push("--name", fields.name);
  }
  if (fields.publishAt) {
    args.push("--publish-at", fields.publishAt);
  }
  return args;
}

async function publishOnePlatform(
  config,
  invoker,
  httpUp,
  fields,
  account,
  log,
  options = {}
) {
  const pre = await checkAccountLoggedIn(config, invoker, account);
  if (!pre.ok) {
    return { ok: false, platform: account.platform, message: pre.message };
  }

  if (options.graphic) {
    if (config.matrixMedia.preferHttp && httpUp) {
      log.push(
        `[${account.platform}] 头条图文暂不支持 HTTP 发布，已改用 CLI publish-article`
      );
    }
    const cliArgs = buildPublishArticleCliArgs(account.platform, account, fields);
    if (config.dryRun) {
      const { command, args, cwd } = require("./matrixCli").buildSpawnArgs(
        invoker,
        cliArgs
      );
      const line = `[dry-run] ${command} ${args.join(" ")} (cwd=${cwd})`;
      log.push(line);
      return { ok: true, platform: account.platform, dryRun: true, message: line };
    }
    const result = await runMatrixCli(invoker, cliArgs, {
      timeoutMs: config.matrixMedia.cliTimeoutMs,
    });
    const ok = result.code === 0;
    log.push(
      `[${account.platform}] CLI publish-article 退出码 ${result.code}\n${result.stderr || result.stdout}`
    );
    return {
      ok,
      platform: account.platform,
      message: ok ? "图文发布成功" : `图文发布失败（退出码 ${result.code}）`,
      result,
    };
  }

  if (config.matrixMedia.preferHttp && httpUp) {
    const httpResult = await publishViaHttp(config, fields, account);
    log.push(
      `[${account.platform}] HTTP ${httpResult.ok ? "OK" : "FAIL"}: ${httpResult.message || ""}`
    );
    return {
      ok: httpResult.ok,
      platform: account.platform,
      message: httpResult.message,
      detail: httpResult,
    };
  }

  const cliArgs = buildPublishCliArgs(account.platform, account, fields);
  if (config.dryRun) {
    const { command, args, cwd } = require("./matrixCli").buildSpawnArgs(
      invoker,
      cliArgs
    );
    const line = `[dry-run] ${command} ${args.join(" ")} (cwd=${cwd})`;
    log.push(line);
    return { ok: true, platform: account.platform, dryRun: true, message: line };
  }

  const result = await runMatrixCli(invoker, cliArgs, {
    timeoutMs: config.matrixMedia.cliTimeoutMs,
  });
  const ok = result.code === 0;
  log.push(
    `[${account.platform}] CLI 退出码 ${result.code}\n${result.stderr || result.stdout}`
  );
  return {
    ok,
    platform: account.platform,
    message: ok ? "发布成功" : `发布失败（退出码 ${result.code}）`,
    result,
  };
}

/**
 * @param {ReturnType<import('./config').loadConfig>} config
 */
async function processOnce(config) {
  ensureDir(config.queue.incomingDir);
  ensureDir(config.queue.processingDir);
  ensureDir(config.queue.doneDir);
  ensureDir(config.queue.failedDir);

  const invoker = resolveInvoker(config);
  const httpUp =
    config.matrixMedia.preferHttp &&
    (config.dryRun || (await probeHttp(config)));

  let state = readState(config.stateFile);
  const rate = checkRateLimits(config, state);
  if (!rate.allowed) {
    return {
      processed: 0,
      skipped: true,
      reason: rate.reason,
      waitMs: rate.waitMs,
    };
  }

  const items = discoverJobs(config.queue.incomingDir);
  if (items.length === 0) {
    return { processed: 0, skipped: false, reason: "队列为空" };
  }

  let processed = 0;
  const maxBatch = config.concurrency;

  for (const item of items.slice(0, maxBatch)) {
    const workDir =
      item.jobFile && path.dirname(item.jobFile) === config.queue.incomingDir
        ? path.join(
            config.queue.processingDir,
            `job-${timestamp()}-${Math.random().toString(36).slice(2, 8)}`
          )
        : item.workDir;

    try {
      if (item.workDir !== workDir && fs.existsSync(item.workDir)) {
        ensureDir(path.dirname(workDir));
        fs.renameSync(item.workDir, workDir);
      }
    } catch (e) {
      /* 单文件 sidecar 任务不移动整个 incoming */
    }

    const effectiveDir = fs.existsSync(workDir) ? workDir : item.workDir;
    const logPath = path.join(effectiveDir, "autoposter-run.log");
    const log = [
      `# AutoPoster run ${new Date().toISOString()}`,
      `config=${config._meta.configFile}`,
      `dryRun=${config.dryRun}`,
      `invoker=${invoker.mode}:${invoker.bin}`,
    ];

    try {
      const graphicJob = isGraphicJob(item.jobDef);
      let fields;
      if (graphicJob) {
        fields = buildGraphicJobFields(
          item.jobDef,
          config.defaults,
          effectiveDir
        );
        if (!String(fields.content || "").trim() && !fields.contentFile) {
          throw new Error("图文任务缺少 content 或 contentFile");
        }
        if (
          fields.contentFile &&
          !fs.existsSync(fields.contentFile)
        ) {
          throw new Error(`正文文件不存在：${fields.contentFile}`);
        }
        for (const img of fields.images) {
          if (!fs.existsSync(img)) {
            throw new Error(`配图不存在：${img}`);
          }
        }
        if (fields.cover && !fs.existsSync(fields.cover)) {
          throw new Error(`封面不存在：${fields.cover}`);
        }
      } else {
        const videoPath = resolveVideoPath({ ...item, workDir: effectiveDir });
        if (!fs.existsSync(videoPath)) {
          throw new Error(`视频不存在：${videoPath}`);
        }
        fields = buildJobFields(item.jobDef, config.defaults, videoPath);
      }

      const platformResults = [];
      for (const platform of fields.platforms) {
        if (graphicJob && platform !== "tt") {
          platformResults.push({
            ok: false,
            platform,
            message: "图文任务当前仅支持 platforms: [\"tt\"]",
          });
          continue;
        }
        const account = accountForPlatform(config, platform);
        if (!account) {
          platformResults.push({
            ok: false,
            platform,
            message: `config.accounts.${platform} 未配置 phone/partition`,
          });
          continue;
        }
        const one = await publishOnePlatform(
          config,
          invoker,
          httpUp,
          fields,
          account,
          log,
          { graphic: graphicJob }
        );
        platformResults.push(one);
      }

      const allOk = platformResults.every((r) => r.ok);
      writeLog(logPath, log);

      const destRoot = allOk ? config.queue.doneDir : config.queue.failedDir;
      const incomingRoot = path.resolve(config.queue.incomingDir);
      const effAbs = path.resolve(effectiveDir);
      const underIncoming =
        effAbs === incomingRoot || effAbs.startsWith(incomingRoot + path.sep);

      if (fs.existsSync(effectiveDir) && underIncoming && item.jobFile) {
        moveJobTree(effectiveDir, destRoot, allOk ? "done" : "failed");
      } else if (fs.existsSync(effectiveDir) && effectiveDir.includes("processing")) {
        moveJobTree(effectiveDir, destRoot, allOk ? "done" : "failed");
      } else if (item.jobFile && fs.existsSync(item.jobFile)) {
        const sidecarDest = path.join(
          destRoot,
          path.basename(item.jobFile).replace(/\.json$/i, "") +
            `-${timestamp()}.json`
        );
        fs.copyFileSync(item.jobFile, sidecarDest);
        fs.unlinkSync(item.jobFile);
        writeLog(
          path.join(destRoot, `sidecar-${timestamp()}.log`),
          log.concat(`sidecar=${item.jobFile}`)
        );
      }

      if (allOk && !config.dryRun) {
        state = recordPublish(config.stateFile, state);
      }
      processed += 1;
    } catch (err) {
      log.push(`ERROR: ${err.message}`);
      writeLog(logPath, log);
      if (fs.existsSync(effectiveDir)) {
        try {
          moveJobTree(effectiveDir, config.queue.failedDir, "failed");
        } catch {
          /* ignore */
        }
      }
      processed += 1;
    }

    const again = checkRateLimits(config, state);
    if (!again.allowed) {
      break;
    }
  }

  return { processed, skipped: false };
}

module.exports = {
  processOnce,
  accountForPlatform,
  buildPublishCliArgs,
  buildPublishArticleCliArgs,
};
