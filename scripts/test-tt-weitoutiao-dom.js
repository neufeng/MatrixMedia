"use strict";

const assert = require("assert");
const {
  pageLooksLikeWeitoutiaoPublishPage,
  isWeitoutiaoComposerPlaceholder,
  isWeitoutiaoToolbarImageHint,
  pickWeitoutiaoToolbarImageButton,
  isWeitoutiaoPublishButtonLabel,
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

console.log("test-tt-weitoutiao-dom: ok");
