"use strict";

/**
 * 粉丝趋势裁剪的**参考实现**（2026-10-31 实证）。
 *
 * 视频号 fans_trend(startTs=今天-365天) 会把账号创建前的时段用填充点返回：
 * 账号 2026-10-20 才建，接口却回了 2025-10-21 起的 366 个点、值恒为 1；
 * adapters.js 按数组索引推日期，于是趋势图出现「一年平线」的假历史。
 *
 * 规则：只保留「最早作品发布日（+8 时区）」之后的点；
 * 没有作品（列表拉取失败/新账号还没发）时只保留最近 N 天。
 *
 * ⚠ 本文件只作参考实现与单测基准，**不参与打包**。真正生效的逻辑是
 * adapters.js 视频号 collectScript 里 clamp-begin/end 之间的**字面量内联块**
 * ——页面脚本是字符串，注入函数会被最小化/常量折叠搞坏（详见 adapters.js 头部注释）。
 * 单测用 parity 断言保证两者的语义一致。
 *
 * ⚠ 调用前必须确认作品列表已拉全（adapters 里的 paginationComplete）：
 * 分页被上限截断时 min(publishTime) 只是最后一页的发布时间，会把真实历史误裁。
 */

function clampFansHistory(history, works, nowMs) {
  var CN_OFFSET_MS = 8 * 3600 * 1000;
  var FALLBACK_DAYS = 7;

  var dateOf = function (ms) {
    return new Date(Number(ms) + CN_OFFSET_MS).toISOString().slice(0, 10);
  };

  var list = [];
  var arr = Array.isArray(history) ? history : [];
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i];
    if (it && it.date) list.push(it);
  }
  if (!list.length) return list;

  var minTs = Infinity;
  var ws = Array.isArray(works) ? works : [];
  for (var j = 0; j < ws.length; j++) {
    var t = Number(ws[j] && ws[j].publishTime);
    if (isFinite(t) && t > 0 && t < minTs) minTs = t;
  }

  var now = Number(nowMs);
  if (!isFinite(now) || now <= 0) now = Date.now();

  // 有作品=账号已开始运营，历史只认到首篇发布日；没有作品=只留最近 7 天（含今天）
  var cutoff = isFinite(minTs)
    ? dateOf(minTs)
    : dateOf(now - (FALLBACK_DAYS - 1) * 86400000);

  var kept = [];
  for (var k = 0; k < list.length; k++) {
    if (String(list[k].date) >= cutoff) kept.push(list[k]);
  }
  return kept;
}

module.exports = {
  clampFansHistory,
  /** 注入页面上下文用（函数自包含，可直接 toString） */
  CLAMP_FANS_HISTORY_SRC: clampFansHistory.toString(),
};
