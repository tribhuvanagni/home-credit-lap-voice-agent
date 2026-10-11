// Retell AI client.
//
// Endpoints, field names and the webhook signature mechanism are taken from Retell's
// published API reference (docs.retellai.com), not from guesswork:
//
//   POST https://api.retellai.com/v2/create-phone-call
//   GET  https://api.retellai.com/v2/get-call/{call_id}
//   Auth: Authorization: Bearer <RETELL_API_KEY>
//   Webhook signature header: x-retell-signature, verified against the RAW request body
//
// This code is written against that reference but has NOT been exercised against a live
// Retell account, because no credentials exist in this workspace. See
// docs/voice-platform-status.md — that limitation is stated there rather than hidden.

import { config } from "../config.js";
import { logger } from "../logger.js";

const BASE_URL = "https://api.retellai.com";

class RetellError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "RetellError";
    this.status = status;
    this.body = body;
  }
}

async function request(path, { method = "GET", body, timeoutMs = 15000 } = {}) {
  if (!config.voice.retellApiKey) {
    throw new RetellError("RETELL_API_KEY is not configured", 0, null);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.voice.retellApiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (!response.ok) {
      throw new RetellError(
        `Retell ${method} ${path} failed with ${response.status}`,
        response.status,
        parsed,
      );
    }
    return parsed;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new RetellError(`Retell ${method} ${path} timed out`, 504, null);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Places an outbound qualification call.
 *
 * The assignment's dynamic prompt variables are passed through
 * `retell_llm_dynamic_variables`, which is Retell's documented mechanism for injecting
 * values into the agent's prompt. `idempotency_key` means a retried request does not
 * dial the customer twice.
 */
export async function createPhoneCall({ toNumber, variables, metadata, idempotencyKey }) {
  if (!config.voice.retellFromNumber) {
    throw new RetellError("RETELL_FROM_NUMBER is not configured", 0, null);
  }

  const payload = {
    from_number: config.voice.retellFromNumber,
    to_number: toNumber,
    override_agent_id: config.voice.retellAgentId,
    // Retell requires every dynamic variable value to be a string.
    retell_llm_dynamic_variables: Object.fromEntries(
      Object.entries(variables ?? {}).map(([k, v]) => [k, String(v ?? "")]),
    ),
    metadata: metadata ?? {},
  };
  if (idempotencyKey) payload.idempotency_key = idempotencyKey;

  const result = await request("/v2/create-phone-call", { method: "POST", body: payload });
  logger.info("retell call created", { call_id: result?.call_id, status: result?.call_status });
  return result;
}

/**
 * Fetches a call, including the artefacts the assignment asks to submit.
 * recording_url, public_log_url and transcript are only populated after the call ends.
 */
export async function getCall(callId) {
  const call = await request(`/v2/get-call/${encodeURIComponent(callId)}`);
  return {
    callId: call?.call_id ?? callId,
    status: call?.call_status ?? null,
    durationMs: call?.duration_ms ?? null,
    disconnectionReason: call?.disconnection_reason ?? null,
    transcript: call?.transcript ?? null,
    transcriptObject: call?.transcript_object ?? null,
    recordingUrl: call?.recording_url ?? null,
    publicLogUrl: call?.public_log_url ?? null,
    raw: call,
  };
}

/**
 * Verifies a webhook signature.
 *
 * Retell documents verification through their SDK's `Retell.verify(rawBody, apiKey,
 * signature)`. The SDK is imported lazily and treated as optional: hand-rolling the HMAC
 * construction would mean guessing at the exact signing payload, and a verifier that is
 * subtly wrong is worse than one that reports it cannot run.
 *
 * @param {string} rawBody  the exact bytes received, never a re-serialised object
 * @returns {Promise<{verified: boolean, reason: string|null}>}
 */
export async function verifyWebhookSignature(rawBody, signature) {
  if (!signature) return { verified: false, reason: "missing_signature" };
  if (!config.voice.retellApiKey) return { verified: false, reason: "no_api_key_configured" };

  try {
    const { Retell } = await import("retell-sdk");
    const ok = Retell.verify(rawBody, config.voice.retellApiKey, signature);
    return { verified: Boolean(ok), reason: ok ? null : "signature_mismatch" };
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" || /Cannot find (module|package)/.test(error?.message ?? "")) {
      logger.warn("retell-sdk not installed; webhook signatures cannot be verified");
      return { verified: false, reason: "sdk_not_installed" };
    }
    logger.error("retell signature verification failed", { message: error?.message });
    return { verified: false, reason: "verification_error" };
  }
}

export { RetellError };
