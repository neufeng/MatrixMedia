"use strict";

/**
 * DevTools 端点读取回归测试（P2-6 protocolTimeout 支撑）。
 *
 * puppeteer-in-electron 的 connect 不透传 protocolTimeout（固定 180s），
 * 我们自己读 /json/version 再连；这段 I/O 必须稳：
 * 正常返回、HTTP 错误、非 JSON、端口不通、超时，五种情况都要有确定行为。
 */

const path = require("path");
const fs = require("fs");
const http = require("http");
const assert = require("assert");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "test/.cache");
fs.mkdirSync(outDir, { recursive: true });

const bundle = path.join(outDir, "devToolsEndpoint.cjs");
buildSync({
  entryPoints: [path.join(root, "src/main/services/devToolsEndpoint.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});

const { readDevToolsVersion, DEVTOOLS_PROTOCOL_TIMEOUT_MS } = require(bundle);

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function portOf(server) {
  return server.address().port;
}

(async () => {
  // 1. 默认超时是 10 分钟级别（不是 puppeteer 的 180s）
  assert.strictEqual(DEVTOOLS_PROTOCOL_TIMEOUT_MS >= 300000, true);

  // 1b. 环境变量非法（非数字/0/负数）必须回退默认，不能把 NaN 透传给 puppeteer
  {
    const { execFileSync } = require("child_process");
    const probe = path.join(root, "src/main/services/devToolsEndpoint.js");
    const read = (val) =>
      Number(
        execFileSync(
          process.execPath,
          [
            "-e",
            `const m=require(${JSON.stringify(probe)});console.log(m.DEVTOOLS_PROTOCOL_TIMEOUT_MS)`,
          ],
          { env: { ...process.env, MM_PROTOCOL_TIMEOUT_MS: val }, encoding: "utf8" }
        ).trim()
      );
    assert.strictEqual(read("abc"), 600000, "非数字应回退 600000");
    assert.strictEqual(read(""), 600000, "空串应回退 600000");
    assert.strictEqual(read("0"), 600000, "0 应回退 600000");
    assert.strictEqual(read("-5"), 600000, "负数应回退 600000");
    assert.strictEqual(read("900000"), 900000, "合法值应生效");
  }

  // 2. 正常返回 /json/version
  {
    const payload = {
      Browser: "Chrome/138.0.7204.0",
      webSocketDebuggerUrl: "ws://127.0.0.1:1234/devtools/browser/abc",
    };
    const server = await serve((req, res) => {
      assert.strictEqual(req.url, "/json/version");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
    const json = await readDevToolsVersion(portOf(server));
    assert.strictEqual(json.webSocketDebuggerUrl, payload.webSocketDebuggerUrl);
    server.close();
  }

  // 3. HTTP 404 要 reject
  {
    const server = await serve((req, res) => {
      res.writeHead(404);
      res.end("not found");
    });
    await assert.rejects(
      () => readDevToolsVersion(portOf(server)),
      /HTTP 404/
    );
    server.close();
  }

  // 4. 非 JSON 要 reject（不能把 HTML 错误页当端点）
  {
    const server = await serve((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>nope</html>");
    });
    await assert.rejects(
      () => readDevToolsVersion(portOf(server)),
      /不是合法 JSON/
    );
    server.close();
  }

  // 5. 端口不通要 reject（调用方据此退回 pie.connect）
  {
    const server = await serve((req, res) => res.end("{}"));
    const deadPort = portOf(server);
    await new Promise((r) => server.close(r));
    await assert.rejects(() => readDevToolsVersion(deadPort, 2000));
  }

  // 6. 超时要 reject（服务端不响应）
  {
    const server = await serve(() => {
      /* 故意不响应 */
    });
    await assert.rejects(
      () => readDevToolsVersion(portOf(server), 300),
      /超时/
    );
    server.closeAllConnections?.();
    server.close();
  }

  console.log("test-devtools-endpoint: 全部断言通过");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
