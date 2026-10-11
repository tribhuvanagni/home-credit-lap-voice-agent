// In-memory call store.
//
// The workbench is a single-process testing tool, so an in-process map is the honest
// choice — a database would add setup cost without changing any behaviour the assignment
// asks for. The store is kept behind this module so swapping it later touches one file.
// (Project 2 makes the opposite choice deliberately; see its docs/system-design.md.)

import { randomUUID } from "node:crypto";
import { createInitialState } from "../engine/state.js";

/** @type {Map<string, object>} */
const calls = new Map();
/** Processed provider webhook ids, for idempotent delivery. */
const processedWebhooks = new Map();

const MAX_CALLS = 500; // bounded so a long testing session cannot grow without limit

export function createCall(callConfig) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const record = {
    id,
    config: { ...callConfig },
    state: createInitialState(callConfig),
    transcript: [],
    events: [],
    createdAt: now,
    updatedAt: now,
    scenarioId: callConfig.scenarioId ?? null,
    provider: { name: null, callId: null, recordingUrl: null, transcriptUrl: null, status: null },
  };
  calls.set(id, record);

  if (calls.size > MAX_CALLS) {
    const oldest = [...calls.keys()][0];
    calls.delete(oldest);
  }
  return record;
}

export function getCall(id) {
  return calls.get(id) ?? null;
}

export function listCalls({ limit = 100 } = {}) {
  return [...calls.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function saveCall(record) {
  record.updatedAt = new Date().toISOString();
  calls.set(record.id, record);
  return record;
}

export function appendTranscript(record, role, text, meta = {}) {
  const entry = { role, text, ts: new Date().toISOString(), ...meta };
  record.transcript.push(entry);
  return entry;
}

export function appendEvent(record, type, payload = {}) {
  const entry = { type, payload, ts: new Date().toISOString(), turn: record.state.turn ?? 0 };
  record.events.push(entry);
  return entry;
}

/**
 * Marks a webhook delivery as processed.
 * @returns {boolean} true if this is the first time the id has been seen.
 */
export function markWebhookProcessed(deliveryId) {
  if (processedWebhooks.has(deliveryId)) return false;
  processedWebhooks.set(deliveryId, Date.now());
  // Keep the dedupe window bounded; replay protection does not need unbounded history.
  if (processedWebhooks.size > 1000) {
    const oldest = [...processedWebhooks.keys()][0];
    processedWebhooks.delete(oldest);
  }
  return true;
}

/** Callback requests across all calls — surfaced in the dashboard, never auto-scheduled. */
export function listCallbackRequests() {
  return listCalls({ limit: MAX_CALLS })
    .filter((record) => record.state.callback_requested)
    .map((record) => ({
      callId: record.id,
      customer_name: record.state.customer_name,
      requested_time: record.state.callback_time,
      // There is no scheduling integration in this project, so this is always a request.
      scheduled: false,
      createdAt: record.createdAt,
    }));
}

export function summarise(record) {
  return {
    id: record.id,
    customer_name: record.state.customer_name,
    language: record.state.language_to_speak,
    status: record.state.qualification_status,
    termination_reason: record.state.termination_reason,
    disqualification_reason: record.state.disqualification_reason,
    handoff_status: record.state.handoff_status,
    turns: record.transcript.length,
    scenarioId: record.scenarioId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Test helper — clears all state between test files. */
export function clearAll() {
  calls.clear();
  processedWebhooks.clear();
}
