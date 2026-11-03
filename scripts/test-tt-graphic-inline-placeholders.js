"use strict";

const assert = require("assert");
const path = require("path");
const {
  parseTtGraphicBodySegments,
  resolveTtGraphicImageSegments,
  bodyHasInlineImagePlaceholders,
  ttGraphicVisibleTextProbe,
} = require("../src/shared/ttGraphicInlinePlaceholders.js");

const imgA = path.resolve("/tmp/01-校园清晨.jpg");
const imgB = path.resolve("/tmp/02-招聘会.jpg");

const body = [
  "第一段文字",
  "[图1：01-校园清晨.jpg]",
  "第二段文字",
  "[图2:02-招聘会.jpg]",
  "结尾",
].join("\n");

assert.strictEqual(bodyHasInlineImagePlaceholders(body), true);
assert.strictEqual(bodyHasInlineImagePlaceholders("无占位符"), false);

const segments = parseTtGraphicBodySegments(body);
assert.strictEqual(segments.length, 5);
assert.deepStrictEqual(segments[0], { type: "text", content: "第一段文字" });
assert.deepStrictEqual(segments[1], {
  type: "image",
  markerIndex: 1,
  filenameHint: "01-校园清晨.jpg",
});
assert.deepStrictEqual(segments[2], { type: "text", content: "第二段文字" });
assert.deepStrictEqual(segments[3], {
  type: "image",
  markerIndex: 2,
  filenameHint: "02-招聘会.jpg",
});
assert.deepStrictEqual(segments[4], { type: "text", content: "结尾" });

const { segments: resolved, unusedPaths } = resolveTtGraphicImageSegments(
  segments,
  [imgA, imgB]
);
assert.strictEqual(resolved[1].filePath, imgA);
assert.strictEqual(resolved[3].filePath, imgB);
assert.deepStrictEqual(unusedPaths, []);

const orderBody = "上文\n[图1：任意描述]\n下文";
const orderSegs = parseTtGraphicBodySegments(orderBody);
const orderResolved = resolveTtGraphicImageSegments(orderSegs, [imgA, imgB]);
assert.strictEqual(orderResolved.segments[1].filePath, imgA);

const mdBody = "intro\n![说明](./pics/a.jpg)\noutro";
const mdSegs = parseTtGraphicBodySegments(mdBody);
assert.strictEqual(mdSegs[1].type, "image");
assert.strictEqual(mdSegs[1].markdownPath, "./pics/a.jpg");

assert.ok(ttGraphicVisibleTextProbe(segments).startsWith("第一段文字"));
assert.ok(!ttGraphicVisibleTextProbe(segments).includes("[图1"));

console.log("test-tt-graphic-inline-placeholders: ok");
