"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSyncForNodeTest } = require("./esbuild-node-test-stubs.js");
const { createXaiMockServer, VALID_KEY } = require("./xai-mock-server.js");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

function load(entry, name) {
  const outfile = path.join(outDir, name);
  buildSyncForNodeTest({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
  });
  return require(outfile);
}

const { registerAutoPublishIpc } = load("src/main/services/autoPublishIpc.js", "autoPublishAllowRealIpc.cjs");
const { createAutoPublishStore } = load("src/main/services/autoPublishStore.js", "autoPublishAllowRealStore.cjs");
const { createXaiKeyStore } = load("src/main/services/xaiKeyStore.js", "autoPublishAllowRealXai.cjs");
const { runAutoPublishTask } = load("src/main/services/autoPublishEngine.js", "autoPublishAllowRealEngine.cjs");
const { shouldAutoPublishDryRun } = load("src/shared/autoPublishTask.js", "autoPublishAllowRealShared.cjs");
const { testXaiConnection } = load("src/main/services/xaiClient.js", "autoPublishAllowRealXaiClient.cjs");

const SCHEDULE = { type: "once", onceAt: "2030-06-01 10:00:00" };
const mockAccount = { phone: "u", pt: "头条", accountKey: "u", group: "u", createTime: 1 };

async function main() {
  const { server } = createXaiMockServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-ap-allow-"));
  const store = createAutoPublishStore({ filePath: path.join(dir, "tasks.json") });
  const xaiStore = createXaiKeyStore({ filePath: path.join(dir, "xai.json"), safeStorage: null });
  xaiStore.save({ apiKey: VALID_KEY, baseURL, chatModel: "m", imageModel: "i" });
  const assetsDir = path.join(dir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const handlers = new Map();
  registerAutoPublishIpc(
    { handle: (n, h) => handlers.set(n, h) },
    {
      store,
      xaiStore,
      app: { getPath: () => dir },
      testXai: testXaiConnection,
      listAccounts: () => [mockAccount],
      findAccountRecord: ({ phone, pt }) => (phone === "u" && pt === "头条" ? mockAccount : null),
    }
  );
  const call = (name, ...args) => handlers.get(name)({ senderFrame: { url: "file:///index.html" } }, ...args);

  let res = await call("autoPublish:save", {
    name: "新建即正式",
    phone: "u",
    topicPrompt: "测试",
    schedule: SCHEDULE,
    enabled: true,
    allowRealPublish: true,
  });
  assert.strictEqual(res.ok, true);
  const created = res.tasks[0];
  assert.strictEqual(created.allowRealPublish, true);
  assert.strictEqual(shouldAutoPublishDryRun(created), false);

  const lock = store.tryAcquireRunLock(created.id);
  assert.strictEqual(shouldAutoPublishDryRun(lock.task), false);
  assert.strictEqual(lock.task.allowRealPublish, true, "执行锁快照应与已保存授权一致");
  store.recordRun({
    taskId: created.id,
    taskName: created.name,
    status: "success",
    dryRun: false,
    allowRealPublishAtRun: true,
    message: "mock",
  });
  const snap = store.list().runs[0];
  assert.strictEqual(snap.allowRealPublishAtRun, true);
  assert.strictEqual(snap.dryRun, false);
  store.releaseRunLock(created.id);

  res = await call("autoPublish:save", {
    ...created,
    allowRealPublish: false,
  });
  const edited = res.tasks.find((t) => t.id === created.id);
  assert.strictEqual(edited.allowRealPublish, false);
  const lock2 = store.tryAcquireRunLock(edited.id);
  const dryOn = await runAutoPublishTask({
    task: lock2.task,
    xaiProvider: xaiStore.resolve(),
    assetsDir,
    dryRun: shouldAutoPublishDryRun(lock2.task),
  });
  assert.strictEqual(dryOn.dryRun, true);
  assert.ok(dryOn.message.includes("未开启正式自动发布"));
  store.releaseRunLock(edited.id);

  const raw = JSON.parse(fs.readFileSync(store.filePath, "utf8"));
  raw.tasks[0].allowRealPublish = "true";
  fs.writeFileSync(store.filePath, JSON.stringify(raw));
  const loaded = store.getTask(created.id);
  assert.strictEqual(loaded.allowRealPublish, false, "磁盘字符串 true 须视为未授权");

  server.close();
  console.log("test:auto-publish-allow-real: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});