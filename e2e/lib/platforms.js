"use strict";

/**
 * e2e 用例定义：每个平台的 CLI 参数偏好。
 * code 与 src/shared/publishPlatforms.js 的 PLATFORM_ALIASES 一致，
 * name 为 canonical 平台名（与 cli accounts --json 的 pt 对应）。
 */

/** issue #42 报告者验证过的四平台，作为默认跑批范围 */
const DEFAULT_PLATFORMS = ["dy", "blbl", "sph", "xhs"];

const CASES = {
  dy: {
    name: "抖音",
    tags: "原创音乐 AI音乐",
    // 抖音必须选创作声明，否则发布按钮不可用
    creativeStatement: "ai_generated",
  },
  blbl: { name: "哔哩哔哩", tags: "原创音乐,AI音乐" },
  sph: {
    name: "视频号",
    tags: "原创音乐",
    // 视频号勾选「声明原创」后平台要求必须选择视频标注，否则存草稿被「请先选择」拦下；
    // self_shot 会进一步弹「添加拍摄时间和地点」对话框，故 e2e 用 ai_generated
    creativeStatement: "ai_generated",
  },
  xhs: { name: "小红书", tags: "原创音乐,AI音乐" },
  ks: {
    name: "快手",
    tags: "原创音乐",
    // 快手声明选择失败会中止发布（P1-5），e2e 带上 ai_generated 验证
    // 「含AI生成内容」现行文案匹配（曾用「内容为AI生成」）
    creativeStatement: "ai_generated",
  },
  bjh: { name: "百家号", tags: "原创音乐" },
  tt: { name: "头条", tags: "原创音乐" },
};

/** 平台别名 → 用例 key（与 PLATFORM_ALIASES 保持一致的最小子集） */
const ALIASES = {
  dy: "dy",
  douyin: "dy",
  抖音: "dy",
  sph: "sph",
  视频号: "sph",
  blbl: "blbl",
  bilibili: "blbl",
  哔哩哔哩: "blbl",
  xhs: "xhs",
  小红书: "xhs",
  ks: "ks",
  kuaishou: "ks",
  快手: "ks",
  bjh: "bjh",
  百家号: "bjh",
  tt: "tt",
  toutiao: "tt",
  头条: "tt",
};

/** 解析 --platforms 传入的别名列表，返回用例 key 数组 */
function resolvePlatformCodes(input) {
  const list = (input || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = list.filter((c) => !ALIASES[c]);
  if (unknown.length) {
    throw new Error(
      `未知平台: ${unknown.join(", ")}（可用: ${Object.keys(CASES).join(", ")}）`
    );
  }
  return list.map((c) => ALIASES[c]);
}

module.exports = { DEFAULT_PLATFORMS, CASES, ALIASES, resolvePlatformCodes };
