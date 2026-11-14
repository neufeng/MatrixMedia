"use strict";

/**
 * pushData 登记去重合并（changeData add + isSamePushDataRecord）回归测试：
 * 1. 重复登记时内容字段以最后一次为准（coverPath/tags/title 可刷新）
 * 2. 只存在于旧记录的历史字段（videoLink/publishAbnormalCount/needsAttention
 *    等后续 update 写入的结果字段）不被合并清掉
 * 3. newItem 显式带空值（coverPath: ""）照样覆盖旧值
 * 4. id/createTime 保持首次登记值，attemptCount/republishCount 递增
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const Module = require("module");

const root = path.join(__dirname, "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mm-pushdata-dedupe-"));
const docsDir = path.join(tmpRoot, "documents");
const userDataDir = path.join(tmpRoot, "userData");
fs.mkdirSync(docsDir, { recursive: true });

// getDataDir() 走 electron app.getPath("documents")；用假 electron 模块把数据目录指到临时目录
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") {
    return {
      app: {
        getPath: (name) => (name === "documents" ? docsDir : userDataDir),
      },
    };
  }
  return origLoad.call(this, request, ...rest);
};

const { changeData } = require(path.join(root, "src/main/server/utils.js"));

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function baseRecord(overrides = {}) {
  return {
    bookName: "vid",
    textOtherName: "vid",
    textType: "local",
    pt: "抖音",
    selectedFile: "vid.mp4",
    title: "标题一",
    description: "简介",
    tags: "#甲",
    coverPath: "",
    date: today(),
    ...overrides,
  };
}

function readList() {
  const file = path.join(docsDir, "MatrixMedia", "data", "pushData", `${today()}.json`);
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

(async () => {
  // 1. 首次登记
  const add1 = changeData({ fileName: "pushData", type: "add", item: baseRecord() });
  assert.strictEqual(add1.success, true);
  assert.strictEqual(add1.data.length, 1);
  const id = add1.data[0].id;
  const createTime = add1.data[0].createTime;
  assert.strictEqual(add1.data[0].publishAttemptCount, 1);

  // 2. 模拟发布结果回写（update 写入只存在于旧记录的历史字段）
  const upd = changeData({
    fileName: "pushData",
    type: "update",
    item: {
      id,
      date: today(),
      videoLink: "https://www.douyin.com/video/123",
      publishAbnormalCount: 2,
      needsAttention: true,
      publishSuccessCount: 1,
      publishStatus: "success",
    },
  });
  assert.strictEqual(upd.success, true);

  // 3. 同文件重复登记（后补 coverPath、改 tags/title）→ 合并为同一条
  const add2 = changeData({
    fileName: "pushData",
    type: "add",
    item: baseRecord({
      title: "标题二",
      tags: "#乙",
      coverPath: "/tmp/cover_3x4.png",
    }),
  });
  assert.strictEqual(add2.success, true);
  assert.strictEqual(add2.data.length, 1, "重复登记不应新增记录");
  const merged = add2.data[0];

  // 内容字段以最后一次为准
  assert.strictEqual(merged.title, "标题二");
  assert.strictEqual(merged.tags, "#乙");
  assert.strictEqual(merged.coverPath, "/tmp/cover_3x4.png");
  // 历史字段保留（合并基底是 oldItem）
  assert.strictEqual(merged.videoLink, "https://www.douyin.com/video/123");
  assert.strictEqual(merged.publishAbnormalCount, 2);
  assert.strictEqual(merged.needsAttention, true);
  assert.strictEqual(merged.publishSuccessCount, 1);
  // id/createTime 保持首次登记值；计数递增；状态回到发布中
  assert.strictEqual(merged.id, id);
  assert.strictEqual(merged.createTime, createTime);
  assert.strictEqual(merged.publishAttemptCount, 2);
  assert.strictEqual(merged.republishCount, 1);
  assert.strictEqual(merged.publishStatus, "publishing");
  assert.strictEqual(merged.failScreenshot, "");

  // 4. newItem 显式空值照样覆盖（「以最后一次为准」含清空语义）
  const add3 = changeData({
    fileName: "pushData",
    type: "add",
    item: baseRecord({ coverPath: "" }),
  });
  assert.strictEqual(add3.data.length, 1);
  assert.strictEqual(add3.data[0].coverPath, "");
  // 历史字段仍在
  assert.strictEqual(add3.data[0].videoLink, "https://www.douyin.com/video/123");
  assert.strictEqual(add3.data[0].publishAbnormalCount, 2);
  assert.strictEqual(add3.data[0].publishAttemptCount, 3);

  // 5. 落盘内容与返回一致
  const onDisk = readList();
  assert.strictEqual(onDisk.length, 1);
  assert.strictEqual(onDisk[0].id, id);
  assert.strictEqual(onDisk[0].videoLink, "https://www.douyin.com/video/123");

  console.log("pushdata-dedupe: 全部断言通过");
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = origLoad;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_) {}
  });
