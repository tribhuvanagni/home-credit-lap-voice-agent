// Claude-backed structured extraction.
//
// The model is used for one narrowly scoped job: turning a natural utterance into a
// validated fact object. It never decides eligibility, never chooses the next question
// and never writes customer-facing copy — those are deterministic (see engine/).
// That boundary is what keeps the business rules auditable.

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { FACT_JSON_SCHEMA, validateFacts } from "./schema.js";

let client = null;

function getClient() {
  if (client) return client;
  if (!config.llm.apiKey) return null;
  client = new Anthropic({ apiKey: config.llm.apiKey, timeout: config.llm.timeoutMs });
  return client;
}

const SYSTEM_PROMPT = `You extract structured facts from one utterance spoken by a customer on a Loan Against Property qualification call.

Return only the fields the customer actually expressed in this utterance. Use null for everything else. Do not infer, do not guess, and do not fill a field because it would be convenient.

Field guidance:
- requested_loan_amount: the amount the customer wants to BORROW, in rupees.
- market_value: the estimated CURRENT VALUE of the property, in rupees.
- A figure the customer describes as monthly earnings is neither of those — leave both null.
- Convert Indian units to plain rupees: 1 lakh = 100000, 1 crore = 10000000. "75 lakhs" is 7500000.
- documents_available: "available" if original documents can be produced for verification (including kept at home), "photocopy_only" if the customer has only copies, "unavailable" if originals cannot be produced.
- tenure_years: on a self-correction such as "ten years, actually make that twelve", return the latest clear value (12).
- amount_alternative: set only when the customer is answering whether to proceed at the ₹75 lakh maximum.
- unclear: true when the utterance is unintelligible or too ambiguous to extract anything.

Report what was said. Eligibility is decided elsewhere.`;

/**
 * Extracts facts via Claude.
 * @returns {Promise<{ facts: object|null, source: string, error?: string }>}
 *   facts is null when the model path is unavailable or unusable; the caller then
 *   falls back to the rule extractor rather than proceeding with no extraction.
 */
export async function extractWithLLM({ utterance, conversationHistory = [], language = "English" }) {
  const anthropic = getClient();
  if (!anthropic) return { facts: null, source: "llm_unavailable" };

  // Only the recent turns are sent: it is all the model needs to resolve references
  // like "same as before", and it bounds both cost and the volume of customer data
  // leaving the process.
  const recent = conversationHistory
    .slice(-6)
    .map((turn) => `${turn.role === "agent" ? "Agent" : "Customer"}: ${turn.text}`)
    .join("\n");

  const userContent = [
    recent ? `Recent conversation:\n${recent}` : "Start of conversation.",
    `Configured call language: ${language}`,
    `Customer's latest utterance: ${utterance}`,
  ].join("\n\n");

  try {
    const response = await anthropic.messages.create({
      model: config.llm.model,
      max_tokens: 1024,
      output_config: {
        effort: "low", // extraction is a shallow task; low effort keeps calls cheap and fast
        format: { type: "json_schema", schema: FACT_JSON_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    if (response.stop_reason === "refusal") {
      logger.warn("llm extraction refused", { category: response.stop_details?.category ?? null });
      return { facts: null, source: "llm_refusal", error: "refusal" };
    }

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    if (!text.trim()) return { facts: null, source: "llm_empty", error: "empty_response" };

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // A malformed body is treated exactly like an outage: fall back, never guess.
      logger.warn("llm extraction returned unparseable JSON");
      return { facts: null, source: "llm_malformed", error: "invalid_json" };
    }

    const { facts, rejected } = validateFacts(parsed);
    if (rejected.length > 0) {
      logger.warn("llm extraction produced invalid fields", { rejected });
    }
    return { facts, source: "llm" };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      logger.warn("llm rate limited; falling back to rules");
      return { facts: null, source: "llm_rate_limited", error: "rate_limited" };
    }
    if (error instanceof Anthropic.AuthenticationError) {
      logger.error("llm authentication failed; check ANTHROPIC_API_KEY");
      return { facts: null, source: "llm_auth_error", error: "auth" };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      logger.warn("llm connection error; falling back to rules");
      return { facts: null, source: "llm_connection_error", error: "connection" };
    }
    if (error instanceof Anthropic.APIError) {
      logger.warn("llm api error; falling back to rules", { status: error.status });
      return { facts: null, source: "llm_api_error", error: `api_${error.status}` };
    }
    logger.error("llm unexpected error; falling back to rules", { message: error?.message });
    return { facts: null, source: "llm_unknown_error", error: "unknown" };
  }
}
