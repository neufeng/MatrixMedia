"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const script = path.join(root, "scripts/migrate-data-to-project.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-migrate-"));
const src = path.join(tmp, "src-data");
const repo = path.join(tmp, "repo");
const target = path.join(repo, "data");
fs.mkdirSync(path.join(src, "account"), { recursive: true });
fs.writeFileSync(path.join(src, "account", "2026-01-01.json"), "[]");
fs.mkdirSync(repo);
fs.writeFileSync(
  path.join(repo, "package.json"),
  JSON.stringify({ name: "matrix-video", version: "0.0.0-test" })
);

execFileSync(process.execPath, [script, "--source", src, "--target", target], {
  cwd: repo,
  env: { ...process.env, MATRIXMEDIA_PROJECT_ROOT: repo },
  stdio: "pipe",
});
assert.ok(fs.existsSync(path.join(target, "account", "2026-01-01.json")));
assert.ok(!fs.existsSync(path.join(src, "account", "2026-01-01.json")), "应移动而非复制");

execFileSync(process.execPath, [script, "--source", src, "--target", target], {
  cwd: repo,
  env: { ...process.env, MATRIXMEDIA_PROJECT_ROOT: repo },
  stdio: "pipe",
});

const conflictSrc = path.join(tmp, "src-conflict");
const conflictFile = "pushData/x.json";
fs.mkdirSync(path.join(conflictSrc, "pushData"), { recursive: true });
fs.writeFileSync(path.join(conflictSrc, conflictFile), '{"a":1}');
fs.mkdirSync(path.join(target, "pushData"), { recursive: true });
fs.writeFileSync(path.join(target, conflictFile), '{"a":2}');
let exit = 0;
try {
  execFileSync(process.execPath, [script, "--source", conflictSrc, "--target", target], {
    cwd: repo,
    env: { ...process.env, MATRIXMEDIA_PROJECT_ROOT: repo },
    stdio: "pipe",
  });
} catch (e) {
  exit = e.status;
}
assert.strictEqual(exit, 2, "内容冲突应退出码 2");

console.log("test:migrate-data-to-project: ok");