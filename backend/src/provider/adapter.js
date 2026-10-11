// Voice provider adapter.
//
// The qualification engine never imports a vendor module directly — it goes through this
// adapter. Two consequences that matter:
//   * swapping Retell for Bolna touches this directory only;
//   * the simulation path and the live path run the *same* engine, so a scenario proved
//     in simulation behaves identically on a real call.
//
// The simulation is a development fallback, not a substitute for the assignment's
// required live-platform demonstration. `mode` reports which one is actually active and
// the UI surfaces it, so a simulated run is never mistaken for a real call.

import { config } from "../config.js";
import { createPhoneCall, getCall, verifyWebhookSignature } from "./retell.js";

/** Which provider is configured, and what it can actually do right now. */
export function providerInfo() {
  if (config.voice.retellApiKey) {
    return {
      provider: "retell",
      mode: "live",
      capabilities: {
        outboundCalls: Boolean(config.voice.retellFromNumber),
        transcripts: true,
        recordings: true,
        publicCallLog: true,
        webhookVerification: true,
      },
      note: config.voice.retellFromNumber
        ? "Retell configured for outbound calls."
        : "Retell key present but RETELL_FROM_NUMBER is missing — outbound calling is unavailable.",
    };
  }

  if (config.voice.bolnaApiKey) {
    return {
      provider: "bolna",
      mode: "unimplemented",
      capabilities: {
        outboundCalls: false,
        transcripts: false,
        recordings: false,
        publicCallLog: false,
        webhookVerification: false,
      },
      // Stating this plainly is the point: a key alone does not make an integration.
      note: "BOLNA_API_KEY is set, but this project implements the Retell adapter only. Remove the key or implement src/provider/bolna.js.",
    };
  }

  return {
    provider: "simulation",
    mode: "simulation",
    capabilities: {
      outboundCalls: false,
      transcripts: true, // text transcript of the simulated conversation
      recordings: false,
      publicCallLog: false,
      webhookVerification: false,
    },
    note: "No voice provider credentials configured. Running the local text simulation against the same qualification engine. Real audio, recordings and public call logs require provider setup — see docs/voice-platform-status.md.",
  };
}

/** True when a live provider can place a real outbound call. */
export function canPlaceLiveCall() {
  const info = providerInfo();
  return info.mode === "live" && info.capabilities.outboundCalls;
}

/**
 * Builds the assignment's dynamic prompt variables for a call.
 * `conversation_history` and `customer_utterance` are supplied per-turn by the platform,
 * so they are not sent at call creation.
 */
export function buildPromptVariables(state, { ragContext = "" } = {}) {
  const now = new Date();
  return {
    company_name: state.company_name,
    customer_name: state.customer_name,
    agent_name: state.agent_name,
    agent_gender: state.agent_gender,
    current_date: now.toISOString().slice(0, 10),
    current_day: now.toLocaleDateString("en-IN", { weekday: "long" }),
    current_time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    language_to_speak: state.language_to_speak,
    additional_context_from_rag: ragContext || state.additional_context_from_rag || "",
  };
}

export { createPhoneCall, getCall, verifyWebhookSignature };
