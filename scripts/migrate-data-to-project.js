#!/usr/bin/env node
"use strict";

/**
 * 将业务数据从文稿 web/MatrixMedia/data（或旧版 MatrixMedia/data）迁到 <项目根>/data。
 * 默认不备份；遇同名内容不一致不覆盖；可重复执行（幂等）。
 *
 * 用法：
 *   MATRIXMEDIA_PROJECT_ROOT=/path/to/repo node scripts/migrate-data-to-project.js [--dry-run] [--remove-source]
 *   node scripts/migrate-data-to-project.js --source ~/Documents/web/MatrixMedia/data --target /path/to/repo/data
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSync } = require("esbuild");

const repoRoot = path.join(__dirname, "..");
const stubOut = path.join(repoRoot, "test/.cache", "migrateProjectDataRoot.cjs");
buildSync({
  entryPoints: [path.join(repoRoot, "src/shared/projectDataRoot.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: stubOut,
});
const {
  resolveBusinessDataDir,
  legacyDocumentsWebDataDir,
  legacyDocumentsDataDir,
} = require(stubOut);

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function entriesSame(src, dest) {
  const ss = fs.statSync(src);
  const ds = fs.statSync(dest);
  if (ss.isDirectory() !== ds.isDirectory()) return false;
  if (ss.isDirectory()) {
    const sNames = fs.readdirSync(src).sort();
    const dNames = fs.readdirSync(dest).sort();
    if (sNames.length !== dNames.length) return false;
    for (let i = 0; i < sNames.length; i += 1) {
      if (sNames[i] !== dNames[i]) return false;
      if (!entriesSame(path.join(src, sNames[i]), path.join(dest, dNames[i]))) return false;
    }
    return true;
  }
  if (ss.size !== ds.size) return false;
  return sha256File(src) === sha256File(dest);
}

function parseArgs(argv) {
  const out = { dryRun: false, removeSource: false, source: "", target: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--remove-source") out.removeSource = true;
    else if (a === "--source") out.source = argv[++i] || "";
    else if (a === "--target") out.target = argv[++i] || "";
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function defaultSources() {
  const docs = path.join(os.homedir(), "Documents");
  const list = [legacyDocumentsWebDataDir(docs), legacyDocumentsDataDir(docs)];
  return list.filter((p, i, arr) => fs.existsSync(p) && arr.indexOf(p) === i);
}

function moveFile(src, dest, opts) {
  if (!fs.existsSync(dest)) {
    if (opts.dryRun) {
      console.log(`[dry-run] 移动 ${src} -> ${dest}`);
      return "moved";
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    return "moved";
  }
  if (entriesSame(src, dest)) {
    if (opts.removeSource && !opts.dryRun) {
      fs.rmSync(src, { recursive: true, force: true });
    }
    return "skipped-same";
  }
  return "conflict";
}

function moveTree(srcRoot, destRoot, opts, stats) {
  if (!fs.existsSync(srcRoot)) return;
  const names = fs.readdirSync(srcRoot);
  for (const name of names) {
    const src = path.join(srcRoot, name);
    const dest = path.join(destRoot, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      if (!fs.existsSync(dest)) {
        if (opts.dryRun) {
          console.log(`[dry-run] 移动目录 ${src} -> ${dest}`);
          stats.moved += 1;
          continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(src, dest);
        stats.moved += 1;
        continue;
      }
      moveTree(src, dest, opts, stats);
      if (opts.removeSource && !opts.dryRun) {
        try {
          if (fs.readdirSync(src).length === 0) fs.rmdirSync(src);
        } catch {
          /* ignore */
        }
      }
      continue;
    }
    const r = moveFile(src, dest, opts);
    if (r === "moved") stats.moved += 1;
    else if (r === "skipped-same") stats.idempotent += 1;
    else if (r === "conflict") {
      stats.conflicts.push({ src, dest });
    }
  }
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(`用法: node scripts/migrate-data-to-project.js [--dry-run] [--remove-source]
  --source <dir>   默认: 文稿下 web/MatrixMedia/data（存在则用）
  --target <dir>   默认: MATRIXMEDIA_PROJECT_ROOT 或仓库根下的 data`);
    process.exit(0);
  }

  process.env.MATRIXMEDIA_PROJECT_ROOT =
    process.env.MATRIXMEDIA_PROJECT_ROOT || repoRoot;

  const target =
    (opts.target && path.resolve(opts.target)) ||
    resolveBusinessDataDir({ moduleDir: path.join(repoRoot, "src/shared"), fs });

  const sources = opts.source ? [path.resolve(opts.source)] : defaultSources();
  if (sources.length === 0) {
    console.error("未找到默认源目录，请用 --source 指定。");
    process.exit(1);
  }

  console.log(`目标: ${target}`);
  if (!opts.dryRun) fs.mkdirSync(target, { recursive: true });

  const stats = { moved: 0, idempotent: 0, conflicts: [] };
  for (const src of sources) {
    if (path.resolve(src) === path.resolve(target)) {
      console.log(`跳过: 源与目标相同 ${src}`);
      continue;
    }
    console.log(`源: ${src}`);
    moveTree(src, target, opts, stats);
  }

  console.log(`完成: 移动 ${stats.moved}，已一致跳过 ${stats.idempotent}，冲突 ${stats.conflicts.length}`);
  if (stats.conflicts.length) {
    for (const c of stats.conflicts) {
      console.error(`冲突（未覆盖）: ${c.src} -> ${c.dest}`);
    }
    process.exit(2);
  }
  process.exit(0);
}

main();