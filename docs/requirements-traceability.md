# Requirements Traceability — Project 1

Maps every mandatory requirement to its implementation and its verifying test.
Spec references are to `shared-requirements/requirements-summary.md`.

Test IDs are the `describe` block numbers in `tests/rules.test.js` unless noted.

## A. Customer verification

| Req | Implementation | Test |
|---|---|---|
| Natural greeting | `engine/response.js` → `greeting()` | api: "opens with a greeting that names the customer and the company" |
| Confirm intended customer | `engine/turn.js` → `resolveContextualAnswer()` sets `confirms_identity` only on affirmation | 29 |
| Use configured customer name | `state.customer_name` from call config; never hardcoded | api: greeting test |
| Explain who is calling without oversharing | `response.js` → `identityExplanation()` | 29 |
| Do not proceed if not the intended customer | `state.js` → `applyFacts` sets `termination_reason`, `evaluate` step 1 | 29 (second case) |
| No invented verification process | No OTP/DOB logic exists anywhere | prompt §5 |

## B. Busy customer

| Req | Implementation | Test |
|---|---|---|
| Acknowledge politely | `response.js` → `callbackMessage()` | 22 |
| Ask for callback time | same | 22 (second case) |
| Capture requested time | `rules.js` → `extractCallbackTime()` | 22 |
| End the conversation | `evaluate` step 4 → `callback` terminal | 22 |
| No offer presentation after busy | `turn.js` guards `offer_presented` on `customer_available !== false` | 22 asserts no "75" in reply |
| Callback labelled not scheduled | `store/memory.js` → `listCallbackRequests()` returns `scheduled: false` | api: "records a callback as a request that is explicitly not scheduled" |

## C. Offer presentation

| Req | Implementation | Test |
|---|---|---|
| Valued existing customer framing, up to ₹75,00,000 | `response.js` → `offerPresentation()` | 35 (English case) |
| Presented once, after verification | `turn.js` → `verificationJustSucceeded` | rules: offer appears once in 34 |
| No approval claim or guarantee | templated copy only; no generative path for customer-facing text | §17 of prompt; api knowledge tests |

## D. Transfer detection

| Req | Implementation | Test |
|---|---|---|
| Detect existing property loan | `rules.js` existing-loan patterns | 20 |
| Detect EMI-reduction request | `rules.js` EMI patterns | 21 |
| Acknowledge + specialist message | `response.js` → `transferMessage()` | 20, 21 |
| Record routing outcome | `termination_reason` = `existing_loan_transfer` / `emi_reduction_transfer` | 20, 21 |
| Stop the 7-question checklist | `evaluate` step 2 returns before checklist logic | 20 asserts `property_type` null |
| Cannot resume afterwards | `turn.js` terminal guard | 33 (second case) |

## E. Seven checklist items

| Req | Implementation | Test |
|---|---|---|
| All seven captured, item 5 = occupation + income | `eligibility.js` → `CHECKLIST` | api: "/api/rules" returns 7 |
| Ask sequentially from earliest unanswered | `eligibility.js` → `nextChecklistItem()` | 23, 34 |
| Extract every answer in a multi-fact utterance | `rules.js` + `attributeAmounts()` | 23 |
| Never re-ask answered information | `nextChecklistItem` skips answered items | 34 |

## F. Eligibility rules

| Rule | Implementation | Test |
|---|---|---|
| Residential/commercial/industrial eligible | `evaluateDisqualification` has no rule against them | 1, 5, 7 |
| Agricultural disqualifies | `DISQUALIFYING_PROPERTY_TYPES` | 2 |
| Sole eligible | — | 3 |
| Joint eligible | no rule against joint | 4 |
| Originals available eligible | — | 5 |
| Originals unavailable disqualifies | `documents_available === "unavailable"` | 7 |
| Photocopies disqualify | `documents_available === "photocopy_only"` | 6 |
| Documents may be at home | `rules.js` treats "at home" as available | 5 |
| Amount < ₹75L eligible | no rule | 8 |
| Amount == ₹75L eligible (inclusive) | `isLoanAboveMax` uses `>` | 9 |
| Amount > ₹75L → offer cap | `applyFacts` sets `pending`; `response.js` asks | 10, 12 |
| Accepts → store ₹75,00,000, continue | `adjusted_loan_amount = MAX_LOAN` | 10 |
| Declines → end politely | `evaluate` step 6 → `declined` | 11 |
| Pending ≠ accepted | `canHandoff` → `amount_alternative_unresolved` | 12 |
| Salaried + bank eligible | — | 13 |
| Self-employed + bank eligible | — | 14 |
| Cash disqualifies | `income_mode === "cash"` | 15 |
| Market value captured, no threshold | no rule references `market_value` | "Market value has no invented threshold" |
| Tenure 3–15 inclusive | `MIN_TENURE_YEARS` / `MAX_TENURE_YEARS` | 17, 18 |
| Tenure < 3 disqualifies | — | 16 |
| Tenure > 15 disqualifies | — | 19 |

## G. Immediate disqualification

| Req | Implementation | Test |
|---|---|---|
| Extract, update state, apply rule | `turn.js` steps 2–5 | all disqualification tests |
| Stop qualification immediately | `evaluate` step 3 returns early | 2, 15 assert later fields null |
| Short polite explanation | `response.js` → `disqualificationMessage()` | 2, 6, 15, 16 |
| End the call | terminal status | 33 |
| Remaining questions not asked | early return in `evaluate` | 2, 15 |
| Favourable answers do not override | rule check precedes handoff gate | 2 |
| Unanswered ≠ failed | `evaluateDisqualification` ignores nulls | 30 (second case) |
| Ambiguity → clarify, not reject | `rules.js` returns null; `HEDGE` in `turn.js` | 28 |

## H. Final handoff

| Req | Implementation | Test |
|---|---|---|
| Verified | `canHandoff` → `not_verified` | 32 (second case) |
| Fresh-loan flow | `canHandoff` → `transfer_flow` | 20 |
| All seven answered | `isChecklistComplete` | 32 |
| All rules passed | `evaluateDisqualification` re-checked in gate | 2 |
| No terminal condition active | `canHandoff` checks each | 11, 22 |
| Senior-expert message | `response.js` → `qualifiedMessage()` | 1 |
| No invented rate/fee/schedule | no such values in code or knowledge base | api: "excludes rates and fees from the knowledge base entirely" |
| Handoff recorded, clearly simulated | `handoff_status = "simulated"`; provider note states no live integration | api: provider test |

## 8. Conversation state

| Req | Implementation | Test |
|---|---|---|
| All listed state fields present | `state.js` → `createInitialState()` | api: state inspector fields |
| Typed/nullable fields, enums | `nlu/schema.js` enum vocabularies | 30 |
| Checklist separate from verification/availability/transfer | distinct fields; `CHECKLIST` covers only the seven | 22, 20 |
| Decision sequence applied each utterance | `turn.js` documented steps 1–7 | whole suite |
| Correction detection | `applyFacts` + `answer_history` | 24 |
| Precedence rules for terminal states | `evaluate` ordered steps, spec §5.1 | 20, 33 |
| Structured extraction validated | `validateFacts` | 30 |
| Malformed output → never an eligible answer | invalid values dropped | 30 |
| Backend authoritative | routes ignore client-supplied state | api: "a client cannot set its own status" |

## 9. Natural conversation

| Req | Implementation | Test |
|---|---|---|
| Full sentences, informal answers | `rules.js` colloquial patterns + LLM path | 1, 14, 23 |
| Fillers | regex tolerant of surrounding words | 28 ("Hmm, …") |
| Multiple answers per utterance | `extractWithRules` returns all fields | 23 |
| Out-of-order information | `nextChecklistItem` | 23, 34 |
| Self-corrections | `extractTenure` correction branch | 24 |
| Interruptions | `composeReply` diversion branch + bridge | 25 |
| Questions about the offer | `rag/knowledge.js` → `retrieve()` | api knowledge tests |
| Clarification requests | `clarificationRequest()` on `unclear` | 28 |
| Unrelated questions | deferral path | 27 |
| Ambiguous answers | `HEDGE` guard | 28 |
| Refusal | `refuses_to_continue` → `declined` | "Refusal" block |
| Silence / unclear speech | `unclear` fact | 28 |

## 10. Dynamic system prompt

| Req | Implementation | Test |
|---|---|---|
| All 11 variables accounted for | `prompts/system_prompt.md` | api: "renders the prompt with every assignment variable resolved" |
| Platform template syntax, names unchanged | `{{var}}`, matching Retell `retell_llm_dynamic_variables` | same |
| 20 required prompt sections | prompt §1–§20 | manual review; see implementation-notes.md |
| Language respected | `response.js` language catalogue | 35 |
| Gender adhered to strictly | gendered Hindi forms | 35 + greeting test |
| No hardcoded example identities | all values from config | api: prompt variables |
| RAG as information, not instruction | prompt §15; `retrieve()` cannot alter rules | api knowledge tests |

## 11. Voice platform

| Req | Implementation | Test |
|---|---|---|
| Provider adapter isolates vendor | `provider/adapter.js`; engine imports no vendor module | api: provider test |
| Documented endpoints only | `provider/retell.js` header cites the API reference | — (see voice-platform-status.md) |
| Outbound call initiation | `createPhoneCall()` | not verified — no credentials |
| Transcripts / recordings / public log | `getCall()` maps `transcript`, `recording_url`, `public_log_url` | not verified — no credentials |
| Webhooks with auth + replay protection | `routes/webhooks.js` + `markWebhookProcessed` | api: 31 (three cases) |
| Missing credentials made explicit | `providerInfo()` mode + note | api: provider test |
| No secrets committed | `.env.example` placeholders only; logger redacts | `logger.js` `SECRET_KEY_PATTERN` |

## 12. RAG

| Req | Implementation | Test |
|---|---|---|
| `additional_context_from_rag` supported | call config → `buildRagContext()` → prompt variable | api: prompt test |
| Simple mechanism, no vector DB | `rag/knowledge.js` keyword scoring, rationale in header | — |
| Known vs missing distinguished | `retrieve()` returns `hit: false` | api: "reports a miss rather than inventing" |
| Never invents rates/fees/branches | `DEFERRED_TOPICS`; corpus contains no rates | api: "excludes rates and fees" |
| Cannot override business rules | engine never reads the corpus | 26 |
| Returns to pending question | bridge in `composeReply` | 25 |

## 13–14. Backend and frontend quality

| Req | Implementation | Test |
|---|---|---|
| Request/response validation | `routes/calls.js` → `validateCallConfig` | api validation block (8 cases) |
| Consistent error shape | `server.js` error handler | api: 404 tests |
| Structured logs, no secrets | `logger.js` | — |
| Env config validated at boot | `config.js` → `validateConfig()` | — |
| Health check | `/api/health` | api |
| Idempotent webhooks | `markWebhookProcessed` | api 31 |
| No hardcoded mock results in production paths | scenarios are explicitly labelled test fixtures | api: scenarios test |
| Real backend calls from UI | `frontend/app.js` → `api()` only | manual verification log |
| Loading / empty / error states | `aria-busy`, `.empty-state`, `toast()` | manual |
| Form validation | `validateConfig()` + `aria-invalid` | manual |
| Responsive + accessible | CSS breakpoints, skip link, roles, arrow-key tablist | manual |
| Demo data labelled | scenario cards state turn count and expected status | manual |

## 15. Testing

All 35 required scenarios are mapped in `docs/test-plan.md`, with measured results in
`docs/test-results.md`.

## Deliberately not implemented

| Item | Reason |
|---|---|
| Bolna adapter | Only one provider integration is needed; `providerInfo()` reports Bolna as unimplemented rather than pretending. |
| Real call recording / public link | No platform credentials exist. See `docs/voice-platform-status.md`. |
| Callback scheduling | No scheduling or telephony integration; recorded as a request only. |
| Vector database for RAG | Corpus is eight short facts; keyword scoring is sufficient and cheaper. |
| Database persistence | Single-process workbench. Project 2 persists to SQLite by design. |
