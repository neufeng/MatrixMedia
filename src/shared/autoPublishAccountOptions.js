"use strict";

import {
  buildAccountPartitionOf,
  recordAccountKeyOf,
  recordAccountNameOf,
  recordGroupOf,
} from "./accountIdentity.js";
import { flattenAccountGetData } from "./flattenAccountGetData.js";

/**
 * @param {object} record
 * @param {string} pt
 */
export function formatAutoPublishAccountLabel(record, pt) {
  const group = recordGroupOf(record);
  const name = recordAccountNameOf(record);
  const platform = String(pt || record.pt || "").trim();
  if (name && name !== group) return `${group} · ${name}（${platform}）`;
  return `${group}（${platform}）`;
}

/**
 * 定时发帖账号下拉选项（不含登录态，仅身份与 partition）。
 * @param {object[]|object} recordsOrGetData 已压平记录，或 changeData get 的 data 对象
 * @param {string} pt 平台名，如「头条」
 */
export function buildAutoPublishAccountOptions(recordsOrGetData, pt) {
  const platform = String(pt || "").trim();
  const records = Array.isArray(recordsOrGetData)
    ? recordsOrGetData
    : flattenAccountGetData(recordsOrGetData);
  return records
    .filter((r) => String(r.pt || "").trim() === platform)
    .map((r) => {
      const phone = String(r.phone || "").trim();
      return {
        phone,
        pt: platform,
        group: recordGroupOf(r),
        accountName: recordAccountNameOf(r),
        accountKey: recordAccountKeyOf(r),
        partition: buildAccountPartitionOf(r, platform),
        label: formatAutoPublishAccountLabel(r, platform),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}