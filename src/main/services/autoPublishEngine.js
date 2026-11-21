"use strict";

import fs from "fs";
import path from "path";
import ptConfig from "../config/ptConfig";
import { runPuppeteerTask } from "./puppeteerFile";
import { buildAccountPartitionOf } from "../../shared/accountIdentity.js";
import { findAccountRecordFlexible } from "./accountLookup.js";
import { generateWeitoutiaoText, generateWeitoutiaoImage, saveXaiImageToDir } from "./xaiClient.js";
import {
  clipWeitoutiaoContent,
  previewContent,
  shouldAutoPublishDryRun,
} from "../../shared/autoPublishTask.js";

/**
 * 单任务执行：xAI 生成 → 本地落图 → 复用 Puppeteer 微头条发布。
 */
export async function runAutoPublishTask({
  task,
  xaiProvider,
  assetsDir,
  dryRun = false,
  deps = {},
}) {
  if (!task) throw new Error("任务为空");
  if (!xaiProvider || !xaiProvider.apiKey) throw new Error("未配置 xAI API Key");

  const chatModel = String(task.chatModel || "").trim() || xaiProvider.chatModel;
  const imageModel = String(task.imageModel || "").trim() || xaiProvider.imageModel;
  const signal = deps.signal;

  const textResult = await generateWeitoutiaoText(
    { ...xaiProvider, chatModel },
    task.topicPrompt,
    { signal, chatModel }
  );
  const content = clipWeitoutiaoContent(textResult.content);

  let imagePath = "";
  if (task.generateImage !== false) {
    const img = await generateWeitoutiaoImage(
      { ...xaiProvider, imageModel },
      task.topicPrompt,
      task.imagePrompt,
      { signal, imageModel }
    );
    const outDir = path.join(assetsDir, task.id);
    imagePath = await saveXaiImageToDir(img.payload, outDir, deps);
  }

  if (dryRun || shouldAutoPublishDryRun(task)) {
    return {
      dryRun: true,
      content,
      contentPreview: previewContent(content),
      imagePath,
      message: "已完成 xAI 生成（未开启正式自动发布，未调用平台发布）",
    };
  }

  const cfg = ptConfig[task.pt] || {};
  const uploadUrl = cfg.weitoutiaoUpload || cfg.upload || cfg.graphicUpload;
  if (!uploadUrl) throw new Error(`未找到平台「${task.pt}」的微头条发布地址`);

  const accountRecord = findAccountRecordFlexible({ phone: task.phone, pt: task.pt });
  const partition = accountRecord
    ? buildAccountPartitionOf(accountRecord, task.pt)
    : buildAccountPartitionOf({ phone: task.phone }, task.pt);
  const imagePaths = imagePath ? [imagePath] : [];
  const titleLine = content.split(/\r?\n/)[0] || "微头条";

  const taskPayload = {
    taskId: Date.now() + Math.random(),
    bookName: task.name,
    textType: "weitoutiao",
    data: {
      title: titleLine.slice(0, 30),
      content,
      articleFilePath: "",
      coverPath: "",
      category: "",
      tags: "",
      summary: "",
      imagePaths,
    },
    textOtherName: titleLine.slice(0, 30),
    selectedFile: "",
    url: uploadUrl,
    show: false,
    mmCliSuppressWindow: true,
    closeWindowAfterPublish: true,
    useragent: cfg.useragent,
    partition,
    pt: task.pt,
    phone: task.phone,
    date: new Date().toISOString().slice(0, 10),
    coverPath: "",
    imagePaths,
    publishMode: "publish",
    publishToDraft: false,
  };

  const publishResult = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    const transport = {
      reply(channel, payload) {
        if (payload && payload.taskId != null && payload.taskId !== taskPayload.taskId) return;
        if (channel === "puppeteerFile-done") finish(payload);
        else if (channel === "puppeteer-noLogin") {
          finish({
            status: false,
            message: "登录态失效，需先登录后再执行自动发帖",
            loginRequired: true,
          });
        }
      },
    };
    try {
      runPuppeteerTask(taskPayload, transport, () => {});
    } catch (e) {
      reject(e);
    }
    if (deps.publishTimeoutMs) {
      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({
            status: false,
            publishAbnormal: true,
            message: "发布结果不明确（超时），未自动重试以防重复发帖",
          });
        }
      }, deps.publishTimeoutMs);
    }
  });

  const ok = publishResult && publishResult.status === true;
  const abnormal = ok && publishResult.publishAbnormal === true;
  return {
    dryRun: false,
    content,
    contentPreview: previewContent(content),
    imagePath,
    publishOk: ok && !abnormal,
    publishAbnormal: abnormal,
    message:
      (publishResult && publishResult.message) ||
      (ok ? (abnormal ? "发布回执异常，请人工核对" : "发布成功") : "发布失败"),
    loginRequired: publishResult && publishResult.loginRequired,
  };
}

export function ensureAssetsDir(app) {
  const base = app.getPath("userData");
  const dir = path.join(base, "auto-publish-assets");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}