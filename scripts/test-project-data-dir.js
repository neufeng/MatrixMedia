"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const out = path.join(root, "test/.cache", "projectDataRoot.cjs");
buildSync({
  entryPoints: [path.join(root, "src/shared/projectDataRoot.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: out,
});
const {
  resolveProjectRoot,
  resolveBusinessDataDir,
  isInsideAsar,
} = require(out);

const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "mm-repo-"));
fs.writeFileSync(
  path.join(tmpRepo, "package.json"),
  JSON.stringify({ name: "matrix-video", version: "0.0.0-test" })
);

(() => {
  const oldRoot = process.env.MATRIXMEDIA_PROJECT_ROOT;
  const oldData = process.env.MATRIXMEDIA_DATA_DIR;
  process.env.MATRIXMEDIA_PROJECT_ROOT = tmpRepo;
  delete process.env.MATRIXMEDIA_DATA_DIR;
  assert.strictEqual(resolveProjectRoot({ moduleDir: path.join(tmpRepo, "src/shared") }), tmpRepo);
  assert.strictEqual(
    resolveBusinessDataDir({ moduleDir: path.join(tmpRepo, "src/shared") }),
    path.join(tmpRepo, "data")
  );
  process.env.MATRIXMEDIA_PROJECT_ROOT = oldRoot;
  process.env.MATRIXMEDIA_DATA_DIR = oldData;
})();

(() => {
  const oldData = process.env.MATRIXMEDIA_DATA_DIR;
  const dataDir = path.join(tmpRepo, "custom-data");
  process.env.MATRIXMEDIA_DATA_DIR = dataDir;
  delete process.env.MATRIXMEDIA_PROJECT_ROOT;
  assert.strictEqual(resolveBusinessDataDir({ moduleDir: tmpRepo }), path.resolve(dataDir));
  process.env.MATRIXMEDIA_DATA_DIR = oldData;
})();

(() => {
  assert.strictEqual(isInsideAsar("/foo/app.asar/main.js"), true);
  const oldRoot = process.env.MATRIXMEDIA_PROJECT_ROOT;
  const oldData = process.env.MATRIXMEDIA_DATA_DIR;
  delete process.env.MATRIXMEDIA_PROJECT_ROOT;
  delete process.env.MATRIXMEDIA_DATA_DIR;
  assert.throws(
    () => resolveBusinessDataDir({ moduleDir: "/Applications/Foo.app/Contents/Resources/app.asar/dist" }),
    (e) => e.code === "MATRIXMEDIA_NO_DATA_ROOT"
  );
  process.env.MATRIXMEDIA_PROJECT_ROOT = oldRoot;
  process.env.MATRIXMEDIA_DATA_DIR = oldData;
})();

console.log("test:project-data-dir: ok");