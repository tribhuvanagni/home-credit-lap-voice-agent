// Centralised environment configuration with validation.
// Nothing else in the codebase reads process.env directly, so missing or malformed
// configuration surfaces once, at boot, instead of as a confusing runtime failure.

import dotenv from "dotenv";

dotenv.config();

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }
  return n;
}

const LANGUAGES = ["English", "Hindi"];
const GENDERS = ["male", "female"];

export const config = Object.freeze({
  port: intFromEnv("PORT", 8080),
  nodeEnv: process.env.NODE_ENV ?? "development",
  logLevel: process.env.LOG_LEVEL ?? "info",

  // LLM understanding layer. Absent key => deterministic rule extractor only.
  llm: Object.freeze({
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
    enabled: Boolean(process.env.ANTHROPIC_API_KEY) && process.env.LLM_DISABLED !== "1",
    timeoutMs: intFromEnv("LLM_TIMEOUT_MS", 8000),
  }),

  // Voice provider. Absent keys => local simulation (same qualification engine).
  voice: Object.freeze({
    retellApiKey: process.env.RETELL_API_KEY ?? null,
    retellAgentId: process.env.RETELL_AGENT_ID ?? null,
    retellFromNumber: process.env.RETELL_FROM_NUMBER ?? null,
    retellWebhookSecret: process.env.RETELL_WEBHOOK_SECRET ?? null,
    bolnaApiKey: process.env.BOLNA_API_KEY ?? null,
  }),

  defaults: Object.freeze({
    companyName: process.env.DEFAULT_COMPANY_NAME ?? "Home Credit",
    agentName: process.env.DEFAULT_AGENT_NAME ?? "Aarav",
    agentGender: process.env.DEFAULT_AGENT_GENDER ?? "male",
    language: process.env.DEFAULT_LANGUAGE ?? "English",
  }),
});

/**
 * Validates configuration that only matters once a value is actually supplied.
 * Called at boot; throws with an actionable message rather than failing later.
 */
export function validateConfig(cfg = config) {
  const problems = [];

  if (!LANGUAGES.includes(cfg.defaults.language)) {
    problems.push(`DEFAULT_LANGUAGE must be one of ${LANGUAGES.join(", ")}`);
  }
  if (!GENDERS.includes(cfg.defaults.agentGender)) {
    problems.push(`DEFAULT_AGENT_GENDER must be one of ${GENDERS.join(", ")}`);
  }
  // A Retell key without an agent id cannot place a call; fail loudly rather than
  // reporting "live" mode and then erroring on the first call attempt.
  if (cfg.voice.retellApiKey && !cfg.voice.retellAgentId) {
    problems.push("RETELL_API_KEY is set but RETELL_AGENT_ID is missing");
  }
  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
  }
  return cfg;
}

export const SUPPORTED_LANGUAGES = LANGUAGES;
export const SUPPORTED_GENDERS = GENDERS;
