// HTTP API tests: validation, state authority, webhook idempotency, scenario runs.

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { startTestServer } from "./helpers/http.js";
import { clearAll } from "../backend/src/store/memory.js";

/** @type {Awaited<ReturnType<typeof startTestServer>>} */
let api;

beforeAll(async () => {
  api = await startTestServer();
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => clearAll());

async function createCall(body = {}) {
  const response = await api.post("/api/calls", { customer_name: "Rahul Sharma", ...body });
  expect(response.status).toBe(201);
  return response.body;
}

describe("health and metadata", () => {
  it("reports health", async () => {
    const response = await api.get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("reports simulation mode when no provider key is configured", async () => {
    const response = await api.get("/api/provider");
    expect(response.status).toBe(200);
    // The suite runs without credentials, so this must not claim live capability.
    expect(response.body.mode).toBe("simulation");
    expect(response.body.capabilities.recordings).toBe(false);
    expect(response.body.note).toMatch(/docs\/voice-platform-status\.md/);
  });

  it("exposes the business rules without a hardcoded second copy", async () => {
    const response = await api.get("/api/rules");
    expect(response.body.max_loan).toBe(7_500_000);
    expect(response.body.tenure).toEqual({ min: 3, max: 15, inclusive: true });
    expect(response.body.market_value.threshold).toBeNull();
    expect(response.body.checklist).toHaveLength(7);
  });

  it("lists scenarios with their expected outcomes", async () => {
    const response = await api.get("/api/scenarios");
    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThanOrEqual(15);
    for (const scenario of response.body) {
      expect(scenario.utterances.length).toBeGreaterThan(0);
      expect(scenario.expect).toBeTruthy();
    }
  });
});

describe("request validation", () => {
  it("rejects an unsupported language", async () => {
    const response = await api.post("/api/calls", { customer_name: "Rahul", language_to_speak: "Klingon" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("validation_failed");
    expect(response.body.problems[0].field).toBe("language_to_speak");
  });

  it("rejects an unsupported agent gender", async () => {
    const response = await api.post("/api/calls", { customer_name: "Rahul", agent_gender: "robot" });
    expect(response.status).toBe(400);
    expect(response.body.problems[0].field).toBe("agent_gender");
  });

  it("rejects an empty customer name", async () => {
    const response = await api.post("/api/calls", { customer_name: "   " });
    expect(response.status).toBe(400);
  });

  it("rejects an empty utterance", async () => {
    const call = await createCall();
    const response = await api.post(`/api/calls/${call.id}/turn`, { utterance: "" });
    expect(response.status).toBe(400);
    expect(response.body.problems[0].field).toBe("utterance");
  });

  it("rejects an over-long utterance", async () => {
    const call = await createCall();
    const response = await api.post(`/api/calls/${call.id}/turn`, { utterance: "x".repeat(1001) });
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown call", async () => {
    const response = await api.post("/api/calls/does-not-exist/turn", { utterance: "Yes, speaking." });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("call_not_found");
  });

  it("returns 404 for an unknown API route", async () => {
    const response = await api.get("/api/nope");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("route_not_found");
  });

  it("rejects an unknown scenario id", async () => {
    const response = await api.post("/api/calls", { customer_name: "Rahul", scenarioId: "not-a-scenario" });
    expect(response.status).toBe(400);
  });
});

describe("call lifecycle", () => {
  it("opens with a greeting that names the customer and the company", async () => {
    const call = await createCall();
    expect(call.transcript).toHaveLength(1);
    expect(call.transcript[0].role).toBe("agent");
    expect(call.transcript[0].text).toMatch(/Rahul Sharma/);
    expect(call.transcript[0].text).toMatch(/Home Credit/);
    expect(call.state.customer_verified).toBe(false);
  });

  it("renders the prompt with every assignment variable resolved", async () => {
    const response = await api.get("/api/prompt?language=Hindi");
    expect(response.status).toBe(200);
    expect(response.body.unresolved).toEqual([]);
    for (const key of [
      "company_name", "customer_name", "agent_name", "agent_gender",
      "current_date", "current_day", "current_time",
      "additional_context_from_rag", "language_to_speak",
      "conversation_history", "customer_utterance",
    ]) {
      expect(response.body.variables).toHaveProperty(key);
    }
    // Every assignment variable is substituted. The `{{<name>}}` in the platform note
    // is prose describing the syntax, so `rendered` still contains that literal.
    expect(response.body.rendered).not.toMatch(/\{\{\s*\w+\s*\}\}/);
    expect(response.body.rendered).toMatch(/Rahul Sharma/);
    expect(response.body.variables.language_to_speak).toBe("Hindi");
  });

  it("exposes the checklist and handoff gate alongside state", async () => {
    const call = await createCall();
    expect(call.checklist).toHaveLength(7);
    expect(call.checklist.every((item) => item.answered === false)).toBe(true);
    expect(call.handoff_gate).toEqual({ ok: false, reason: "not_verified" });
  });

  it("keeps the backend authoritative — a client cannot set its own status", async () => {
    const call = await createCall();
    const response = await api.post(`/api/calls/${call.id}/turn`, {
        utterance: "Yes, speaking.",
        // A malicious or buggy client tries to force a qualified outcome.
        state: { qualification_status: "qualified" },
        qualification_status: "qualified",
      });
    expect(response.status).toBe(200);
    expect(response.body.state.qualification_status).toBe("in_progress");
    expect(response.body.state.handoff_status).toBe("not_started");
  });

  it("records the transcript with speaker roles and timestamps", async () => {
    const call = await createCall();
    await api.post(`/api/calls/${call.id}/turn`, { utterance: "Yes, speaking." });
    const response = await api.get(`/api/calls/${call.id}`);
    const roles = response.body.transcript.map((turn) => turn.role);
    expect(roles).toEqual(["agent", "customer", "agent"]);
    for (const turn of response.body.transcript) {
      expect(turn.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("lists calls with their outcomes", async () => {
    const call = await createCall();
    await api.post(`/api/calls/${call.id}/turn`, { utterance: "Yes, speaking." });
    const response = await api.get("/api/calls");
    expect(response.status).toBe(200);
    expect(response.body[0].id).toBe(call.id);
    expect(response.body[0].status).toBe("in_progress");
  });
});

describe("scenario runner", () => {
  it("runs a scenario end to end and reaches its expected outcome", async () => {
    const call = await createCall({ scenarioId: "eligible_full" });
    const response = await api.post(`/api/calls/${call.id}/run-scenario`, { forceRules: true });
    expect(response.status).toBe(200);
    expect(response.body.state.qualification_status).toBe("qualified");
    expect(response.body.checklist.every((item) => item.answered)).toBe(true);
  });

  it("stops consuming the script once the call terminates", async () => {
    const call = await createCall({ scenarioId: "agricultural" });
    const response = await api.post(`/api/calls/${call.id}/run-scenario`, { forceRules: true });
    expect(response.body.state.qualification_status).toBe("disqualified");
    expect(response.body.state.ownership_status).toBeNull();
  });

  it("runs the Hindi scenario with its own agent configuration", async () => {
    const call = await createCall({ scenarioId: "hindi_eligible" });
    expect(call.state.language_to_speak).toBe("Hindi");
    expect(call.state.agent_gender).toBe("female");
    const response = await api.post(`/api/calls/${call.id}/run-scenario`, { forceRules: true });
    expect(response.body.state.qualification_status).toBe("qualified");
  });
});

describe("31. Repeated webhook delivery", () => {
  it("rejects an unsigned webhook", async () => {
    const response = await api.post("/api/webhooks/retell", { event: "call_ended", call: { call_id: "abc" } });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("signature_verification_failed");
  });

  it("reports that verification is unavailable without credentials", async () => {
    const response = await api.get("/api/webhooks/status");
    expect(response.status).toBe(200);
    expect(response.body.retell.verification_available).toBe(false);
    expect(response.body.retell.signature_header).toBe("x-retell-signature");
  });

  it("deduplicates repeated deliveries by event and call id", async () => {
    const { markWebhookProcessed } = await import("../backend/src/store/memory.js");
    // The store is the idempotency boundary; verification is tested separately above
    // because it needs credentials this environment does not have.
    expect(markWebhookProcessed("call_ended:abc")).toBe(true);
    expect(markWebhookProcessed("call_ended:abc")).toBe(false);
    expect(markWebhookProcessed("call_ended:abc")).toBe(false);
    expect(markWebhookProcessed("call_analyzed:abc")).toBe(true);
  });
});

describe("knowledge retrieval", () => {
  it("defers interest-rate questions instead of answering them", async () => {
    const response = await api.post("/api/knowledge/query", { question: "What interest rate do you offer?" });
    expect(response.status).toBe(200);
    expect(response.body.deferred).toBe("interest_rate");
    expect(response.body.hit).toBe(false);
    expect(response.body.text).toBeNull();
  });

  it("answers a grounded question from the knowledge base", async () => {
    const response = await api.post("/api/knowledge/query", { question: "What is the maximum amount I can borrow?" });
    expect(response.body.hit).toBe(true);
    expect(response.body.text).toMatch(/75,00,000/);
  });

  it("reports a miss rather than inventing an answer", async () => {
    const response = await api.post("/api/knowledge/query", { question: "Do you offer travel insurance for Antarctica?" });
    expect(response.body.hit).toBe(false);
    expect(response.body.text).toBeNull();
  });

  it("excludes rates and fees from the knowledge base entirely", async () => {
    const response = await api.get("/api/knowledge");
    const corpus = JSON.stringify(response.body.entries);
    expect(corpus).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(response.body.deferred_topics).toContain("interest_rate");
    expect(response.body.deferred_topics).toContain("fees");
  });

  it("validates the query payload", async () => {
    const response = await api.post("/api/knowledge/query", { question: "" });
    expect(response.status).toBe(400);
  });
});

describe("callback requests", () => {
  it("records a callback as a request that is explicitly not scheduled", async () => {
    const call = await createCall();
    await api.post(`/api/calls/${call.id}/turn`, { utterance: "I'm busy, call me tomorrow evening.", forceRules: true });

    const response = await api.get("/api/callbacks");
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].requested_time).toMatch(/tomorrow evening/i);
    // No scheduling integration exists, so this must never claim otherwise.
    expect(response.body[0].scheduled).toBe(false);
  });
});
