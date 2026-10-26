"use strict";

const PLATFORM_ALIASES = {
  dy: "抖音",
  douyin: "抖音",
  抖音: "抖音",
  sph: "视频号",
  视频号: "视频号",
  blbl: "哔哩哔哩",
  bilibili: "哔哩哔哩",
  哔哩哔哩: "哔哩哔哩",
  bjh: "百家号",
  百家号: "百家号",
  tt: "头条",
  toutiao: "头条",
  头条: "头条",
  ks: "快手",
  kuaishou: "快手",
  快手: "快手",
  fqsp: "番茄视频",
  fanqie: "番茄视频",
  fq: "番茄视频",
  番茄视频: "番茄视频",
};

const CANONICAL = ["抖音", "视频号", "哔哩哔哩", "百家号", "头条", "快手", "番茄视频"];
const STATUS_ALIASES = {
  success: "success",
  ok: "success",
  成功: "success",
  failed: "failed",
  fail: "failed",
  失败: "failed",
  publishing: "publishing",
  发布中: "publishing",
  scheduled: "scheduled",
  定时: "scheduled",
  等待定时发布: "scheduled",
  expired: "expired",
  过期: "expired",
  任务过期: "expired",
};

/** 带值选项的值不能缺失，也不能是下一个选项（以 - 开头） */
function readValue(args, i, flag) {
  const v = args[i + 1];
  if (v === undefined || (typeof v === "string" && /^-/.test(v))) {
    return { ok: false, error: `${flag} 需要一个值，例如 ${flag} <值>` };
  }
  return { ok: true, value: v, next: i + 1 };
}

/** 严格正整数：拒绝 "30garbage"、"2.5"、"-3" 之类被 parseInt 静默截断的输入 */
function readPositiveInt(args, i, flag, unit) {
  const v = readValue(args, i, flag);
  if (!v.ok) return v;
  if (!/^\d+$/.test(String(v.value).trim()) || parseInt(v.value, 10) < 1) {
    return { ok: false, error: `${flag} 需为正整数${unit ? `（${unit}）` : ""}` };
  }
  return { ok: true, value: parseInt(v.value, 10), next: i + 1 };
}

export function parseHistoryArgs(subArgv) {
  const args = Array.isArray(subArgv) ? subArgv : [];
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, value: { help: true } };
  }

  const out = {
    platform: null,
    phone: null,
    status: null,
    days: 7,
    limit: 50,
    since: null,
    until: null,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--platform" || a === "-p") {
      const v = readValue(args, i, a);
      if (!v.ok) return v;
      out.platform = v.value;
      i = v.next;
    } else if (a === "--phone") {
      const v = readValue(args, i, a);
      if (!v.ok) return v;
      out.phone = v.value;
      i = v.next;
    } else if (a === "--status" || a === "-s") {
      const v = readValue(args, i, a);
      if (!v.ok) return v;
      out.status = v.value;
      i = v.next;
    } else if (a === "--days" || a === "-d") {
      const v = readPositiveInt(args, i, a, "天");
      if (!v.ok) return v;
      out.days = v.value;
      i = v.next;
    } else if (a === "--limit" || a === "-n") {
      const v = readPositiveInt(args, i, a);
      if (!v.ok) return v;
      out.limit = v.value;
      i = v.next;
    } else if (a === "--since") {
      const v = readValue(args, i, a);
      if (!v.ok) return v;
      out.since = v.value;
      i = v.next;
    } else if (a === "--until") {
      const v = readValue(args, i, a);
      if (!v.ok) return v;
      out.until = v.value;
      i = v.next;
    } else if (a === "--json") {
      out.json = true;
    } else {
      return { ok: false, error: `未知参数: ${a}` };
    }
  }

  if (out.platform) {
    const raw = String(out.platform).trim();
    const pt = PLATFORM_ALIASES[raw] || PLATFORM_ALIASES[raw.toLowerCase()] || raw;
    if (!CANONICAL.includes(pt)) {
      return { ok: false, error: `未知平台: ${out.platform}` };
    }
    out.platform = pt;
  }

  if (out.status) {
    const raw = String(out.status).trim().toLowerCase();
    const st = STATUS_ALIASES[raw] || STATUS_ALIASES[String(out.status).trim()];
    if (!st) {
      return { ok: false, error: `未知状态: ${out.status}（支持 success|failed|publishing|scheduled|expired）` };
    }
    out.status = st;
  }

  if (out.since && !/^\d{4}-\d{2}-\d{2}$/.test(out.since)) {
    return { ok: false, error: "--since 需为 YYYY-MM-DD" };
  }
  if (out.until && !/^\d{4}-\d{2}-\d{2}$/.test(out.until)) {
    return { ok: false, error: "--until 需为 YYYY-MM-DD" };
  }

  return { ok: true, value: out };
}

export function historyHelpText() {
  return `
用法: <应用> cli history [选项]

查看本机发布记录（与 GUI「视频管理」同源）。
数据来源：<Documents>/web/MatrixMedia/data/pushData/YYYY-MM-DD.json。

选项:
  -p, --platform <id>   仅列某个平台：dy|抖音、tt|头条、ks|快手、blbl|哔哩哔哩、bjh|百家号、sph|视频号、fqsp|番茄视频
      --phone <id>      仅列某个手机号
  -s, --status <s>      仅列某个状态：success|failed|publishing|scheduled|expired
                          （中文同义：成功|失败|发布中|等待定时发布|任务过期）
  -d, --days <n>        读取最近 N 天，默认 7；与 --since/--until 冲突时以 since/until 为准
      --since <date>    起始日期（含），YYYY-MM-DD
      --until <date>    结束日期（含），YYYY-MM-DD
  -n, --limit <n>       最多输出条数，默认 50（按时间倒序）
      --json            以 JSON 输出
  -h, --help            显示本帮助

退出码: 0 正常输出, 1 异常, 2 参数错误

示例:
  matrixmedia cli history
  matrixmedia cli history -p dy -d 30 -s failed
  matrixmedia cli history --since 2026-04-01 --until 2026-04-18 --json
`.trim();
}
