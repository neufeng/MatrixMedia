"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

function load(entry, name) {
  const outfile = path.join(outDir, name);
  buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    external: ["electron", "axios"],
  });
  return require(outfile);
}

const {
  computeNextRunAt,
  advanceAfterMissedRun,
  normalizeAutoPublishTaskInput,
  shanghaiLocalToUtcMs,
  clipWeitoutiaoContent,
} = load("src/shared/autoPublishTask.js", "autoPublishTask.cjs");

const { createXaiKeyStore } = load("src/main/services/xaiKeyStore.js", "xaiKeyStore.cjs");
const { createAutoPublishStore } = load("src/main/services/autoPublishStore.js", "autoPublishStore.cjs");
const { maskApiKey } = load("src/shared/xaiSettings.js", "xaiSettings.cjs");

(() => {
  const at = shanghaiLocalToUtcMs("2026-11-22", "10:00:00");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
  assert.strictEqual(parts, "10:00");
})();

(() => {
  const task = {
    enabled: true,
    runCount: 0,
    schedule: { type: "daily", dailyTime: "10:00:00" },
  };
  const after = shanghaiLocalToUtcMs("2026-11-22", "09:00:00");
  const next = computeNextRunAt(task, after);
  assert.ok(next > after);
  const missed = advanceAfterMissedRun(task, shanghaiLocalToUtcMs("2026-11-22", "10:05:00"));
  assert.ok(missed.nextRunAt > shanghaiLocalToUtcMs("2026-11-22", "10:05:00"));
})();

(() => {
  const r = normalizeAutoPublishTaskInput({
    name: "测试",
    phone: "分组-测试",
    topicPrompt: "周末咖啡",
    schedule: { type: "once", onceAt: "2030-01-01 10:00:00" },
    enabled: true,
    allowRealPublish: true,
  }, { isNew: true });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.enabled, false);
  assert.strictEqual(r.value.allowRealPublish, false);
})();

(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-xai-store-"));
  const store = createXaiKeyStore({ filePath: path.join(dir, "xai-settings.json"), safeStorage: null });
  const pub = store.save({ apiKey: "xai-secret-key-abcdef", chatModel: "grok-test", imageModel: "grok-img" });
  assert.strictEqual(pub.hasKey, true);
  assert.ok(!pub.maskedKey.includes("abcdef".repeat(2)));
  const resolved = store.resolve();
  assert.strictEqual(resolved.apiKey, "xai-secret-key-abcdef");
  assert.strictEqual(maskApiKey(resolved.apiKey).includes("abcdef"), false);
})();

(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-ap-store-"));
  const store = createAutoPublishStore({ filePath: path.join(dir, "auto-publish-tasks.json") });
  const t = store.saveTask(
    {
      name: "demo",
      phone: "p",
      topicPrompt: "hello",
      schedule: { type: "daily", dailyTime: "10:00:00" },
    },
    { isNew: true }
  );
  assert.strictEqual(t.enabled, false);
  const lock = store.tryAcquireRunLock(t.id);
  assert.strictEqual(lock.ok, true);
  const lock2 = store.tryAcquireRunLock(t.id);
  assert.strictEqual(lock2.ok, false);
  store.releaseRunLock(t.id);
})();

(() => {
  const long = "字".repeat(120);
  assert.ok(clipWeitoutiaoContent(long).length <= 100);
})();

console.log("test:auto-publish-task: ok");