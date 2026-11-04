"use strict";

const assert = require("assert");
const {
  normalizeTtGraphicDomText,
  pageTextLooksLikeInlineImageUploadPanel,
  isToolbarImageInsertHint,
  pickTtGraphicLocalUploadButton,
} = require("../src/shared/ttGraphicUploadDom.js");

assert.strictEqual(normalizeTtGraphicDomText(" 本 地\n上传 "), "本地上传");

assert.strictEqual(
  pageTextLooksLikeInlineImageUploadPanel(
    "上传图片\n免费正版图片\n本地上传\n扫码上传\n支持jpg"
  ),
  true
);
assert.strictEqual(
  pageTextLooksLikeInlineImageUploadPanel("展示封面\n本地上传\n扫码上传"),
  false
);

assert.strictEqual(isToolbarImageInsertHint("插入图片"), true);
assert.strictEqual(isToolbarImageInsertHint("图片"), true);
assert.strictEqual(isToolbarImageInsertHint("上传图片"), false);
assert.strictEqual(isToolbarImageInsertHint("展示封面"), false);

const picked = pickTtGraphicLocalUploadButton([
  {
    text: "本地上传扫码上传支持jpg",
    width: 800,
    height: 400,
    tagName: "DIV",
    x: 0,
    y: 0,
  },
  { text: "本地上传", width: 140, height: 44, tagName: "BUTTON", x: 10, y: 20 },
  { text: "本地上传", width: 160, height: 48, tagName: "DIV", x: 12, y: 22 },
]);
assert.strictEqual(picked.tagName, "BUTTON");
assert.strictEqual(picked.text, "本地上传");

console.log("test-tt-graphic-upload-dom: ok");
