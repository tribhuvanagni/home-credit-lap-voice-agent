// Provider webhook intake.
//
// Three properties are required of this endpoint:
//   * signature verification before the payload is trusted;
//   * idempotency, so a duplicate delivery cannot repeat a terminal action;
//   * no secrets in logs.
//
// Retell retries deliveries, so duplicates are expected, not exceptional.

import { Router } from "express";
import { verifyWebhookSignature } from "../provider/adapter.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { appendEvent, getCall, listCalls, markWebhookProcessed, saveCall } from "../store/memory.js";

export const router = Router();

/** Event types that carry call artefacts worth persisting. */
const HANDLED_EVENTS = new Set(["call_started", "call_ended", "call_analyzed"]);

/**
 * Builds the delivery key used for replay protection.
 *
 * Retell does not document a dedicated delivery id, so the key is the event type plus
 * the call id — the pair that identifies a logical delivery. Two genuinely distinct
 * deliveries never share both.
 */
function deliveryKey(event, call) {
  return `${event ?? "unknown"}:${call?.call_id ?? "unknown"}`;
}

/** Finds the local call record a provider callback refers to. */
function findLocalCall(call) {
  const localId = call?.metadata?.local_call_id;
  if (localId) return getCall(localId);
  return listCalls({ limit: 200 }).find((record) => record.provider.callId === call?.call_id) ?? null;
}

router.post("/retell", async (req, res) => {
  const signature = req.get("x-retell-signature");

  // express.json({ verify }) stashes the untouched bytes; re-serialising the parsed
  // object would change them and break verification.
  const rawBody = req.rawBody ?? "";

  const verification = await verifyWebhookSignature(rawBody, signature);
  if (!verification.verified) {
    // Without a configured key there is nothing to verify against. Rejecting is the
    // safe default: accepting unverified payloads would let anyone mutate call state.
    logger.warn("rejected retell webhook", { reason: verification.reason });
    return res.status(401).json({ error: "signature_verification_failed", reason: verification.reason });
  }

  const { event, call } = req.body ?? {};
  const key = deliveryKey(event, call);

  if (!markWebhookProcessed(key)) {
    // Already handled — acknowledge so the provider stops retrying, change nothing.
    logger.info("duplicate retell webhook ignored", { key });
    return res.json({ ok: true, deduplicated: true });
  }

  if (!HANDLED_EVENTS.has(event)) {
    return res.json({ ok: true, ignored: true, event: event ?? null });
  }

  const record = findLocalCall(call);
  if (!record) {
    logger.warn("retell webhook for unknown call", { call_id: call?.call_id });
    return res.status(202).json({ ok: true, matched: false });
  }

  record.provider = {
    ...record.provider,
    name: "retell",
    callId: call.call_id ?? record.provider.callId,
    status: call.call_status ?? record.provider.status,
    recordingUrl: call.recording_url ?? record.provider.recordingUrl,
    transcriptUrl: call.public_log_url ?? record.provider.transcriptUrl,
  };
  appendEvent(record, `provider_${event}`, {
    call_id: call.call_id ?? null,
    status: call.call_status ?? null,
    has_recording: Boolean(call.recording_url),
    disconnection_reason: call.disconnection_reason ?? null,
  });
  saveCall(record);

  logger.info("retell webhook processed", { event, callId: record.id });
  res.json({ ok: true, deduplicated: false, callId: record.id });
});

/** Reports whether webhook intake is actually usable, for the UI status panel. */
router.get("/status", (req, res) => {
  res.json({
    retell: {
      endpoint: "/api/webhooks/retell",
      signature_header: "x-retell-signature",
      verification_available: Boolean(config.voice.retellApiKey),
      note: config.voice.retellApiKey
        ? "Signature verification requires the retell-sdk package; see docs/voice-platform-status.md."
        : "No RETELL_API_KEY configured — all webhook deliveries are rejected.",
    },
  });
});
