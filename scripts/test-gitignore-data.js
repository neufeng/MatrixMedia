"use strict";

const { execFileSync } = require("child_process");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const out = execFileSync("git", ["check-ignore", "-v", "data/account/x.json"], {
  cwd: root,
  encoding: "utf8",
});
assert.ok(out.includes("data"), `git check-ignore 应命中 data: ${out}`);

console.log("test:gitignore-data: ok");