"use strict";

import fs from "fs";
import path from "path";
import {
  normalizeAutoPublishTaskInput,
  computeNextRunAt,
  advanceAfterMissedRun,
  previewContent,
} from "../../shared/autoPublishTask.js";

const FILE_VERSION = 1;
const MAX_HISTORY = 200;

function emptyData() {
  return { version: FILE_VERSION, tasks: [], runs: [] };
}

function stripSecretsFromRun(run) {
  if (!run || typeof run !== "object") return run;
  const { apiKey, xaiKey, authorization, ...rest } = run;
  return rest;
}

export function createAutoPublishStore({ filePath, fileSystem = fs, now = () => Date.now() } = {}) {
  if (!filePath) throw new Error("缺少定时发帖数据文件路径");

  function read() {
    try {
      const raw = fileSystem.readFileSync(filePath, "utf8");
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.tasks)) return emptyData();
      return {
        version: FILE_VERSION,
        tasks: data.tasks,
        runs: Array.isArray(data.runs) ? data.runs : [],
      };
    } catch (error) {
      if (error && error.code === "ENOENT") return emptyData();
      throw new Error("AI 定时发帖数据文件已损坏：" + filePath);
    }
  }

  function write(data) {
    fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    const safe = {
      version: FILE_VERSION,
      tasks: data.tasks,
      runs: (data.runs || []).slice(0, MAX_HISTORY).map(stripSecretsFromRun),
    };
    fileSystem.writeFileSync(tmp, JSON.stringify(safe, null, 2), { encoding: "utf8", mode: 0o600 });
    fileSystem.renameSync(tmp, filePath);
    try {
      fileSystem.chmodSync(filePath, 0o600);
    } catch (_) {
      /* ignore */
    }
  }

  function toPublicTask(task) {
    const nextRunAt = task.enabled ? computeNextRunAt(task) : null;
    return {
      ...task,
      nextRunAt,
      nextRunAtText: nextRunAt
        ? new Date(nextRunAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
        : "",
    };
  }

  function recomputeAllOnLoad(data, nowMs) {
    data.tasks = (data.tasks || []).map((t) => {
      let task = { ...t };
      if (task.enabled) {
        task = advanceAfterMissedRun(task, nowMs);
      } else {
        task.nextRunAt = null;
      }
      return task;
    });
    return data;
  }

  return {
    filePath,

    list() {
      const data = read();
      return {
        tasks: data.tasks.map(toPublicTask),
        runs: data.runs.map(stripSecretsFromRun),
      };
    },

    recoverAfterBoot() {
      const data = recomputeAllOnLoad(read(), now());
      write(data);
      return data.tasks.map(toPublicTask);
    },

    getTask(id) {
      const data = read();
      const task = data.tasks.find((t) => t.id === String(id));
      return task ? toPublicTask(task) : null;
    },

    saveTask(input, { isNew = false } = {}) {
      const normalized = normalizeAutoPublishTaskInput(input, { isNew });
      if (!normalized.ok) throw new Error(normalized.message);
      const data = read();
      const v = normalized.value;
      const idx = data.tasks.findIndex((t) => t.id === v.id);
      if (isNew && idx >= 0) throw new Error("任务 ID 冲突");
      if (!isNew && idx < 0) throw new Error("任务不存在");
      if (idx >= 0) data.tasks.splice(idx, 1, v);
      else data.tasks.push(v);
      write(data);
      return toPublicTask(v);
    },

    removeTask(id) {
      const data = read();
      const before = data.tasks.length;
      data.tasks = data.tasks.filter((t) => t.id !== String(id));
      if (data.tasks.length === before) throw new Error("任务不存在");
      write(data);
      return true;
    },

    setEnabled(id, enabled) {
      const data = read();
      const idx = data.tasks.findIndex((t) => t.id === String(id));
      if (idx < 0) throw new Error("任务不存在");
      const task = { ...data.tasks[idx], enabled: enabled === true, updatedAt: now() };
      task.nextRunAt = task.enabled ? computeNextRunAt(task) : null;
      data.tasks.splice(idx, 1, task);
      write(data);
      return toPublicTask(task);
    },

    tryAcquireRunLock(taskId, leaseMs = 15 * 60 * 1000) {
      const data = read();
      const idx = data.tasks.findIndex((t) => t.id === String(taskId));
      if (idx < 0) return { ok: false, reason: "任务不存在" };
      const task = data.tasks[idx];
      const until = Number(task.runLockUntil) || 0;
      const n = now();
      if (until > n) return { ok: false, reason: "任务正在执行中" };
      const updated = { ...task, runLockUntil: n + leaseMs, updatedAt: n };
      data.tasks.splice(idx, 1, updated);
      write(data);
      return { ok: true, task: updated };
    },

    releaseRunLock(taskId) {
      const data = read();
      const idx = data.tasks.findIndex((t) => t.id === String(taskId));
      if (idx < 0) return;
      const task = { ...data.tasks[idx], runLockUntil: 0, updatedAt: now() };
      data.tasks.splice(idx, 1, task);
      write(data);
    },

    recordRun(entry) {
      const data = read();
      const run = {
        id: `run-${now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskId: String(entry.taskId || ""),
        taskName: String(entry.taskName || ""),
        startedAt: entry.startedAt || now(),
        finishedAt: entry.finishedAt || now(),
        status: String(entry.status || "failed"),
        stage: String(entry.stage || ""),
        message: String(entry.message || "").slice(0, 2000),
        contentPreview: previewContent(entry.contentPreview || "", 80),
        imagePath: entry.imagePath ? path.basename(String(entry.imagePath)) : "",
        dryRun: entry.dryRun === true,
        skippedMissed: entry.skippedMissed === true,
      };
      data.runs.unshift(stripSecretsFromRun(run));
      data.runs = data.runs.slice(0, MAX_HISTORY);
      write(data);
      return run;
    },

    afterSuccessfulRun(taskId) {
      const data = read();
      const idx = data.tasks.findIndex((t) => t.id === String(taskId));
      if (idx < 0) return null;
      const prev = data.tasks[idx];
      const runCount = (Number(prev.runCount) || 0) + 1;
      let task = {
        ...prev,
        runCount,
        lastRunAt: now(),
        runLockUntil: 0,
        updatedAt: now(),
      };
      const schedule = task.schedule || {};
      if (schedule.type === "once") {
        task.enabled = false;
        task.nextRunAt = null;
      } else {
        task = advanceAfterMissedRun(task, now());
      }
      data.tasks.splice(idx, 1, task);
      write(data);
      return toPublicTask(task);
    },

    afterFailedRun(taskId) {
      const data = read();
      const idx = data.tasks.findIndex((t) => t.id === String(taskId));
      if (idx < 0) return null;
      let task = { ...data.tasks[idx], runLockUntil: 0, lastRunAt: now(), updatedAt: now() };
      if (task.schedule && task.schedule.type === "daily") {
        task = advanceAfterMissedRun(task, now());
      } else {
        task.enabled = false;
        task.nextRunAt = null;
      }
      data.tasks.splice(idx, 1, task);
      write(data);
      return toPublicTask(task);
    },

    dueTasks(nowMs = now()) {
      const data = read();
      return data.tasks
        .filter((t) => t.enabled && t.nextRunAt != null && t.nextRunAt <= nowMs)
        .sort((a, b) => Number(a.nextRunAt) - Number(b.nextRunAt));
    },
  };
}