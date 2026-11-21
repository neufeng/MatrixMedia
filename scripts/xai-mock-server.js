"use strict";

const http = require("http");

const VALID_KEY = "xai-test-key-1234567890";

function createXaiMockServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body });
      const auth = req.headers.authorization || "";
      if (!auth.includes(VALID_KEY)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid API Key" } }));
        return;
      }
      if (req.url === "/v1/chat/completions") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: "今天阳光很好，适合喝一杯手冲咖啡，记录下慢生活的小确幸。" } }],
          })
        );
        return;
      }
      if (req.url === "/v1/images/generations") {
        const tiny = Buffer.from("fake-image-bytes").toString("base64");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ b64_json: tiny }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return { server, requests, VALID_KEY };
}

module.exports = { createXaiMockServer, VALID_KEY };