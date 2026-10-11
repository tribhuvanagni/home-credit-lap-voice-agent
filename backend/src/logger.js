// Minimal structured logger with secret redaction.
// Deliberately dependency-free: the assignment's scale does not justify a logging
// framework, but secrets and customer utterances still must not leak into logs.

import { config } from "./config.js";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

const SECRET_KEY_PATTERN = /(api[_-]?key|secret|token|authorization|password)/i;

/** Replaces secret-looking values and truncates free text so logs stay safe to ship. */
function redact(value, depth = 0) {
  if (depth > 4 || value == null) return value;
  if (typeof value === "string") {
    return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level, message, meta) {
  if (LEVELS[level] > threshold) return;
  const line = { ts: new Date().toISOString(), level, message };
  if (meta !== undefined) line.meta = redact(meta);
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const logger = {
  error: (message, meta) => emit("error", message, meta),
  warn: (message, meta) => emit("warn", message, meta),
  info: (message, meta) => emit("info", message, meta),
  debug: (message, meta) => emit("debug", message, meta),
};
