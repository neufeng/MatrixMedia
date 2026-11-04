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
  pickFreshWeitoutiaoPanelFileInput,
  weitoutiaoFileInputDescriptorKey,
  pageTextLooksLikeWeitoutiaoUploadModalOpen,
  pageTextLooksLikeUploadModalStagingHint,
  pickWeitoutiaoUploadModalConfirmButton,
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
    inRichText: true,
    inUploadModal: false,
  }),
  true
);
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
    width: 120,
    height: 120,
    inUploadModal: true,
    inRichText: false,
    inImageStrip: false,
  }),
  false,
  "弹层内缩略图不算已插入编辑区"
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

const keyA = weitoutiaoFileInputDescriptorKey({
  id: "f1",
  name: "file",
  accept: "image/*",
  index: 0,
});
assert.ok(keyA.includes("f1"));
const fresh = pickFreshWeitoutiaoPanelFileInput(
  [
    { index: 0, inUploadPanel: true, id: "old", name: "", accept: "" },
    { index: 1, inUploadPanel: true, id: "new", name: "", accept: "" },
  ],
  [weitoutiaoFileInputDescriptorKey({ index: 0, id: "old", name: "", accept: "" })]
);
assert.strictEqual(fresh.id, "new");

assert.strictEqual(
  pageTextLooksLikeWeitoutiaoUploadModalOpen(
    "上传图片\n本地上传\n扫码上传\n已上传 1 张图片"
  ),
  true
);
assert.strictEqual(
  pageTextLooksLikeUploadModalStagingHint("已上传 1 张图片，支持拖拽"),
  true
);

const footerOk = pickWeitoutiaoUploadModalConfirmButton([
  { text: "确定", top: 100, width: 60, height: 30, tagName: "SPAN" },
  { text: "确定", top: 520, width: 88, height: 36, tagName: "BUTTON" },
]);
assert.strictEqual(footerOk.tagName, "BUTTON");
assert.strictEqual(footerOk.top, 520);

console.log("test-tt-weitoutiao-dom: ok");
