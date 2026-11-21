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
const outfile = path.join(outDir, "xaiClient.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/xaiClient.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  external: [],
});
const {
  generateWeitoutiaoText,
  generateWeitoutiaoImage,
  saveXaiImageToDir,
  testXaiConnection,
} = require(outfile);

async function main() {
  const { server } = createXaiMockServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const baseURL = `http://127.0.0.1:${port}/v1`;
  const provider = { baseURL, apiKey: VALID_KEY, chatModel: "grok-mock", imageModel: "grok-img-mock" };

  const text = await generateWeitoutiaoText(provider, "午后咖啡");
  assert.ok(text.content.length >= 10);

  const img = await generateWeitoutiaoImage(provider, "咖啡", "");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-xai-img-"));
  const saved = await saveXaiImageToDir(img.payload, dir);
  assert.ok(fs.existsSync(saved));

  const bad = await testXaiConnection({ ...provider, apiKey: "bad" }).catch((e) => e);
  assert.ok(/xAI API Key/.test(bad.message));
  assert.ok(!bad.message.includes(VALID_KEY));

  const ok = await testXaiConnection(provider);
  assert.ok(ok.latencyMs >= 0);

  server.close();
  console.log("test:xai-client: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});