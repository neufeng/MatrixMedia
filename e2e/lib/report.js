"use strict";

/**
 * 运行结果汇总：控制台表格 + artifacts 目录（report.json / report.md / 每平台日志）。
 * report.json 供 CI 或后续脚本消费；report.md 供人读与贴 issue。
 */

const fs = require("fs");
const path = require("path");

const RESULT_LABELS = {
  PASS_VERIFIED: "✅ 确认成功（App 已校验草稿保存提示）",
  PASS_HUMAN: "✅ 成功（App 无校验字段，人工已确认后台有草稿）",
  LEGACY_SUCCESS: "⚠️ App 回报成功但未含草稿校验逻辑，需人工核对",
  NEEDS_ATTENTION: "⚠️ App 标记待人工核对（未确认是否保存成功）",
  FAIL: "❌ 失败（App 已上报失败）",
  TIMEOUT: "❌ 超时",
  ERROR: "❌ 执行异常",
  SKIPPED_NO_LOGIN: "⏭️ 跳过（该平台无已登录账号）",
  SKIPPED_DRYRUN: "⏭️ dry-run（仅打印命令）",
  SKIPPED_USER_CLOSE: "⏭️ 跳过（发布窗口被关闭）",
};

/** 需要人工跟进的结果集合 */
const ATTENTION_RESULTS = new Set([
  "LEGACY_SUCCESS",
  "NEEDS_ATTENTION",
  "FAIL",
  "TIMEOUT",
  "ERROR",
]);

function consoleTable(results) {
  console.log("\n========== e2e 汇总 ==========");
  for (const r of results) {
    const dv =
      r.receipt && r.receipt.draftVerified !== undefined
        ? `draftVerified=${r.receipt.draftVerified}`
        : "draftVerified=N/A";
    const human = r.backendCheck ? `后台=${r.backendCheck}` : "";
    console.log(
      `${(r.code || "").padEnd(5)} ${(RESULT_LABELS[r.result] || r.result).padEnd(10)} 退出码=${r.exitCode ?? "-"} ${dv} ${human}`
    );
    if (r.message) console.log(`      └─ ${r.message}`);
  }
}

function markdownReport({ runId, appBin, appVersion, video, results }) {
  const lines = [];
  lines.push(`# 草稿模式 e2e 报告 ${runId}`);
  lines.push("");
  lines.push(`- App: \`${appBin}\``);
  lines.push(`- App 版本: \`${appVersion || "未知"}\``);
  lines.push(`- 测试视频: \`${video}\``);
  lines.push(`- 时间: ${new Date().toLocaleString()}`);
  lines.push("");
  lines.push(
    "| 平台 | 结果 | 退出码 | resultStatus | draftVerified | draftUrlUnchanged | 后台人工核对 | 失败截图 |"
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const rc = r.receipt || {};
    lines.push(
      [
        r.name,
        RESULT_LABELS[r.result] || r.result,
        r.exitCode ?? "-",
        rc.resultStatus || "-",
        rc.draftVerified !== undefined ? rc.draftVerified : "N/A",
        rc.draftUrlUnchanged !== undefined ? rc.draftUrlUnchanged : "N/A",
        r.backendCheck || "未核对",
        r.screenshots.length ? r.screenshots.map((s) => `\`${s}\``).join("<br>") : "-",
      ].join(" | ")
    );
  }
  lines.push("");
  lines.push("## 诊断行（用于校准 #42 信号文案）");
  lines.push("");
  for (const r of results) {
    if (!r.evidence.length) continue;
    lines.push(`### ${r.name}`);
    lines.push("```");
    r.evidence.forEach((l) => lines.push(l));
    lines.push("```");
  }
  for (const r of results) {
    if (!r.error) continue;
    lines.push(`### ${r.name} 异常`);
    lines.push("```");
    lines.push(r.error);
    lines.push("```");
  }
  return lines.join("\n");
}

/** 写入 runDir（每平台 stdout/receipt）与顶层 report.json/report.md，返回报告路径 */
function writeArtifacts({ runDir, runId, meta, results }) {
  fs.mkdirSync(runDir, { recursive: true });
  for (const r of results) {
    if (r.stdoutLines && r.stdoutLines.length) {
      fs.writeFileSync(
        path.join(runDir, `${r.code}.stdout.log`),
        r.stdoutLines.join("\n"),
        "utf8"
      );
    }
    if (r.stderrLines && r.stderrLines.length) {
      fs.writeFileSync(
        path.join(runDir, `${r.code}.stderr.log`),
        r.stderrLines.join("\n"),
        "utf8"
      );
    }
    if (r.receipt) {
      fs.writeFileSync(
        path.join(runDir, `${r.code}.receipt.json`),
        JSON.stringify(r.receipt, null, 2),
        "utf8"
      );
    }
  }

  const reportJson = path.join(runDir, "report.json");
  const reportMd = path.join(runDir, "report.md");
  fs.writeFileSync(
    reportJson,
    JSON.stringify({ runId, ...meta, results: results.map(sanitize) }, null, 2),
    "utf8"
  );
  fs.writeFileSync(reportMd, markdownReport({ runId, ...meta, results }), "utf8");
  return { reportJson, reportMd };
}

/** 产物里只留可序列化的字段，剥掉超长 stdout */
function sanitize(r) {
  const { stdoutLines, stderrLines, ...rest } = r;
  return {
    ...rest,
    stdoutLines: undefined,
    stderrLines: undefined,
    stdoutTail: (stdoutLines || []).slice(-40),
  };
}

module.exports = { consoleTable, writeArtifacts, RESULT_LABELS, ATTENTION_RESULTS };
