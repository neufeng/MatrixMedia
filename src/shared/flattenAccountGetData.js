"use strict";

/**
 * 将 changeData account/get 的 data 体（按日期分桶）压平为去重后的账号记录列表。
 * 与主进程 accountLookup.listAllAccountRecords 语义一致，供渲染进程与单测复用。
 */

/**
 * @param {unknown} data changeData get 返回的 data 字段
 * @returns {object[]}
 */
export function flattenAccountGetData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const seen = new Map();
  for (const dateKey of Object.keys(data)) {
    const day = data[dateKey];
    if (!Array.isArray(day)) continue;
    for (const row of day) {
      if (!row || !row.phone || !row.pt) continue;
      const key = `${String(row.phone).trim()}__${String(row.pt).trim()}`;
      const prev = seen.get(key);
      if (!prev || Number(row.createTime || 0) > Number(prev.createTime || 0)) {
        seen.set(key, row);
      }
    }
  }
  return [...seen.values()];
}