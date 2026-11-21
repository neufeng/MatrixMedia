"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSync } = require("esbuild");
const { createXaiMockServer, VALID_KEY } = require("./xai-mock-server.js");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, "autoPublishEngine.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/autoPublishEngine.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  external: [
    "electron",
    "puppeteer-core",
    "puppeteer-extra",
    "puppeteer-in-electron",
    "puppeteer-extra-plugin-stealth",
  ],
});
const { runAutoPublishTask } = require(outfile);

async function main() {
  const { server } = createXaiMockServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  const provider = { baseURL, apiKey: VALID_KEY, chatModel: "m", imageModel: "i" };
  const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-ap-eng-"));
  const task = {
    id: "t1",
    name: "engine",
    pt: "头条",
    phone: "demo",
    topicPrompt: "咖啡",
    generateImage: true,
    allowRealPublish: false,
  };
  const result = await runAutoPublishTask({ task, xaiProvider: provider, assetsDir, dryRun: true });
  assert.strictEqual(result.dryRun, true);
  assert.ok(result.content.length > 0);
  assert.ok(fs.existsSync(result.imagePath));
  server.close();
  console.log("test:auto-publish-engine: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});