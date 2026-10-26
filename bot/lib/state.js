"use strict";

const fs = require("fs");
const path = require("path");

function readState(stateFile) {
  try {
    if (!fs.existsSync(stateFile)) {
      return { day: todayKey(), postsToday: 0, lastPublishAt: 0 };
    }
    const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const day = todayKey();
    if (data.day !== day) {
      return { day, postsToday: 0, lastPublishAt: data.lastPublishAt || 0 };
    }
    return {
      day: data.day,
      postsToday: Number(data.postsToday) || 0,
      lastPublishAt: Number(data.lastPublishAt) || 0,
    };
  } catch {
    return { day: todayKey(), postsToday: 0, lastPublishAt: 0 };
  }
}

function writeState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @returns {{ allowed: boolean, reason?: string, waitMs?: number }}
 */
function checkRateLimits(config, state) {
  if (config.maxPostsPerDay > 0 && state.postsToday >= config.maxPostsPerDay) {
    return {
      allowed: false,
      reason: `已达每日上限 maxPostsPerDay=${config.maxPostsPerDay}`,
    };
  }
  if (config.rateLimitMs > 0 && state.lastPublishAt) {
    const elapsed = Date.now() - state.lastPublishAt;
    if (elapsed < config.rateLimitMs) {
      return {
        allowed: false,
        reason: `距上次发布不足 rateLimitMs=${config.rateLimitMs}`,
        waitMs: config.rateLimitMs - elapsed,
      };
    }
  }
  return { allowed: true };
}

function recordPublish(stateFile, state) {
  const next = {
    day: todayKey(),
    postsToday: state.postsToday + 1,
    lastPublishAt: Date.now(),
  };
  writeState(stateFile, next);
  return next;
}

module.exports = {
  readState,
  writeState,
  checkRateLimits,
  recordPublish,
  todayKey,
};
