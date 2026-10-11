// Call lifecycle API.
//
// Routes validate input, delegate to engine/turn.js, and persist. They contain no
// business rules — that separation is what lets the same engine serve the HTTP API, the
// scenario runner and the voice provider without three copies of the logic.

import { Router } from "express";
import { advanceTurn, greeting } from "../engine/turn.js";
import { checklistProgress, canHandoff, effectiveLoanAmount } from "../engine/eligibility.js";
import { buildRagContext } from "../rag/knowledge.js";
import { buildPromptVariables, providerInfo } from "../provider/adapter.js";
import { getScenario } from "../scenarios.js";
import { SUPPORTED_GENDERS, SUPPORTED_LANGUAGES } from "../config.js";
import { logger } from "../logger.js";
import {
  appendEvent,
  appendTranscript,
  createCall,
  getCall,
  listCalls,
  saveCall,
  summarise,
} from "../store/memory.js";

export const router = Router();

/** Validates the call-creation payload. Returns a list of problems, empty when valid. */
function validateCallConfig(body) {
  const problems = [];

  const name = body.customer_name;
  if (name != null && (typeof name !== "string" || name.trim().length === 0)) {
    problems.push({ field: "customer_name", message: "must be a non-empty string" });
  }
  if (typeof name === "string" && name.length > 80) {
    problems.push({ field: "customer_name", message: "must be 80 characters or fewer" });
  }
  if (body.language_to_speak != null && !SUPPORTED_LANGUAGES.includes(body.language_to_speak)) {
    problems.push({
      field: "language_to_speak",
      message: `must be one of: ${SUPPORTED_LANGUAGES.join(", ")}`,
    });
  }
  if (body.agent_gender != null && !SUPPORTED_GENDERS.includes(body.agent_gender)) {
    problems.push({
      field: "agent_gender",
      message: `must be one of: ${SUPPORTED_GENDERS.join(", ")}`,
    });
  }
  if (body.additional_context_from_rag != null && typeof body.additional_context_from_rag !== "string") {
    problems.push({ field: "additional_context_from_rag", message: "must be a string" });
  }
  return problems;
}

/** The view model the frontend renders. Backend state is authoritative. */
function callView(record) {
  const gate = canHandoff(record.state);
  return {
    id: record.id,
    config: record.config,
    state: record.state,
    checklist: checklistProgress(record.state),
    handoff_gate: gate,
    effective_loan_amount: effectiveLoanAmount(record.state),
    transcript: record.transcript,
    events: record.events,
    provider: { ...record.provider, ...providerInfo() },
    prompt_variables: buildPromptVariables(record.state, {
      ragContext: record.config.additional_context_from_rag ?? "",
    }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// --- Create a call ----------------------------------------------------------
router.post("/", (req, res) => {
  const body = req.body ?? {};
  const problems = validateCallConfig(body);
  if (problems.length > 0) {
    return res.status(400).json({ error: "validation_failed", problems });
  }

  const scenario = body.scenarioId ? getScenario(body.scenarioId) : null;
  if (body.scenarioId && !scenario) {
    return res.status(400).json({
      error: "validation_failed",
      problems: [{ field: "scenarioId", message: "unknown scenario" }],
    });
  }

  const callConfig = {
    company_name: body.company_name || undefined,
    customer_name: body.customer_name || "Rahul Sharma",
    agent_name: body.agent_name || undefined,
    agent_gender: body.agent_gender || undefined,
    language_to_speak: body.language_to_speak || undefined,
    additional_context_from_rag: buildRagContext({
      operatorContext: body.additional_context_from_rag ?? "",
    }),
    scenarioId: scenario?.id ?? null,
    // A scenario may override identity/language (the Hindi scenario does).
    ...(scenario?.config ?? {}),
  };

  const record = createCall(callConfig);
  const opening = greeting(record.state);
  appendTranscript(record, "agent", opening, { stage: "greeting" });
  appendEvent(record, "call_created", { scenarioId: record.scenarioId });
  saveCall(record);

  logger.info("call created", { callId: record.id, scenarioId: record.scenarioId });
  res.status(201).json(callView(record));
});

// --- List calls -------------------------------------------------------------
router.get("/", (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit ?? "50", 10) || 50, 200);
  res.json(listCalls({ limit }).map(summarise));
});

// --- Fetch one call ---------------------------------------------------------
router.get("/:id", (req, res) => {
  const record = getCall(req.params.id);
  if (!record) return res.status(404).json({ error: "call_not_found" });
  res.json(callView(record));
});

// --- Advance one turn -------------------------------------------------------
router.post("/:id/turn", async (req, res, next) => {
  try {
    const record = getCall(req.params.id);
    if (!record) return res.status(404).json({ error: "call_not_found" });

    const raw = req.body ?? {};
    const utterance = String(raw.utterance ?? raw.text ?? "");
    if (utterance.trim() === "") {
      return res.status(400).json({
        error: "validation_failed",
        problems: [{ field: "utterance", message: "must be a non-empty string" }],
      });
    }
    if (utterance.length > 1000) {
      return res.status(400).json({
        error: "validation_failed",
        problems: [{ field: "utterance", message: "must be 1000 characters or fewer" }],
      });
    }

    const previousStatus = record.state.qualification_status;
    const result = await advanceTurn({
      state: record.state,
      utterance,
      history: record.transcript,
      forceRules: raw.forceRules === true,
    });

    // The customer turn is recorded even when the call is already closed, so the
    // transcript stays a faithful log of what was actually said.
    appendTranscript(record, "customer", utterance, { extraction: result.extraction.source });
    appendTranscript(record, "agent", result.reply, {
      status: result.state.qualification_status,
    });

    if (!result.ignored) {
      record.state = result.state;
      if (Object.keys(result.facts).length > 0) {
        appendEvent(record, "facts_extracted", {
          facts: result.facts,
          source: result.extraction.source,
          degraded: result.extraction.degraded,
        });
      }
      if (result.state.qualification_status !== previousStatus) {
        appendEvent(record, "status_changed", {
          from: previousStatus,
          to: result.state.qualification_status,
          reason: result.state.termination_reason,
        });
      }
    } else {
      appendEvent(record, "utterance_after_terminal", { ignored: true });
    }
    saveCall(record);

    res.json({
      ...callView(record),
      agent_message: result.reply,
      facts: result.facts,
      extraction: result.extraction,
      terminal: result.terminal,
      ignored: Boolean(result.ignored),
    });
  } catch (error) {
    next(error);
  }
});

// --- Run a full scenario ----------------------------------------------------
router.post("/:id/run-scenario", async (req, res, next) => {
  try {
    const record = getCall(req.params.id);
    if (!record) return res.status(404).json({ error: "call_not_found" });

    const scenario = getScenario(req.body?.scenarioId ?? record.scenarioId);
    if (!scenario) {
      return res.status(400).json({
        error: "validation_failed",
        problems: [{ field: "scenarioId", message: "unknown or missing scenario" }],
      });
    }

    for (const utterance of scenario.utterances) {
      const result = await advanceTurn({
        state: record.state,
        utterance,
        history: record.transcript,
        forceRules: req.body?.forceRules === true,
      });
      appendTranscript(record, "customer", utterance);
      appendTranscript(record, "agent", result.reply);
      if (!result.ignored) record.state = result.state;
      if (result.terminal) break; // a concluded call does not consume further script lines
    }
    appendEvent(record, "scenario_completed", { scenarioId: scenario.id });
    saveCall(record);

    res.json({ ...callView(record), scenario: { id: scenario.id, expect: scenario.expect } });
  } catch (error) {
    next(error);
  }
});
