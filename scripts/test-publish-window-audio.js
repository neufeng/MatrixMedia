"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildSyncForNodeTest } = require("./esbuild-node-test-stubs.js");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const policyOut = path.join(outDir, "publishAudioPolicy.cjs");
const serviceOut = path.join(outDir, "publishWindowAudio.cjs");
buildSyncForNodeTest({
  entryPoints: [path.join(root, "src/shared/publishAudioPolicy.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: policyOut,
});
buildSyncForNodeTest({
  entryPoints: [path.join(root, "src/main/services/publishWindowAudio.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: serviceOut,
});

const {
  PUBLISH_PAGE_AUDIO_MUTE_BOOTSTRAP,
  FORBIDDEN_SNIPPET_MARKERS,
} = require(policyOut);
const {
  mutePublishBrowserWindow,
  mutePublishPuppeteerPage,
  REAL_CHROME_MUTE_AUDIO_ARG,
} = require(serviceOut);

(() => {
  for (const marker of FORBIDDEN_SNIPPET_MARKERS) {
    assert.ok(
      !PUBLISH_PAGE_AUDIO_MUTE_BOOTSTRAP.includes(marker),
      `静音脚本不得包含 ${marker}`
    );
  }
  assert.ok(PUBLISH_PAGE_AUDIO_MUTE_BOOTSTRAP.includes("MutationObserver"));
  assert.ok(PUBLISH_PAGE_AUDIO_MUTE_BOOTSTRAP.includes("muted"));
})();

(() => {
  assert.ok(PUBLISH_PAGE_AUDIO_MUTE_BOOTSTRAP.includes("querySelectorAll"));
  assert.ok(PUBLISH_PAGE_AUDIO_MUTE_BOOTSTRAP.includes("AUDIO"));
})();

(async () => {
  let muted = false;
  const win = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      setAudioMuted(v) {
        muted = v;
      },
    },
  };
  mutePublishBrowserWindow(win);
  assert.strictEqual(muted, true);
  mutePublishBrowserWindow(null);

  const calls = [];
  const page = {
    async evaluateOnNewDocument(s) {
      calls.push(["newDoc", s]);
    },
    async evaluate(s) {
      calls.push(["eval", s]);
    },
  };
  await mutePublishPuppeteerPage(page);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(REAL_CHROME_MUTE_AUDIO_ARG, "--mute-audio");
})();

console.log("test:publish-window-audio: ok");