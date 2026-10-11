# System Design — Project 1: Conversational AI Workbench

## 1. What this project is

A workbench for building, running and reviewing LAP qualification calls. The audience is
an AI engineering or operations team: the primary workflow is *pick a scenario or
configuration → run the conversation → inspect why the engine decided what it decided*.

That audience choice drives the architecture. The product's value is **explainability**, so
the backend exposes not just an outcome but the checklist state, the handoff gate with its
blocking reason, the rule that fired, the extraction source for each turn, and an audit
trail of corrections.

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ frontend/  (static, no build step, served by the backend)      │
│   Workspace · Call history · Agent prompt · Knowledge & rules  │
└───────────────────────────┬────────────────────────────────────┘
                            │ fetch /api/*  (backend is authoritative)
┌───────────────────────────▼────────────────────────────────────┐
│ routes/            calls.js · meta.js · webhooks.js            │
│                    validation + persistence only, no rules     │
├────────────────────────────────────────────────────────────────┤
│ engine/turn.js     ORCHESTRATOR — the 7-step decision sequence │
│   ┌──────────────┬───────────────┬──────────────────────────┐  │
│   │ nlu/         │ engine/state  │ engine/eligibility       │  │
│   │ understanding│ pure reducers │ deterministic rules      │  │
│   └──────────────┴───────────────┴──────────────────────────┘  │
│ engine/response.js  templated bilingual copy                   │
├────────────────────────────────────────────────────────────────┤
│ rag/knowledge.js   grounded answers + deferral topics          │
│ provider/          adapter.js → retell.js  (vendor isolated)   │
│ store/memory.js    calls, transcripts, events, idempotency     │
└────────────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Owns | Must not |
|---|---|---|
| `routes/` | HTTP shape, validation, persistence | contain a business rule |
| `engine/turn.js` | decision order, context resolution | perform I/O beyond extraction |
| `nlu/` | utterance → validated facts | decide eligibility |
| `engine/eligibility.js` | thresholds, gates, next-item selection | know about HTTP or the LLM |
| `engine/state.js` | state construction and transitions | perform I/O |
| `engine/response.js` | customer-facing wording | invent product facts |
| `rag/` | grounded knowledge, explicit deferrals | override a rule |
| `provider/` | vendor API surface | leak into the engine |
| `store/` | persistence, replay protection | hold rules |

## 3. The central design decision: deterministic rules, probabilistic understanding

The assignment is a compliance-sensitive outbound call. A model that "usually" applies the
tenure rule is not acceptable, so the split is strict:

- **The LLM decides nothing.** It converts speech into a fact object and stops.
- **Application code decides everything.** `evaluateDisqualification`, `canHandoff` and
  `nextChecklistItem` are pure functions over typed state.
- **Customer-facing copy is templated.** There is no code path that would let the agent
  generate a sentence containing an interest rate, so it cannot invent one.

Consequences:

| Benefit | Cost |
|---|---|
| Qualification is reproducible and unit-testable offline | Copy is less varied than generated text |
| No prompt change can alter an eligibility threshold | Each new phrasing needs a template |
| The suite runs with no API key and no network | Natural-language coverage depends on the rule extractor when no key is set |

## 4. Understanding layer

`nlu/index.js` chooses a strategy and records which one ran:

```
extractFacts()
  ├─ always: extractWithRules()        deterministic, offline
  ├─ if ANTHROPIC_API_KEY: extractWithLLM()  structured output, strict JSON schema
  └─ merge(llm over rules) → validateFacts() → typed facts
```

- Claude is called with `output_config.format = { type: "json_schema", … }` and
  `effort: "low"` — extraction is a shallow task, so low effort keeps latency and cost down.
- Every failure mode degrades rather than breaks: refusal, malformed JSON, rate limit,
  auth error and connection error each fall back to the rule extractor and set
  `degraded: true`, which the UI surfaces.
- `validateFacts` is the single enforcement point. Unknown keys, wrong types and
  out-of-vocabulary enum values are dropped, so a confused model cannot invent
  `property_type: "residential"` out of nothing or push an out-of-range amount through.

### Amount attribution

The hardest extraction problem is that one sentence can hold two rupee figures with
different meanings. Keyword-order matching gets this wrong. Instead `rules.js` finds every
figure with its character offset, finds every "worth"/"loan"/"earn" cue with its offset,
and assigns each figure to the nearest cue (preferring a preceding cue, since Indian
English puts the cue first). Figures nearest an income cue are discarded entirely —
"I earn ₹80,000 a month" is neither a loan request nor a valuation. A figure with no cue
in range becomes `ambiguous_amount` and is placed against whichever question is pending.

## 5. State machine

```
                    ┌─────────────┐
      start ───────▶│ unverified  │
                    └──────┬──────┘
         not intended ◀────┤────▶ busy ──────────▶ ● callback
                 ●         │
                      confirms identity
                           ▼
                    ┌─────────────┐
                    │ offer shown │◀──── diversion (answer + return)
                    └──────┬──────┘
                           ▼
            ┌──────────────────────────────┐
            │ checklist 1..7, earliest     │──── transfer intent ──▶ ● transfer
            │ unanswered item              │──── failed rule ──────▶ ● disqualified
            └──────────────┬───────────────┘──── refusal ──────────▶ ● declined
                           │
                 amount > ₹75L ──▶ [pending alternative] ──declines──▶ ● declined
                           │                    │accepts
                           ▼◀───────────────────┘
                    handoff gate (6 conditions)
                           ▼
                      ● qualified
```

`●` marks terminal states. `turn.js` refuses to transition out of one: the utterance is
still appended to the transcript for the audit trail, but no fact is applied and no
question is asked. That is what makes "continuation after disqualification" structurally
impossible rather than merely unlikely.

Precedence between simultaneously-applicable terminals is fixed and documented in
`shared-requirements/requirements-summary.md` §5.1.

## 6. Data model

A call record holds:

```
{ id, config, state, transcript[], events[], provider{}, createdAt, updatedAt, scenarioId }
```

- `state` — the full qualification state, including `answer_history` (append-only record of
  field changes, so a correction is visible rather than silently overwritten).
- `transcript[]` — `{ role, text, ts, … }`, the faithful log of what was said, including
  utterances received after the call concluded.
- `events[]` — `call_created`, `facts_extracted`, `status_changed`, `provider_*`. This is
  what the UI's event history and the decision explanation are built from.

### Why in-memory

The workbench is a single-process testing tool. A database would add setup cost for a
reviewer without changing any behaviour the assignment asks for, and the store is already
isolated behind `store/memory.js` so it could be swapped in one file. Project 2 makes the
opposite choice deliberately — it persists to SQLite because its product is regression
history, which has to survive a restart.

Bounded growth: the store keeps at most 500 calls and 1000 webhook keys, so a long session
cannot grow without limit.

## 7. Voice provider integration

`provider/adapter.js` is the only module the rest of the backend talks to. It reports a
`mode` of `live`, `simulation` or `unimplemented` plus a per-capability breakdown, and the
UI renders that in the header — so a simulated run is never mistaken for a real call.

`provider/retell.js` targets Retell's documented v2 API (`/v2/create-phone-call`,
`/v2/get-call/{call_id}`, bearer auth, `x-retell-signature`). Three details matter:

- The assignment's dynamic variables are passed through `retell_llm_dynamic_variables`,
  Retell's documented injection mechanism, so the variable names are used unchanged.
- `idempotency_key` is sent on call creation, so a retried request cannot dial a customer
  twice.
- `public_log_url` is captured because it is exactly the "public link to call logs" the
  assignment asks to submit.

Webhook signature verification delegates to the official `retell-sdk` `Retell.verify`,
imported lazily as an optional dependency. Hand-rolling the HMAC would mean guessing the
signing payload, and a verifier that is subtly wrong is worse than one that reports it
cannot run — so when the SDK is absent the endpoint rejects with `sdk_not_installed`
rather than accepting unverified input.

**This code has not been exercised against a live Retell account.** See
`docs/voice-platform-status.md`.

## 8. Error handling and failure modes

| Failure | Behaviour |
|---|---|
| LLM unavailable / malformed / refused | fall back to rule extraction, flag `degraded`, continue the call |
| Extraction returns nothing usable | `unclear` → agent asks for a repeat, re-asks the pending question |
| Invalid request body | `400` with `{ error, problems[{field, message}] }` |
| Unknown call or route | `404` with a stable error code |
| Unhandled exception | single error handler; message suppressed in production |
| Unsigned or duplicate webhook | `401` / acknowledged-and-ignored, never a repeated side effect |
| Missing provider credentials | simulation mode, stated explicitly in the API and the UI |

## 9. Security and privacy

- Secrets come from the environment only; `.env.example` holds placeholders.
- `logger.js` redacts any key matching `api_key|secret|token|authorization|password` and
  truncates free text to 200 characters, so customer utterances are not logged in full.
- Webhook payloads are verified before they can mutate state.
- Only the fields the checklist needs are stored — no account numbers, no PAN, no DOB, and
  the agent is prompted never to request them.
- Test identities are synthetic ("Rahul Sharma").

## 10. Rejected alternatives

| Option | Why not |
|---|---|
| LLM decides eligibility from the prompt alone | Not reproducible, not testable, and one prompt edit could silently change a threshold. The assignment demands exactness. |
| Generate agent replies with the LLM | Opens a path to fabricated rates and fees, the exact failure the assignment warns about. |
| React/Vite frontend | Adds a build step and a toolchain for a UI that has one real view. Static files are served by the same origin, so a reviewer runs one command. |
| Vector database for RAG | Eight short facts. Embeddings would add infrastructure and latency with no recall gain. |
| Microservices | Nothing here needs independent scaling or deployment. |
| Hand-rolled webhook HMAC | Guessing the signing construction risks a verifier that silently accepts bad input. |
