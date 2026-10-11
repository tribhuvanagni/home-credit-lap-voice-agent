// Metadata, health and prompt-preview endpoints.

import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { providerInfo, buildPromptVariables } from "../provider/adapter.js";
import { listScenarios } from "../scenarios.js";
import { createInitialState } from "../engine/state.js";
import { CHECKLIST, MAX_LOAN, MIN_TENURE_YEARS, MAX_TENURE_YEARS } from "../engine/eligibility.js";
import { DEFAULT_KNOWLEDGE_BASE, DEFERRED_TOPICS, retrieve } from "../rag/knowledge.js";
import { listCallbackRequests } from "../store/memory.js";
import { config } from "../config.js";

export const router = Router();

const here = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = path.join(here, "../../../prompts");

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    llm: { enabled: config.llm.enabled, model: config.llm.enabled ? config.llm.model : null },
    provider: providerInfo().provider,
  });
});

router.get("/provider", (req, res) => res.json(providerInfo()));

router.get("/scenarios", (req, res) => res.json(listScenarios()));

router.get("/callbacks", (req, res) => res.json(listCallbackRequests()));

/** The business rules, so the UI can render them instead of hardcoding a second copy. */
router.get("/rules", (req, res) => {
  res.json({
    max_loan: MAX_LOAN,
    tenure: { min: MIN_TENURE_YEARS, max: MAX_TENURE_YEARS, inclusive: true },
    checklist: CHECKLIST,
    property_types: { eligible: ["residential", "commercial", "industrial"], disqualifying: ["agricultural"] },
    ownership: { eligible: ["sole", "joint"] },
    documents: { eligible: ["available"], disqualifying: ["unavailable", "photocopy_only"] },
    income: { eligible: ["bank"], disqualifying: ["cash"] },
    market_value: { threshold: null, note: "No minimum is specified by the assignment; value is captured only." },
  });
});

/** The knowledge base and the topics that must always be deferred. */
router.get("/knowledge", (req, res) => {
  res.json({
    entries: DEFAULT_KNOWLEDGE_BASE,
    deferred_topics: DEFERRED_TOPICS.map((topic) => topic.id),
    note: "Interest rates, fees, approvals and branch details are deliberately absent: the senior loan expert provides those, so the agent defers instead of answering.",
  });
});

/** Ad-hoc retrieval check, used by the UI's RAG inspector. */
router.post("/knowledge/query", (req, res) => {
  const question = String(req.body?.question ?? "");
  if (question.trim() === "") {
    return res.status(400).json({
      error: "validation_failed",
      problems: [{ field: "question", message: "must be a non-empty string" }],
    });
  }
  res.json({ question, ...retrieve(question) });
});

/**
 * Renders the system prompt with a given configuration, so the operator sees exactly
 * what the voice platform would receive.
 */
router.get("/prompt", (req, res) => {
  const language = req.query.language === "Hindi" ? "Hindi" : "English";
  const file = path.join(PROMPT_DIR, "system_prompt.md");

  let template;
  try {
    template = fs.readFileSync(file, "utf8");
  } catch {
    return res.status(500).json({ error: "prompt_not_found", path: "prompts/system_prompt.md" });
  }

  const state = createInitialState({
    customer_name: req.query.customer_name || "Rahul Sharma",
    agent_name: req.query.agent_name || undefined,
    agent_gender: req.query.agent_gender || undefined,
    language_to_speak: language,
  });
  const variables = {
    ...buildPromptVariables(state),
    conversation_history: "<supplied per turn by the voice platform>",
    customer_utterance: "<supplied per turn by the voice platform>",
  };

  const rendered = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    key in variables ? String(variables[key]) : match,
  );

  res.json({
    template,
    rendered,
    variables,
    // Every variable the assignment specifies must appear in the template.
    unresolved: [...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
      .map((m) => m[1])
      .filter((key) => !(key in variables)),
  });
});
