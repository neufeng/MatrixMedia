"use strict";

/**
 * 粉丝趋势裁剪回归测试（2026-10-31 视频号「一年假平线」）。
 *
 * 背景：fans_trend(startTs=今天-365天) 会把账号创建前的时段用填充点返回
 * （账号 10-20 建，接口回了 2025-10-21 起的 366 个点、值恒为 1），
 * adapters.js 按索引推日期 → 趋势图出现一年平线。
 * 判据：只保留最早作品发布日（+8）之后的点；无作品时留最近 7 天。
 */

const assert = require("assert");
const {
  clampFansHistory,
  CLAMP_FANS_HISTORY_SRC,
} = require("../src/main/services/dataStats/fansHistory.js");

function series(startDate, days, value = 1) {
  const out = [];
  const d = new Date(startDate + "T00:00:00Z");
  for (let i = 0; i < days; i++) {
    out.push({ date: d.toISOString().slice(0, 10), value });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// 1. 视频号真实形态：364 天账号前填充 + 首篇作品 2026-10-20 → 只剩发布日之后
{
  const hist = series("2025-10-21", 365); // 至 2026-10-20
  const works = [{ publishTime: Date.parse("2026-10-20T05:59:32Z") }];
  const kept = clampFansHistory(hist, works, Date.parse("2026-10-31T00:00:00Z"));
  assert.strictEqual(kept.length, 1, `应只剩发布当天，实际 ${kept.length}`);
  assert.strictEqual(kept[0].date, "2026-10-20");
}

// 2. 发布日之后的历史完整保留
{
  const hist = series("2026-10-18", 14);
  const works = [{ publishTime: Date.parse("2026-10-20T05:00:00Z") }];
  const kept = clampFansHistory(hist, works, Date.parse("2026-10-31T00:00:00Z"));
  assert.deepStrictEqual(
    kept.map((x) => x.date),
    ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24",
     "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29",
     "2026-10-30", "2026-10-31"]
  );
}

// 3. 没有作品（列表拉取失败/新账号）→ 只留最近 7 天
{
  const hist = series("2026-09-01", 61);
  const now = Date.parse("2026-10-31T00:00:00Z");
  const kept = clampFansHistory(hist, [], now);
  assert.strictEqual(kept.length, 7, `应留 7 天，实际 ${kept.length}`);
  assert.strictEqual(kept[kept.length - 1].date, "2026-10-31");
}

// 4. 无效 publishTime（0/NaN/缺失）不能把 cutoff 拉成 1970，退回 7 天
{
  const hist = series("2026-09-01", 61);
  const now = Date.parse("2026-10-31T00:00:00Z");
  const works = [{ publishTime: 0 }, { publishTime: NaN }, {}, { publishTime: -1 }];
  const kept = clampFansHistory(hist, works, now);
  assert.strictEqual(kept.length, 7);
}

// 5. 只认最早一篇：取 min(publishTime)
{
  const hist = series("2026-10-15", 17);
  const works = [
    { publishTime: Date.parse("2026-10-25T00:00:00Z") },
    { publishTime: Date.parse("2026-10-20T00:00:00Z") },
    { publishTime: Date.parse("2026-10-30T00:00:00Z") },
  ];
  const kept = clampFansHistory(hist, works, Date.parse("2026-10-31T00:00:00Z"));
  assert.strictEqual(kept[0].date, "2026-10-20");
}

// 6. 时区：UTC 16:30 = 次日 00:30(+8)，cutoff 应落在 +8 的次日
{
  const hist = series("2026-10-19", 5); // 19..23
  const works = [{ publishTime: Date.parse("2026-10-20T16:30:00Z") }]; // 北京 10-21 00:30
  const kept = clampFansHistory(hist, works, Date.parse("2026-10-31T00:00:00Z"));
  assert.strictEqual(kept[0].date, "2026-10-21");
}

// 7. 脏输入与不可变性
{
  assert.deepStrictEqual(clampFansHistory(null, null, Date.now()), []);
  assert.deepStrictEqual(clampFansHistory([{ value: 1 }], [], Date.now()), []);
  const hist = series("2026-10-01", 3);
  const snapshot = JSON.stringify(hist);
  clampFansHistory(hist, [{ publishTime: Date.parse("2026-10-02T00:00:00Z") }], Date.now());
  assert.strictEqual(JSON.stringify(hist), snapshot, "不应修改入参");
}

// 8. 注入页面上下文用的源码必须自包含（不能引用模块作用域变量）
{
  assert.ok(CLAMP_FANS_HISTORY_SRC.startsWith("function clampFansHistory"));
  assert.ok(!/\bimport\b|\brequire\(/.test(CLAMP_FANS_HISTORY_SRC));
  const fn = new Function(`${CLAMP_FANS_HISTORY_SRC}; return clampFansHistory;`)();
  assert.strictEqual(
    fn([{ date: "2026-10-19" }, { date: "2026-10-21" }], [{ publishTime: Date.parse("2026-10-20T00:00:00Z") }], Date.now()).length,
    1
  );
}

// 9. 适配器内联块与参考实现语义一致（打包器会最小化函数名，所以不能靠 toString 注入）
{
  const { ADAPTERS } = require("../src/main/services/dataStats/adapters.js");
  const src = ADAPTERS["视频号"].collectScript();
  assert.ok(src.includes("clamp-begin") && src.includes("clamp-end"), "应保留内联块标记");
  assert.ok(!ADAPTERS["抖音"].collectScript().includes("clamp-begin"), "抖音走平台真实日期，不应裁剪");

  const block = src.match(/\/\/ clamp-begin[\s\S]*?\/\/ clamp-end/);
  assert.ok(block, "应能切出内联块");

  const runInline = (history, works, now, complete = true) => {
    const body = `
      const out = { fansHistory: history, works: works };
      const __now = now;
      const paginationComplete = ${complete ? "true" : "false"};
      ${block[0].replace(/Date\.now\(\)/g, "__now")}
      return out.fansHistory;
    `;
    return new Function("history", "works", "now", body)(history, works, now);
  };

  const fixtures = [
    { hist: series("2025-10-21", 365), works: [{ publishTime: Date.parse("2026-10-20T05:59:32Z") }], now: Date.parse("2026-10-31T00:00:00Z") },
    { hist: series("2026-10-18", 14), works: [{ publishTime: Date.parse("2026-10-20T05:00:00Z") }], now: Date.parse("2026-10-31T00:00:00Z") },
    { hist: series("2026-09-01", 61), works: [], now: Date.parse("2026-10-31T00:00:00Z") },
    { hist: series("2026-10-15", 17), works: [{ publishTime: Date.parse("2026-10-25T00:00:00Z") }, { publishTime: Date.parse("2026-10-20T00:00:00Z") }], now: Date.parse("2026-10-31T00:00:00Z") },
    { hist: series("2026-10-19", 5), works: [{ publishTime: Date.parse("2026-10-20T16:30:00Z") }], now: Date.parse("2026-10-31T00:00:00Z") },
    { hist: series("2026-10-19", 5), works: [{ publishTime: 0 }, {}], now: Date.parse("2026-10-31T00:00:00Z") },
  ];
  for (const f of fixtures) {
    const inline = runInline(JSON.parse(JSON.stringify(f.hist)), f.works, f.now).map((x) => x.date);
    const ref = clampFansHistory(f.hist, f.works, f.now).map((x) => x.date);
    assert.deepStrictEqual(inline, ref, `内联块与参考实现不一致: ${JSON.stringify(f.works)}`);
  }

  // 9b. 分页被 guard 上限截断（>500 条）时不得裁剪：
  //     此时 min(publishTime) 只是最后一页的时间，会把真历史误裁
  {
    assert.ok(src.includes("paginationComplete = true"), "自然结束必须打完整标记");
    const hist = series("2025-10-21", 365);
    const worksTail = [{ publishTime: Date.parse("2026-10-01T00:00:00Z") }];
    const now = Date.parse("2026-10-31T00:00:00Z");

    const keptWhenTruncated = runInline(JSON.parse(JSON.stringify(hist)), worksTail, now, false);
    assert.strictEqual(keptWhenTruncated.length, hist.length, "截断时必须原样保留历史");

    const keptWhenComplete = runInline(JSON.parse(JSON.stringify(hist)), worksTail, now, true);
    assert.ok(keptWhenComplete.length < hist.length, "完整分页下才允许裁剪（对照组）");
  }
}

console.log("test-fans-history: 全部断言通过");
