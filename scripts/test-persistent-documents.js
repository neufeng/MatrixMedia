"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  joinDocumentsAppRoot,
  joinDocumentsDataDir,
  joinDocumentsFailScreenshotDir,
  migrateLegacyDocumentsAppFolder,
} = require("../src/shared/persistentDocuments.js");

const docs = fs.mkdtempSync(path.join(os.tmpdir(), "mm-docs-"));

const legacyData = path.join(docs, "MatrixMedia", "data", "account");
fs.mkdirSync(legacyData, { recursive: true });
fs.writeFileSync(path.join(legacyData, "a.json"), "[]");

assert.strictEqual(
  joinDocumentsAppRoot(docs),
  path.join(docs, "web", "MatrixMedia")
);
assert.strictEqual(
  joinDocumentsDataDir(docs),
  path.join(docs, "web", "MatrixMedia", "data")
);
assert.strictEqual(
  joinDocumentsFailScreenshotDir(docs),
  path.join(docs, "web", "MatrixMedia", "fail-screenshots")
);

migrateLegacyDocumentsAppFolder(docs, fs);

const migrated = path.join(docs, "web", "MatrixMedia", "data", "account", "a.json");
assert.ok(fs.existsSync(migrated), "应迁移 account 数据到新目录");
assert.ok(fs.existsSync(path.join(docs, "MatrixMedia", "data", "account", "a.json")), "旧目录应保留");

console.log("test-persistent-documents: ok");
