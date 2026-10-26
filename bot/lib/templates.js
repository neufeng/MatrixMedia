"use strict";

const path = require("path");

function basenameNoExt(filePath) {
  const base = filePath.replace(/\\/g, "/").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * 简单 {{key}} 模板，用于 title / description / name
 * @param {string} template
 * @param {Record<string, string>} vars
 */
function applyTemplate(template, vars) {
  if (template == null || template === "") {
    return "";
  }
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] != null ? String(vars[key]) : "";
  });
}

function isGraphicJob(job) {
  const kind = String(job.type || job.kind || job.textType || "").toLowerCase();
  return kind === "graphic" || kind === "article-graphic" || kind === "tt-graphic";
}

function resolvePathInWorkDir(workDir, fileRef) {
  if (!fileRef) return "";
  const text = String(fileRef).trim();
  if (!text) return "";
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(workDir, text);
}

function buildGraphicJobFields(job, defaults, workDir) {
  const title =
    job.title ||
    applyTemplate(defaults.title, {
      filename: "graphic",
      title: job.title || "",
      date: new Date().toISOString().slice(0, 10),
    }) ||
    "头条图文";
  const images = (Array.isArray(job.images) ? job.images : [])
    .map((item) => resolvePathInWorkDir(workDir, item))
    .filter(Boolean);
  const cover = resolvePathInWorkDir(workDir, job.cover || "");
  const contentFile = resolvePathInWorkDir(
    workDir,
    job.contentFile || job.bodyFile || ""
  );
  return {
    kind: "graphic",
    title,
    content: job.content != null ? String(job.content) : "",
    contentFile,
    cover,
    images,
    tags: job.tags != null ? job.tags : defaults.tags,
    platforms:
      Array.isArray(job.platforms) && job.platforms.length
        ? job.platforms
        : defaults.platforms,
    publishAt: job.publishAt || null,
  };
}

function buildJobFields(job, defaults, videoPath) {
  const filename = basenameNoExt(videoPath);
  const vars = {
    filename,
    title: job.title || "",
    date: new Date().toISOString().slice(0, 10),
  };
  return {
    title: job.title || applyTemplate(defaults.title, vars) || filename,
    description:
      job.description != null
        ? job.description
        : applyTemplate(defaults.description, vars),
    tags: job.tags != null ? job.tags : defaults.tags,
    name: job.name || applyTemplate(defaults.name, vars) || filename,
    platforms:
      Array.isArray(job.platforms) && job.platforms.length
        ? job.platforms
        : defaults.platforms,
    publishAt: job.publishAt || null,
    file: videoPath,
  };
}

module.exports = {
  applyTemplate,
  basenameNoExt,
  buildJobFields,
  buildGraphicJobFields,
  isGraphicJob,
};
