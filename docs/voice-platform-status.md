# Voice Platform Status — Project 1

## Honest summary

| Deliverable | Status |
|---|---|
| Written system prompt | **Complete** — `prompts/system_prompt.md` |
| Qualification engine, API, UI, tests | **Complete and verified** — 76 automated tests passing |
| **Live call recordings + transcripts** | **Complete** — 4 real calls, see `recordings/` |
| Retell AI adapter *code* | **Written against the documented API, not executed** |
| Calls driven through the adapter code | **Not done** |
| Provider-hosted public share link | **Not available on the free trial** |

Four real calls were placed on 11 October 2026 through Retell AI's browser test call,
covering the qualified handoff, immediate disqualification, transfer routing and
busy-customer branches. Audio and full transcripts are committed in
`recordings/`, which satisfies the assignment's "audio + transcript"
requirement.

Two honest caveats:

1. **The adapter code was not the path used.** `src/provider/retell.js` implements
   outbound calling, transcript and recording retrieval against Retell's published API,
   but the calls above were placed through the dashboard. That code has still never
   received a real response.
2. **No provider-hosted public link.** Retell's free trial exposes no "share this call"
   URL, so the artefacts are committed to this repository instead of linked. They are the
   same files, downloaded from Retell.

A phone number was deliberately not purchased: Retell's documentation states that numbers
bought from Retell can only dial US destinations, which rules out an Indian test number.
The browser test call produces the same recording, transcript and call log.

## What is implemented

`backend/src/provider/retell.js`, written against Retell's published API reference:

| Capability | Endpoint / mechanism | Code |
|---|---|---|
| Outbound call | `POST https://api.retellai.com/v2/create-phone-call` | `createPhoneCall()` |
| Dynamic prompt variables | `retell_llm_dynamic_variables` | `createPhoneCall()` |
| Duplicate-dial protection | `idempotency_key` | `createPhoneCall()` |
| Call retrieval | `GET /v2/get-call/{call_id}` | `getCall()` |
| Transcript | `transcript`, `transcript_object` | `getCall()` |
| Recording | `recording_url` | `getCall()` |
| Public call log | `public_log_url` | `getCall()` |
| Webhook intake | `POST /api/webhooks/retell` | `routes/webhooks.js` |
| Signature verification | `x-retell-signature` via `Retell.verify` | `verifyWebhookSignature()` |
| Replay protection | event + call id dedupe | `markWebhookProcessed()` |

Auth is `Authorization: Bearer <RETELL_API_KEY>`.

### Two caveats stated plainly

1. **Unexecuted.** No request in this file has ever received a real Retell response. The
   endpoints and field names are correct per the reference, but a mismatch would only
   surface on first live use.
2. **Signature verification needs the optional SDK.** `verifyWebhookSignature` lazily
   imports `retell-sdk` and uses `Retell.verify`. Hand-rolling the HMAC would mean guessing
   the signing payload, and a verifier that is subtly wrong is more dangerous than one that
   refuses to run — so without the SDK the endpoint rejects every delivery with
   `sdk_not_installed`. Install it with `npm install retell-sdk` before going live.

## Manual steps to produce the missing deliverables

These are the steps only an account holder can perform.

### 1. Create the agent

1. Sign up at <https://dashboard.retellai.com> (free trial).
2. **Agents → Create agent**, single-prompt type.
3. Paste the entire contents of `prompts/system_prompt.md` into the agent instructions.
4. Choose a professional Indian-English voice (or Hindi, matching `language_to_speak`).
   Keep the voice gender consistent with `agent_gender` — the prompt enforces gendered
   grammar and a mismatch will sound wrong.
5. Under **Dynamic variables**, declare each of:
   `company_name`, `customer_name`, `agent_name`, `agent_gender`, `current_date`,
   `current_day`, `current_time`, `additional_context_from_rag`, `language_to_speak`.
   `conversation_history` and `customer_utterance` are supplied by the platform per turn.
6. Copy the agent id.

### 2. Provision a number

**Phone numbers → Buy number** (or import a number), then copy it in E.164 form
(e.g. `+14155550123`).

### 3. Configure this project

```bash
cd project-1
cp .env.example .env
```

Fill in:

```
RETELL_API_KEY=key_xxxxxxxx
RETELL_AGENT_ID=agent_xxxxxxxx
RETELL_FROM_NUMBER=+1XXXXXXXXXX
```

Then install the optional SDK and restart:

```bash
cd backend && npm install retell-sdk && npm start
```

Confirm `GET /api/provider` now reports `"mode": "live"`. The UI header pill turns green.

### 4. Point the webhook at this server

Retell needs a publicly reachable URL. For local testing:

```bash
npx localtunnel --port 8080      # or ngrok http 8080
```

In the Retell dashboard set the agent webhook URL to
`https://<your-tunnel>/api/webhooks/retell` and subscribe to `call_started`,
`call_ended`, `call_analyzed`.

### 5. Run the test calls

Place calls to **your own number**, acting as a real customer. Use the scripted scenarios
in `backend/src/scenarios.js` — they are written as natural speech and already cover the
graded edge cases. At minimum run:

| Call | Scenario | Proves |
|---|---|---|
| 1 | `eligible_full` | happy path through all 7 items and handoff |
| 2 | `agricultural` | immediate disqualification |
| 3 | `amount_above_accept` | ₹75 lakh cap negotiation |
| 4 | `existing_loan` | transfer routing |
| 5 | `busy_callback` | busy handling |
| 6 | `out_of_order` + `correction` | multi-fact capture and self-correction |
| 7 | `hindi_eligible` | configured language and gender |

Use synthetic customer identities only. Do not use real customer data in artefacts that
will be shared publicly.

### 6. Collect the submission artefacts

For each call, from **Call history** in the dashboard or via the API:

```bash
curl -H "Authorization: Bearer $RETELL_API_KEY" \
  https://api.retellai.com/v2/get-call/<call_id>
```

Record `recording_url`, `public_log_url`, and `transcript`. Then:

1. Enable public sharing on the calls (Retell dashboard → call → share).
2. Paste the links into `docs/submission.md` under "Recording & call log links".
3. Save the transcripts into `docs/transcripts/` as `call-<n>-<scenario>.md`.

Note: Retell's own `recording_url` is short-lived (the docs state roughly 10 minutes for
the direct link), so download the audio and host it, or use the dashboard's share link for
anything that needs to stay reachable.

## If Bolna is used instead

`providerInfo()` reports `mode: "unimplemented"` when `BOLNA_API_KEY` is set, because only
the Retell adapter exists. Implementing `src/provider/bolna.js` against Bolna's documented
API and registering it in `adapter.js` is the whole change — the engine needs no edit.
Reporting an unimplemented provider as unavailable is intentional; a key alone is not an
integration.
