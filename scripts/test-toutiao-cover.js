"use strict";

const assert = require("assert");
const {
  TT_COVER_MIN_WIDTH,
  TT_COVER_MIN_HEIGHT,
  meetsToutiaoCoverMinSize,
  scaleToMeetMinimum,
  parseResolutionPair,
  isToutiaoLowResCoverHint,
  pageTextSuggestsLowToutiaoCover,
} = require("../src/shared/toutiaoCover.js");

const pair = parseResolutionPair("当前封面分辨率为 480*854");
assert.deepStrictEqual(pair, { width: 480, height: 854 });
assert.deepStrictEqual(parseResolutionPair("480×854"), { width: 480, height: 854 });
assert.deepStrictEqual(pair, { width: 480, height: 854 });

assert.strictEqual(meetsToutiaoCoverMinSize(618, 1000), true);
assert.strictEqual(meetsToutiaoCoverMinSize(480, 854), false);

const scaled = scaleToMeetMinimum(480, 854);
assert.ok(scaled.width >= TT_COVER_MIN_WIDTH);
assert.ok(scaled.height >= TT_COVER_MIN_HEIGHT);

assert.strictEqual(
  isToutiaoLowResCoverHint("上传更清晰的封面，建议分辨率不低于 618*1000"),
  true
);
assert.strictEqual(
  pageTextSuggestsLowToutiaoCover("当前封面分辨率为 480*854，建议不低于 618*1000"),
  true
);

console.log("test-toutiao-cover: ok");
