"use strict";

/**
 * 定时任务去重判据回归测试（2026-10-30 查篇双发风险）。
 *
 * 背景：同一秒内为同一视频创建了两条 publishAt 相同的定时记录，
 * server/utils 的 isDuplicate 显式排除 scheduledTask，触发时无并发保护。
 * 本测试锁住 scheduledDedupe 的判据：同键且仍待触发才算重复。
 */

const path = require("path");
const fs = require("fs");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const bundle = path.join(outDir, "scheduledDedupe.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/scheduledDedupe.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});

const { scheduledKey, findExistingScheduled } = require(bundle);

const base = {
  pt: "视频号",
  partition: "persist:字探视频号",
  phone: "字探",
  filePath: "/Users/lucas/zitan/output/成片/成片_查_v2.mp4",
  textType: "local",
  scheduledPublishAt: 1793362221609839,
};

function rec(over = {}) {
  return { ...base, scheduledTask: true, publishStatus: "scheduled", id: "r1", ...over };
}

// 1. 同键 + 仍待触发 → 判重复
{
  const existing = rec();
  const candidate = rec({ id: "r2" });
  assert.strictEqual(scheduledKey(candidate), scheduledKey(existing));
  assert.strictEqual(findExistingScheduled([existing], candidate), existing);
}

// 2. 同键但已发布/发布中/失败/取消 → 不算重复（允许重新排期）
["published", "publishing", "failed", "skipped", "canceled"].forEach((status) => {
  assert.strictEqual(
    findExistingScheduled([rec({ publishStatus: status })], rec()),
    undefined,
    `publishStatus=${status} 不应被判成重复`
  );
});

// 3. 定时时刻不同 → 不是同一任务
{
  assert.strictEqual(
    findExistingScheduled([rec({ scheduledPublishAt: base.scheduledPublishAt + 3600000 })], rec()),
    undefined
  );
}

// 4. 文件不同 / 平台不同 / 账号分区不同 → 不是同一任务
[
  { filePath: "/tmp/other.mp4" },
  { pt: "抖音" },
  { partition: "persist:字探抖音" },
  { phone: "字探-" },
].forEach((over) => {
  assert.strictEqual(findExistingScheduled([rec(over)], rec()), undefined, JSON.stringify(over));
});

// 5. 非定时任务的历史记录（干跑登记）不参与去重
{
  const plain = { ...base, id: "p1", publishStatus: "success" };
  assert.strictEqual(findExistingScheduled([plain], rec()), undefined);
}

// 6. 空值归一：null/undefined 与空串等价，避免同任务被判成不同
{
  const a = rec({ phone: null });
  const b = rec({ phone: "" });
  assert.strictEqual(scheduledKey(a), scheduledKey(b));
  assert.strictEqual(findExistingScheduled([a], b), a);
}

// 7. 越界输入不抛错
{
  assert.strictEqual(findExistingScheduled(null, rec()), undefined);
  assert.strictEqual(findExistingScheduled([], rec()), undefined);
  assert.strictEqual(findExistingScheduled([null, undefined], rec()), undefined);
  assert.strictEqual(scheduledKey(null), "");
}

console.log("test-scheduled-dedupe: 全部断言通过");
