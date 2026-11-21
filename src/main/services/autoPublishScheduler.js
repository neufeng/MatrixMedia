"use strict";

import { ipcMain, BrowserWindow } from "electron";
import {
  advanceAfterMissedRun,
  shouldAutoPublishDryRun,
  isStrictTrue,
} from "../../shared/autoPublishTask.js";
import { runAutoPublishTask, ensureAssetsDir } from "./autoPublishEngine.js";

const TICK_MS = 30 * 1000;
const PUBLISH_TIMEOUT_MS = 20 * 60 * 1000;

let started = false;
let tickTimer = null;
let running = false;
let deps = null;

function runAuthSnapshot(execTask) {
  return { allowRealPublishAtRun: isStrictTrue(execTask && execTask.allowRealPublish) };
}

function notifyRenderer() {
  try {
    ipcMain.emit("autoPublish:changed");
  } catch (_) {
    /* ignore */
  }
  try {
    BrowserWindow.getAllWindows().forEach((w) => {
      try {
        w.webContents.send("autoPublish:changed");
      } catch (_) {
        /* ignore */
      }
    });
  } catch (_) {
    /* ignore */
  }
}

async function executeOne(task) {
  const lock = deps.store.tryAcquireRunLock(task.id);
  if (!lock.ok) return;

  const execTask = lock.task;
  const startedAt = Date.now();
  const dryRun = shouldAutoPublishDryRun(execTask);
  const authSnap = runAuthSnapshot(execTask);
  deps.store.recordRun({
    taskId: execTask.id,
    taskName: execTask.name,
    startedAt,
    status: "running",
    stage: "开始",
    message: dryRun ? "生成中（测试模式，不发帖）" : "生成并发布中",
    dryRun,
    ...authSnap,
  });

  try {
    const xai = deps.xaiStore.resolve();
    const assetsDir = ensureAssetsDir(deps.app);
    const result = await runAutoPublishTask({
      task: execTask,
      xaiProvider: xai,
      assetsDir,
      dryRun,
      deps: { publishTimeoutMs: PUBLISH_TIMEOUT_MS, ...deps.engineDeps },
    });

    const finishedAt = Date.now();
    if (result.dryRun) {
      deps.store.afterSuccessfulRun(execTask.id);
      deps.store.recordRun({
        taskId: execTask.id,
        taskName: execTask.name,
        startedAt,
        finishedAt,
        status: "success",
        stage: "完成",
        message: result.message,
        contentPreview: result.contentPreview,
        imagePath: result.imagePath,
        dryRun: true,
        ...authSnap,
      });
      return;
    }

    if (result.publishAbnormal) {
      deps.store.afterFailedRun(execTask.id);
      deps.store.recordRun({
        taskId: execTask.id,
        taskName: execTask.name,
        startedAt,
        finishedAt,
        status: "needs_attention",
        stage: "发布",
        message: result.message,
        contentPreview: result.contentPreview,
        imagePath: result.imagePath,
        dryRun: false,
        ...authSnap,
      });
      return;
    }

    if (!result.publishOk) {
      deps.store.afterFailedRun(execTask.id);
      deps.store.recordRun({
        taskId: execTask.id,
        taskName: execTask.name,
        startedAt,
        finishedAt,
        status: result.loginRequired ? "login_required" : "failed",
        stage: "发布",
        message: result.message,
        contentPreview: result.contentPreview,
        imagePath: result.imagePath,
        dryRun: false,
        ...authSnap,
      });
      return;
    }

    deps.store.afterSuccessfulRun(execTask.id);
    deps.store.recordRun({
      taskId: execTask.id,
      taskName: execTask.name,
      startedAt,
      finishedAt,
      status: "success",
      stage: "完成",
      message: result.message,
      contentPreview: result.contentPreview,
      imagePath: result.imagePath,
      dryRun: false,
      ...authSnap,
    });
  } catch (error) {
    deps.store.releaseRunLock(execTask.id);
    deps.store.afterFailedRun(execTask.id);
    deps.store.recordRun({
      taskId: execTask.id,
      taskName: execTask.name,
      startedAt,
      finishedAt: Date.now(),
      status: "failed",
      stage: "错误",
      message: (error && error.message) || "执行失败",
      dryRun: shouldAutoPublishDryRun(execTask),
      ...authSnap,
    });
  } finally {
    deps.store.releaseRunLock(execTask.id);
    notifyRenderer();
  }
}

async function tick() {
  if (!deps || running) return;
  running = true;
  try {
    const nowMs = Date.now();
    const due = deps.store.dueTasks(nowMs);
    for (const task of due) {
      const advanced = advanceAfterMissedRun(task, nowMs);
      if (advanced.nextRunAt > nowMs) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await executeOne(task);
    }
  } finally {
    running = false;
  }
}

export function startAutoPublishScheduler(injected) {
  deps = injected;
  if (started) return;
  started = true;
  deps.store.recoverAfterBoot();
  tickTimer = setInterval(() => {
    tick().catch((e) => console.error("[autoPublish]", e && e.message));
  }, TICK_MS);
  tick().catch((e) => console.error("[autoPublish]", e && e.message));
}

export function stopAutoPublishScheduler() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  started = false;
  deps = null;
}

export async function runAutoPublishTaskNow(store, xaiStore, app, taskId, engineDeps = {}) {
  const task = store.getTask(taskId);
  if (!task) throw new Error("任务不存在");
  if (!task.enabled) throw new Error("任务未启用");
  const wrap = { store, xaiStore, app, engineDeps };
  const prev = deps;
  deps = wrap;
  try {
    await executeOne(task);
  } finally {
    deps = prev;
  }
}