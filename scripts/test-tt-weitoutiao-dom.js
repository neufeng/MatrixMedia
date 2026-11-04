"use strict";

const assert = require("assert");
const {
  pageLooksLikeWeitoutiaoPublishPage,
  isWeitoutiaoComposerPlaceholder,
  isWeitoutiaoToolbarImageHint,
  pickWeitoutiaoToolbarImageButton,
  isWeitoutiaoPublishButtonLabel,
  pickWeitoutiaoComposerCandidate,
  looksLikeWeitoutiaoAttachedImagePreview,
  countWeitoutiaoAttachedImagePreviews,
  pickWeitoutiaoUploadFileInputCandidate,
} = require("../src/shared/ttWeitoutiaoDom.js");

assert.strictEqual(
  pageLooksLikeWeitoutiaoPublishPage("发布微头条\n有什么新鲜事想告诉大家？"),
  true
);
assert.strictEqual(pageLooksLikeWeitoutiaoPublishPage("发布图文"), false);

assert.strictEqual(
  isWeitoutiaoComposerPlaceholder("有什么新鲜事想告诉大家？"),
  true
);
assert.strictEqual(isWeitoutiaoComposerPlaceholder("请输入标题"), false);

assert.strictEqual(isWeitoutiaoToolbarImageHint("图片"), true);
assert.strictEqual(isWeitoutiaoToolbarImageHint("上传图片"), false);
assert.strictEqual(isWeitoutiaoToolbarImageHint("文档导入"), false);

const imgBtn = pickWeitoutiaoToolbarImageButton([
  { text: "图片表情视频", width: 400, height: 40, tagName: "DIV", x: 0, y: 0 },
  { text: "图片", width: 48, height: 32, tagName: "BUTTON", x: 10, y: 20 },
]);
assert.strictEqual(imgBtn.tagName, "BUTTON");
assert.strictEqual(imgBtn.text, "图片");

assert.strictEqual(isWeitoutiaoPublishButtonLabel("发布"), true);
assert.strictEqual(isWeitoutiaoPublishButtonLabel("定时发布"), false);

const ceOnly = pickWeitoutiaoComposerCandidate([
  { tagName: "DIV", contentEditable: true },
]);
assert.strictEqual(ceOnly.tagName, "DIV");

const textareaWins = pickWeitoutiaoComposerCandidate([
  { tagName: "DIV", contentEditable: true },
  { tagName: "TEXTAREA" },
]);
assert.strictEqual(textareaWins.tagName, "TEXTAREA");

assert.strictEqual(
  looksLikeWeitoutiaoAttachedImagePreview({
    width: 80,
    height: 80,
    inComposer: true,
    inUploadModal: false,
  }),
  true
);
assert.strictEqual(
  looksLikeWeitoutiaoAttachedImagePreview({
    width: 80,
    height: 80,
    inUploadModal: true,
    inComposer: true,
  }),
  false
);
assert.strictEqual(
  looksLikeWeitoutiaoAttachedImagePreview({
    width: 16,
    height: 16,
    inImageStrip: true,
  }),
  false
);

assert.strictEqual(
  countWeitoutiaoAttachedImagePreviews([
    { width: 64, height: 64, inComposer: true },
    { width: 64, height: 64, inUploadModal: true, inComposer: true },
    { width: 72, height: 72, inImageStrip: true },
  ]),
  2
);

const panelInput = pickWeitoutiaoUploadFileInputCandidate([
  { index: 0, inUploadPanel: false },
  { index: 1, inUploadPanel: true },
]);
assert.strictEqual(panelInput.index, 1);
assert.strictEqual(
  pickWeitoutiaoUploadFileInputCandidate([{ index: 0, inUploadPanel: false }]),
  null
);
assert.strictEqual(
  pickWeitoutiaoUploadFileInputCandidate(
    [{ index: 2, inUploadPanel: false }],
    { requireInPanel: false }
  ).index,
  2
);

console.log("test-tt-weitoutiao-dom: ok");
