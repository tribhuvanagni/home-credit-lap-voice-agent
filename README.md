# Project 1 — Conversational AI Workbench

An AI voice agent for Home Credit's **Loan Against Property** offer (up to ₹75,00,000). It
calls an existing customer, verifies who it is speaking to, presents the offer, works
through seven eligibility questions, and either hands the lead to a senior loan expert,
routes it to a transfer specialist, or closes the call politely.

Around that agent sits a **workbench**: a UI for running calls, replaying scenarios, and
inspecting exactly why the engine decided what it decided.

> Project 2 solves the same specification with a different product and a different
> architecture. Neither imports the other, and neither is needed to run this one.

---

## 1. Running it

```bash
cd project-1/backend
npm install
npm start
```

Open **http://localhost:8080**. The frontend is served by the backend, so there is one
process, no build step, and no CORS setup.

```bash
npm test       # 76 tests, offline and deterministic
npm run lint   # parses every source and test file
```

**No API keys are needed.** Without them the app runs a local text simulation against the
real qualification engine, and the header says so.

### Optional configuration

```bash
cp .env.example .env
```

| Variable | Effect when set |
|---|---|
| `ANTHROPIC_API_KEY` | Enables Claude structured extraction; falls back to rules on any failure |
| `ANTHROPIC_MODEL` | Defaults to `claude-opus-5-5` |
| `RETELL_API_KEY` + `RETELL_AGENT_ID` + `RETELL_FROM_NUMBER` | Switches the provider adapter to live mode |
| `LLM_DISABLED=1` | Forces rule-based extraction even with a key present |
| `PORT` | Defaults to `8080` |

---

## 2. What it does — the business rules

Seven checklist items, asked in order, never re-asked once answered:

| # | Item | Rule |
|---|---|---|
| 1 | Property type | Residential / commercial / industrial eligible · **agricultural disqualifies** |
| 2 | Ownership | Sole **and joint** both eligible |
| 3 | Documents | Originals available (incl. kept at home) eligible · photocopies or unavailable disqualify |
| 4 | Loan amount | ≤ ₹75,00,000 eligible (**inclusive**) · above it, the cap is offered — only an explicit decline ends the call |
| 5 | Occupation & income | Salaried or self-employed eligible · **cash income disqualifies** |
| 6 | Market value | Captured only — **no threshold**, because the assignment specifies none |
| 7 | Tenure | 3–15 years **inclusive** |

Around the checklist:

- **Verification gate** — the offer is never presented to an unconfirmed speaker.
- **Busy customer** — acknowledge, capture a callback time, end. No pitch.
- **Transfer switch** — an existing loan on the property, or an EMI-reduction request,
  routes to a loan-transfer specialist and stops the checklist. This *outranks*
  disqualification: it moves the customer to another team rather than rejecting them.
- **Immediate disqualification** — one failed rule ends qualification at once.
- **Handoff gate** — six conditions, all required.

---

## 3. The decision that shapes everything: the LLM decides nothing

The obvious build is a long prompt plus a model, letting it track state and apply rules. It
demos well and fails this assignment, which asks for exactness at boundaries: 3 and 15
years pass, 2 and 16 do not; exactly ₹75,00,000 passes.

A model gets those right *most of the time*, and a reviewer cannot tell a correct run from
a lucky one. So the split is strict:

```
utterance ──▶ [ NLU: model or rules ]  ──▶ validated facts
                                              │
                                              ▼
                              [ deterministic rule engine ]  ──▶ decision
                                              │
                                              ▼
                              [ templated copy ]  ──▶ what the agent says
```

- The model's only job is turning speech into a typed fact object.
- `engine/eligibility.js` holds every threshold as a pure function.
- Customer-facing copy is templated, so there is **no code path** that could produce an
  invented interest rate.

Consequences: the whole test suite runs offline with no API key, and no prompt edit can
silently move a threshold.

The prompt in `prompts/system_prompt.md` is still written as a complete standalone spec,
because the assignment's graded deliverable *is* the prompt — it has to work pasted into
Retell with no backend at all. The backend is the verifiable implementation of the same
rules.

---

## 4. How one customer turn flows through the code

Worth reading once; it explains most of the file layout.

```
POST /api/calls/:id/turn   { utterance: "It's a residential flat, jointly owned" }
   │
   ├─ routes/calls.js          validate the body, load the call, nothing else
   │
   ├─ engine/turn.js           THE ORCHESTRATOR — 7 ordered steps:
   │    1. terminal guard      a concluded call cannot reopen
   │    2. extract facts  ───▶ nlu/index.js
   │    │                        ├─ nlu/rules.js    always runs (deterministic)
   │    │                        ├─ nlu/llm.js      runs if ANTHROPIC_API_KEY is set
   │    │                        └─ nlu/schema.js   validates; drops anything invalid
   │    3. resolve context     a bare "yes" means different things at different points
   │    4. apply facts    ───▶ engine/state.js      records corrections in answer_history
   │    5. evaluate rules ───▶ engine/eligibility.js
   │    6. find next item ───▶ eligibility.nextChecklistItem()
   │    7. compose reply  ───▶ engine/response.js   templated, bilingual
   │
   ├─ store/memory.js          append transcript + events, persist
   └─ response: state, checklist, handoff gate (with blocking reason), transcript, events
```

Routes stay thin because all of it lives in `turn.js`, which is why the engine is testable
without HTTP and why the same code serves the API, the scenario runner and a voice
provider.

---

## 5. Every file, and why it exists

### `backend/src/` — the engine

| File | Responsibility |
|---|---|
| `server.js` | Express wiring: JSON parsing (keeping the raw body for webhook signatures), routes, static frontend, one error handler. |
| `config.js` | All environment reading, validated at boot. Nothing else touches `process.env`, so a bad config fails once, loudly, with an actionable message. |
| `logger.js` | Structured JSON logs with secret redaction. Any key matching `api_key\|secret\|token\|…` is replaced, and free text is truncated so customer utterances aren't logged in full. |
| `scenarios.js` | 20 scripted test conversations written as natural speech, each with its expected outcome. The UI and the test suite both read from here, so they cannot drift apart. |

**`engine/` — deterministic business logic**

| File | Responsibility |
|---|---|
| `eligibility.js` | Every threshold and gate as pure functions: `evaluateDisqualification`, `canHandoff`, `nextChecklistItem`, `isChecklistComplete`. No I/O, no model output reaches it. This is the file a reviewer should read first. |
| `state.js` | State construction, fact application, evaluation. `applyFacts` records every field change in `answer_history`, so a self-correction is visible rather than silently overwritten. |
| `turn.js` | The orchestrator described above. Also holds `resolveContextualAnswer`, which decides what a bare "yes" means given where the call is. |
| `response.js` | All customer-facing copy, English and Hindi. Hindi verb forms are gendered, so `agent_gender` actually changes the grammar (`bol rahi hoon` vs `bol raha hoon`). |

**`nlu/` — understanding**

| File | Responsibility |
|---|---|
| `schema.js` | The fact contract and `validateFacts`, the single enforcement point. Unknown keys, wrong types and out-of-vocabulary enums are dropped. A confused model cannot invent an eligible answer. |
| `rules.js` | Deterministic extractor. Handles Indian units (lakh/crore), Hindi transliteration, and attributes rupee amounts **positionally** — see §6. |
| `llm.js` | Claude adapter using structured outputs with a strict JSON schema. Every failure mode (refusal, malformed JSON, rate limit, auth, connection) degrades to the rule extractor rather than breaking the call. |
| `index.js` | Picks a strategy and records which one ran, so every turn says how its facts were produced. |

**`rag/`, `provider/`, `routes/`, `store/`**

| File | Responsibility |
|---|---|
| `rag/knowledge.js` | Eight product facts with keyword scoring, plus `DEFERRED_TOPICS`. Interest rates and fees are **deliberately absent** — the senior expert provides them, so there is nothing to serve and the agent must defer. |
| `provider/adapter.js` | The only module the backend talks to for voice. Reports `live` / `simulation` / `unimplemented` plus a per-capability breakdown, so a simulated run is never mistaken for a real call. |
| `provider/retell.js` | Retell AI client written against their published v2 API. **Never executed against a live account** — see `docs/voice-platform-status.md`. |
| `routes/calls.js` | Call lifecycle. Validation and persistence only; no business rules. |
| `routes/meta.js` | Health, provider status, scenarios, the rulebook, prompt rendering, knowledge lookups. |
| `routes/webhooks.js` | Provider callbacks: signature-verified before trusted, idempotent so a duplicate delivery cannot repeat a terminal action. |
| `store/memory.js` | In-memory call store, bounded at 500 calls. Deliberate: a workbench is a single-process tool, and the store is isolated behind one module. |

### `frontend/` — no build step

| File | Contents |
|---|---|
| `index.html` | Four tabs: Workspace, Call history, Agent prompt, Knowledge & rules. |
| `styles.css` | Light theme, CSS custom properties, responsive at 1240px and 860px. |
| `app.js` | ES module. One `api()` wrapper so every endpoint surfaces errors identically. Renders only what the backend sends — no eligibility logic lives here. |

### `tests/`, `prompts/`, `docs/`

| Path | Contents |
|---|---|
| `tests/rules.test.js` | 46 tests: business rules and the state machine, turn by turn. |
| `tests/api.test.js` | 30 tests: validation, backend authority, webhook idempotency, knowledge grounding. |
| `tests/helpers/http.js` | Binds the real app to an ephemeral port and uses Node's `fetch`. Exercises the genuine HTTP stack, including the raw-body hook a request stub would bypass. |
| `prompts/system_prompt.md` | **The graded deliverable.** 20 sections, all 11 dynamic variables. |
| `docs/` | Six documents — see §9. |

---

## 6. Two implementation details worth knowing

**Positional amount attribution.** One sentence can hold two rupee figures:

> *"I need a loan of 40 lakhs, the property is worth 1 crore."*

Ordered regexes get this wrong — whichever pattern runs first claims both. Instead
`rules.js` records each figure's character offset and each cue word's offset, then assigns
by proximity, preferring a *preceding* cue because Indian English puts the cue first.
Figures nearest an income cue are discarded entirely: *"I earn ₹80,000 a month"* is neither
a loan request nor a valuation, and recording it as either corrupts the checklist.

**The terminal guard is step 1.** It sits in `turn.js` before extraction, not inside each
rule. The utterance is still appended to the transcript — the log must stay faithful to
what was said — but no fact is applied. Because it is first, any rule added later inherits
it, so "continuation after disqualification" cannot regress.

---

## 7. API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/calls` | Create a call (optionally with `scenarioId`) |
| `GET` | `/api/calls` | List calls with outcomes |
| `GET` | `/api/calls/:id` | Full view: state, checklist, gate, transcript, events |
| `POST` | `/api/calls/:id/turn` | Advance one customer utterance |
| `POST` | `/api/calls/:id/run-scenario` | Run a scripted scenario end to end |
| `GET` | `/api/scenarios` | Scenario definitions with expected outcomes |
| `GET` | `/api/rules` | The eligibility rules, so the UI holds no second copy |
| `GET` | `/api/prompt?language=` | System prompt rendered with live variables |
| `GET` | `/api/knowledge` · `POST /api/knowledge/query` | Knowledge base and retrieval inspector |
| `GET` | `/api/callbacks` | Callback requests — never auto-scheduled |
| `POST` | `/api/webhooks/retell` | Provider webhook, signature-verified and idempotent |
| `GET` | `/api/health` · `/api/provider` · `/api/webhooks/status` | Status |

The backend is authoritative for qualification. A client cannot set its own status, and a
test asserts that.

---

## 8. Status

| Deliverable | Status |
|---|---|
| System prompt | **Complete** |
| Working application | **Complete** — 76/76 tests passing, lint clean |
| **Live call recordings + transcripts** | **Complete** — 4 real calls, [`recordings/project-1/`](recordings/) |
| Retell adapter *code* | Written against the documented API, **never executed** |

Four real calls were placed through Retell AI covering the qualified handoff, immediate
disqualification, transfer routing and busy-customer branches.

The adapter in `src/provider/retell.js` is a separate matter: those calls were placed
through Retell's dashboard, so that code has still never hit a live endpoint.
`docs/voice-platform-status.md` says so plainly.

---

## 9. Documentation

| Document | Contents |
|---|---|
| `docs/requirements-summary.md` | The specification distilled from the assignment PDF, with eight genuine ambiguities documented rather than silently resolved |
| `docs/requirements-traceability.md` | Every requirement → implementation → verifying test |
| `docs/system-design.md` | Architecture, state machine, and the alternatives rejected |
| `docs/test-plan.md` | Strategy and all 35 required scenarios mapped |
| `docs/test-results.md` | Measured results, real transcripts, and what was *not* verified |
| `docs/implementation-notes.md` | Key decisions and the bugs that shaped the code |
| `docs/voice-platform-status.md` | What is integrated, what is not, how to finish it |
