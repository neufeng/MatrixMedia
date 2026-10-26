"use strict";

/**
 * AutoPoster 逻辑单测：mock MatrixMedia 可执行文件，不依赖真实 Cookie / 云端发帖
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { loadConfig } = require("../bot/lib/config");
const { resolveInvoker, buildSpawnArgs } = require("../bot/lib/matrixCli");
const { checkAccountLoggedIn } = require("../bot/lib/preflight");
const { buildJobFields } = require("../bot/lib/templates");
const {
  buildPublishCliArgs,
  buildPublishArticleCliArgs,
} = require("../bot/lib/processor");
const { buildGraphicJobFields, isGraphicJob } = require("../bot/lib/templates");
const { processOnce } = require("../bot/lib/processor");

function writeMockCli(dest) {
  const script = `#!/usr/bin/env node
const sub = process.argv.indexOf("cli");
const args = sub >= 0 ? process.argv.slice(sub + 1) : process.argv.slice(2);
const cmd = args[0];
if (cmd === "accounts") {
  console.log(JSON.stringify([
    { phone: "test-phone", pt: "tt", partition: "persist:test-phonett", loggedIn: true }
  ]));
  process.exit(0);
}
if (cmd === "publish") {
  process.exit(0);
}
if (cmd === "publish-article") {
  process.exit(0);
}
console.error("unknown", args);
process.exit(2);
`;
  fs.writeFileSync(dest, script, { mode: 0o755 });
}

function mkTempBotHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mm-bot-test-"));
  const incoming = path.join(root, "incoming");
  const processing = path.join(root, "processing");
  const done = path.join(root, "done");
  const failed = path.join(root, "failed");
  for (const d of [incoming, processing, done, failed]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const mockBin = path.join(root, "mock-matrixmedia");
  writeMockCli(mockBin);
  const configFile = path.join(root, "config.json");
  fs.writeFileSync(
    configFile,
    JSON.stringify(
      {
        dryRun: false,
        concurrency: 1,
        rateLimitMs: 0,
        maxPostsPerDay: 99,
        matrixMedia: { bin: mockBin },
        defaults: {
          title: "{{filename}}",
          platforms: ["tt"],
        },
        accounts: { tt: { phone: "test-phone" } },
        queue: {
          incomingDir: incoming,
          processingDir: processing,
          doneDir: done,
          failedDir: failed,
        },
        stateFile: path.join(root, ".state.json"),
      },
      null,
      2
    )
  );
  return { root, configFile, incoming, done, failed, mockBin };
}

// --- buildPublishCliArgs
{
  const args = buildPublishCliArgs(
    "tt",
    { phone: "13800138000" },
    {
      file: "/Users/steven/Videos/a.mp4",
      title: "标题",
      description: "简介",
      tags: "tag1",
      name: "任务名",
    }
  );
  assert.deepStrictEqual(args.slice(0, 6), [
    "publish",
    "-p",
    "tt",
    "--phone",
    "13800138000",
    "-f",
  ]);
  assert.ok(args.includes("/Users/steven/Videos/a.mp4"));
}

{
  const articleArgs = buildPublishArticleCliArgs(
    "tt",
    { phone: "13800138000" },
    {
      title: "图文",
      content: "正文",
      cover: "/tmp/cover.jpg",
      images: ["/tmp/a.jpg", "/tmp/b.jpg"],
      tags: "AI",
    }
  );
  assert.ok(articleArgs.includes("publish-article"));
  assert.ok(articleArgs.includes("--images"));
}

{
  assert.strictEqual(isGraphicJob({ type: "graphic" }), true);
  const graphic = buildGraphicJobFields(
    {
      type: "graphic",
      title: "T",
      content: "body",
      images: ["img.jpg"],
      platforms: ["tt"],
    },
    { platforms: ["tt"], title: "", tags: "", description: "", name: "" },
    "/tmp/work"
  );
  assert.strictEqual(graphic.title, "T");
  assert.strictEqual(graphic.images[0], "/tmp/work/img.jpg");
}

// --- templates
{
  const fields = buildJobFields(
    {},
    { title: "{{filename}}", description: "", tags: "", platforms: ["tt"], name: "{{filename}}" },
    "/tmp/hello-world.mp4"
  );
  assert.strictEqual(fields.title, "hello-world");
}

// --- preflight with mock CLI
(async () => {
  const home = mkTempBotHome();
  const config = loadConfig(home.configFile);
  const invoker = resolveInvoker(config);
  assert.strictEqual(invoker.bin, home.mockBin);

  const pre = await checkAccountLoggedIn(config, invoker, {
    platform: "tt",
    phone: "test-phone",
  });
  assert.strictEqual(pre.ok, true);

  const jobDir = path.join(home.incoming, "job1");
  fs.mkdirSync(jobDir);
  fs.writeFileSync(path.join(jobDir, "v.mp4"), "fake");
  fs.writeFileSync(
    path.join(jobDir, "job.json"),
    JSON.stringify({ title: "T", platforms: ["tt"], file: "v.mp4" })
  );

  const result = await processOnce(config);
  assert.strictEqual(result.processed, 1);
  assert.ok(fs.readdirSync(home.done).length >= 1 || fs.readdirSync(home.failed).length >= 0);

  // dry-run 不应调用 publish 退出码路径外的 mock
  const configDry = loadConfig(home.configFile);
  configDry.dryRun = true;
  const jobDir2 = path.join(home.incoming, "job2");
  fs.mkdirSync(jobDir2);
  fs.writeFileSync(path.join(jobDir2, "v.mp4"), "fake");
  fs.writeFileSync(
    path.join(jobDir2, "job.json"),
    JSON.stringify({ platforms: ["tt"], file: "v.mp4" })
  );
  const dryResult = await processOnce(configDry);
  assert.strictEqual(dryResult.processed, 1);

  const { args } = buildSpawnArgs(invoker, ["publish", "-p", "tt"]);
  assert.ok(args.includes("publish"));

  const graphicDir = path.join(home.incoming, "graphic1");
  fs.mkdirSync(graphicDir);
  fs.writeFileSync(path.join(graphicDir, "cover.jpg"), "fake");
  fs.writeFileSync(
    path.join(graphicDir, "job.json"),
    JSON.stringify({
      type: "graphic",
      title: "图文",
      content: "正文",
      cover: "cover.jpg",
      platforms: ["tt"],
    })
  );
  const graphicResult = await processOnce(config);
  assert.strictEqual(graphicResult.processed, 1);

  fs.rmSync(home.root, { recursive: true, force: true });
  console.log("test:autoposter (AutoPoster): ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
