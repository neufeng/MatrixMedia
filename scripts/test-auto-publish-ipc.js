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

const { registerAutoPublishIpc } = load("src/main/services/autoPublishIpc.js", "autoPublishIpc.cjs");
const { createAutoPublishStore } = load("src/main/services/autoPublishStore.js", "autoPublishStore.cjs");
const { createXaiKeyStore } = load("src/main/services/xaiKeyStore.js", "xaiKeyStore.cjs");
const { testXaiConnection } = load("src/main/services/xaiClient.js", "xaiClient.cjs");

async function main() {
  const { server } = createXaiMockServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-ap-ipc-"));
  const store = createAutoPublishStore({ filePath: path.join(dir, "tasks.json") });
  const xaiStore = createXaiKeyStore({ filePath: path.join(dir, "xai.json"), safeStorage: null });
  xaiStore.save({ apiKey: VALID_KEY, baseURL, chatModel: "m", imageModel: "i" });

  const handlers = new Map();
  const fakeApp = { getPath: () => dir };
  const mockAccount = {
    phone: "u",
    pt: "头条",
    accountKey: "u",
    group: "u",
    createTime: 1,
  };
  registerAutoPublishIpc(
    { handle: (n, h) => handlers.set(n, h) },
    {
      store,
      xaiStore,
      app: fakeApp,
      testXai: testXaiConnection,
      listAccounts: () => [mockAccount],
      findAccountRecord: ({ phone, pt }) =>
        phone === "u" && pt === "头条" ? mockAccount : null,
    }
  );
  const call = (name, ...args) => handlers.get(name)({ senderFrame: { url: "file:///index.html" } }, ...args);

  const ext = await handlers.get("autoPublish:list")({ senderFrame: { url: "https://evil.com/" } });
  assert.strictEqual(ext.ok, false);

  let res = await call("xai:test", { useSaved: true });
  assert.strictEqual(res.ok, true);

  res = await call("autoPublish:list-accounts", { pt: "头条" });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.accounts.length, 1);
  assert.strictEqual(res.accounts[0].partition, "persist:u头条");

  res = await call("autoPublish:save", {
    name: "ipc测试",
    phone: "u",
    topicPrompt: "测试",
    schedule: { type: "once", onceAt: "2030-01-01 10:00:00" },
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.tasks.length, 1);
  assert.strictEqual(res.tasks[0].enabled, false);

  server.close();
  console.log("test:auto-publish-ipc: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});