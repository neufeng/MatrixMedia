"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { buildSyncForNodeTest } = require("./esbuild-node-test-stubs.js");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const flattenOut = path.join(outDir, "flattenAccountGetData.cjs");
const optionsOut = path.join(outDir, "autoPublishAccountOptions.cjs");
buildSyncForNodeTest({
  entryPoints: [path.join(root, "src/shared/flattenAccountGetData.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: flattenOut,
});
buildSyncForNodeTest({
  entryPoints: [path.join(root, "src/shared/autoPublishAccountOptions.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: optionsOut,
});
const { flattenAccountGetData } = require(flattenOut);
const { buildAutoPublishAccountOptions } = require(optionsOut);

/** 模拟 changeData account/get 的 data 形状（按日期分桶，非数组） */
const BUCKETED = {
  "2026-11-20": [
    {
      id: "old",
      phone: "toutiao",
      pt: "头条",
      group: "toutiao",
      accountName: "toutiao",
      accountKey: "toutiao",
      createTime: 1,
    },
  ],
  "2026-11-21": [
    {
      id: "new",
      phone: "toutiao",
      pt: "头条",
      group: "toutiao",
      accountName: "toutiao",
      accountKey: "toutiao",
      createTime: 2,
    },
    {
      id: "xhs",
      phone: "demo",
      pt: "小红书",
      group: "demo",
      createTime: 2,
    },
  ],
};

(() => {
  const wrong = (BUCKETED && BUCKETED.data) || BUCKETED;
  assert.ok(!Array.isArray(wrong));
  assert.ok(typeof wrong.filter !== "function", "分桶对象不能直接 .filter（旧实现会得到空列表）");
})();

(() => {
  const flat = flattenAccountGetData(BUCKETED);
  assert.strictEqual(flat.length, 2);
  const tt = flat.find((r) => r.pt === "头条");
  assert.ok(tt);
  assert.strictEqual(tt.id, "new");
})();

(() => {
  const opts = buildAutoPublishAccountOptions(BUCKETED, "头条");
  assert.strictEqual(opts.length, 1);
  assert.strictEqual(opts[0].phone, "toutiao");
  assert.strictEqual(opts[0].partition, "persist:toutiao头条");
  assert.ok(opts[0].label.includes("头条"));
})();

(() => {
  assert.deepStrictEqual(buildAutoPublishAccountOptions({}, "头条"), []);
  assert.deepStrictEqual(buildAutoPublishAccountOptions([], "头条"), []);
})();

console.log("test:auto-publish-accounts: ok");