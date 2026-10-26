"use strict";

const fs = require("fs");
const path = require("path");

const JOB_JSON = "job.json";
const VIDEO_EXT = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
  ".webm",
  ".m4v",
]);

function isVideoFile(name) {
  return VIDEO_EXT.has(path.extname(name).toLowerCase());
}

function readJobJson(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return { ...raw, _jobFile: filePath };
}

/**
 * 发现 incoming 下的待处理任务
 * - 目录 + job.json + 同目录视频
 * - job.json 旁同名 .mp4 等
 * - *.job.json sidecar
 * @param {string} incomingDir
 */
function discoverJobs(incomingDir) {
  if (!fs.existsSync(incomingDir)) {
    return [];
  }
  const entries = fs.readdirSync(incomingDir, { withFileTypes: true });
  const jobs = [];
  const seen = new Set();

  function pushJob(jobDef, workDir) {
    const key = jobDef._jobFile || workDir;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    jobs.push({ jobDef, workDir, jobFile: jobDef._jobFile || null });
  }

  for (const ent of entries) {
    const full = path.join(incomingDir, ent.name);
    if (ent.isDirectory()) {
      const jobPath = path.join(full, JOB_JSON);
      if (fs.existsSync(jobPath)) {
        pushJob(readJobJson(jobPath), full);
      }
      continue;
    }
    if (ent.name === JOB_JSON) {
      pushJob(readJobJson(full), incomingDir);
      continue;
    }
    if (ent.name.endsWith(".job.json")) {
      pushJob(readJobJson(full), path.dirname(full));
      continue;
    }
  }

  return jobs.sort((a, b) => {
    const ta = fs.statSync(a.jobFile || a.workDir).mtimeMs;
    const tb = fs.statSync(b.jobFile || b.workDir).mtimeMs;
    return ta - tb;
  });
}

/**
 * @param {{ jobDef: object, workDir: string }} item
 */
function resolveVideoPath(item) {
  const { jobDef, workDir } = item;
  let file = jobDef.file || jobDef.video;
  if (file) {
    if (!path.isAbsolute(file)) {
      file = path.join(workDir, file);
    }
    return path.resolve(file);
  }

  if (jobDef._jobFile && jobDef._jobFile.endsWith(".job.json")) {
    const base = jobDef._jobFile.replace(/\.job\.json$/i, "");
    for (const ext of VIDEO_EXT) {
      const candidate = base + ext;
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const files = fs.readdirSync(workDir);
  const videos = files.filter(isVideoFile);
  if (videos.length === 1) {
    return path.join(workDir, videos[0]);
  }
  if (videos.length > 1) {
    throw new Error(
      `目录 ${workDir} 含多个视频且 job 未指定 file 字段：${videos.join(", ")}`
    );
  }
  throw new Error(`未找到视频文件：${workDir}（请在 job.json 中设置 file）`);
}

module.exports = {
  discoverJobs,
  resolveVideoPath,
  JOB_JSON,
  isVideoFile,
};
