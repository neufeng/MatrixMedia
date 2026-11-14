"use strict";

/**
 * 定时发布任务的去重判据（2026-10-30 查篇事故复盘）。
 *
 * 事故：同一秒内为同一视频创建了两条 publishAt 相同的定时记录
 * （id …609839 / …913734），而 server/utils 的 isDuplicate 显式排除
 * scheduledTask 记录，触发时又按到期列表逐条执行且无并发保护
 * —— 重跑一次 --publish-at 就可能双发。
 *
 * 这里把「同一任务」的判据收在一处，创建前查重、触发时加锁共用。
 */

/** 归一化字符串字段，避免 null/undefined 与空串被判成不同 */
function norm(v) {
  return v === null || v === undefined ? "" : String(v);
}

/**
 * 定时任务身份键：平台 + 账号分区 + 手机号 + 文件 + 内容类型 + 定时时刻。
 * 同一键视为同一任务（内容改动不应生成第二条任务，应更新原记录）。
 *
 * @param {object} record pushData 记录（创建中或已落库）
 * @returns {string}
 */
export function scheduledKey(record) {
  if (!record) return "";
  return [
    norm(record.pt),
    norm(record.partition),
    norm(record.phone),
    norm(record.filePath),
    norm(record.textType),
    norm(record.scheduledPublishAt),
  ].join("|");
}

/**
 * 在既有记录里找同一任务的「待触发」定时记录。
 * 只认 publishStatus === "scheduled"：已发布/已失败/已取消的不算重复，
 * 允许用户在原任务失败后重新排期。
 *
 * @param {Array<object>} records 已有 pushData 记录（可跨日期）
 * @param {object} candidate 待创建的定时记录
 * @returns {object|undefined}
 */
export function findExistingScheduled(records, candidate) {
  const key = scheduledKey(candidate);
  if (!key || !Array.isArray(records)) return undefined;
  return records.find(
    (it) =>
      it &&
      it.scheduledTask === true &&
      it.publishStatus === "scheduled" &&
      scheduledKey(it) === key
  );
}
