"use strict";

/**
 * 写入回读判据回归测试（2026-10-31 review 反馈）。
 *
 * 三个坑：
 * 1) slice(0,8) 按 UTF-16 code unit 切，emoji 跨边界会切出孤立代理对 → includes 永不命中
 * 2) 富文本把空格归一成 &nbsp;(U+00A0)/零宽字符，逐字节比较会误判
 * 3) 一次写不进去就中止会误杀正常发布 —— 判据必须允许「重输一次」
 */

const assert = require("assert");
const {
  head,
  normalizeForCompare,
  matchesHead,
} = require("../src/main/services/upLoad/textReadback.js");

// 1. 码点切片：emoji 不会被切半
{
  const s = "😀😀😀😀😀😀😀😀"; // 8 个 emoji = 16 code unit
  assert.strictEqual(head(s, 4), "😀😀😀😀");
  assert.strictEqual(Array.from(head(s, 4)).length, 4);

  // 对照组：slice 按 code unit 切，前 3 个单元 = 1 个完整 emoji + 1 个孤立高位代理
  const bad = s.slice(0, 3);
  assert.strictEqual(bad.length, 3, "3 个 code unit");
  assert.notStrictEqual(Array.from(bad).length, 3, "码点数是 2（含残缺代理对）");
}

// 2. 真实回归形态：前 8 个 code unit 落在 emoji 中间时，slice 会切出孤立代理对
{
  const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
  const title = "a😀😀😀😀标题：不读";
  assert.ok(LONE.test(title.slice(0, 8)), "对照组：slice 前缀含孤立高位代理");
  assert.ok(!LONE.test(head(title, 8)), "head 按码点切，不应出现孤立代理");
  assert.ok(matchesHead(title, title), "码点前缀必须命中自身");
  assert.strictEqual(Array.from(head(title, 8)).length, 8);
}

// 3. &nbsp; / 零宽字符 / 换行归一（按去空白比较）
{
  assert.strictEqual(normalizeForCompare("睢县\u00a0不读"), "睢县不读");
  assert.strictEqual(normalizeForCompare("睢县\u200b不读"), "睢县不读");
  assert.ok(matchesHead("睢县\u00a0不读jū：雎鸠", "睢县不读jū：雎鸠——一对形近字"));
  assert.ok(matchesHead("一个\n「查」字，两个读音", "一个「查」字，两个读音"), "换行归一后应命中");
}

// 4. 空期望串不约束（调用方本就不校验空内容）
{
  assert.strictEqual(matchesHead("任意内容", ""), true);
  assert.strictEqual(matchesHead("任意内容", null), true);
  assert.strictEqual(head(null), "");
}

// 5. 真正写错时必须判不命中（不能一律 true）
{
  assert.strictEqual(matchesHead("", "睢县不读jū"), false, "空写必须判失败");
  assert.strictEqual(matchesHead("完全不同的标题", "睢县不读jū"), false);
}

console.log("test-text-readback: 全部断言通过");
