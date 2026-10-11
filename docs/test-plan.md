# Test Plan — Project 1

## Strategy

Three layers, each answering a different question.

| Layer | File | Question answered |
|---|---|---|
| Business rules & state machine | `tests/rules.test.js` | Does the engine apply the assignment's rules exactly, turn by turn? |
| HTTP API | `tests/api.test.js` | Is the API validated, consistently shaped, and authoritative over the client? |
| Manual end-to-end | `docs/test-results.md` § Manual verification | Does the UI actually drive the backend? |

**All automated tests run with `forceRules: true`.** The LLM is never called, so the suite
is deterministic, offline, and free. This is a deliberate boundary: a green suite proves
the *business rules* are correct and proves nothing about live voice behaviour. The LLM
path is covered by fault-injection tests of its validation boundary (scenario 30) rather
than by live calls.

## Reproduce

```bash
cd project-1/backend
npm install
npm test          # full suite
npm run lint      # parses every source and test file
```

## Required scenario coverage

The assignment's 35 cases, each mapped to the test that asserts it. Numbers match the
`describe` blocks in `tests/rules.test.js`; `api` prefixes refer to `tests/api.test.js`.

| # | Scenario | Test | Asserts |
|---|---|---|---|
| 1 | Fully eligible customer | 1 | `qualified`, all 7 items, handoff recorded |
| 2 | Agricultural property | 2 | `disqualified`, reason, later items never asked |
| 3 | Sole ownership | 3 | eligible, not disqualified |
| 4 | Joint ownership | 4 | eligible — the key trap |
| 5 | Original documents available | 5 | `available` from "at home" |
| 6 | Only photocopies | 6 | `photocopy_only` → disqualified |
| 7 | Documents unavailable | 7 | `unavailable` → disqualified |
| 8 | Loan below ₹75 lakh | 8 | eligible, no alternative opened |
| 9 | Loan exactly ₹75 lakh | 9 | eligible (inclusive boundary) |
| 10 | Above ₹75 lakh then accepted | 10 | `adjusted = 7500000`, checklist continues |
| 11 | Above ₹75 lakh then rejected | 11 | `declined` |
| 12 | Above-limit alternative pending | 12 | `pending`, handoff blocked, not accepted |
| 13 | Salaried with bank income | 13 | eligible |
| 14 | Self-employed with bank income | 14 | eligible |
| 15 | Cash income | 15 | `disqualified`, items 6–7 never asked |
| 16 | Tenure 2 years | 16 | `tenure_out_of_range` |
| 17 | Tenure 3 years | 17 | `qualified` (inclusive) |
| 18 | Tenure 15 years | 18 | `qualified` (inclusive) |
| 19 | Tenure 16 years | 19 | `tenure_out_of_range` |
| 20 | Existing property loan | 20 | `transfer`, checklist untouched |
| 21 | EMI-reduction request | 21 | `transfer` |
| 22 | Busy customer, callback | 22 | time captured, `callback`, no offer pitched |
| 23 | Multiple answers out of order | 23 | 3 facts from 1 utterance, correct next question |
| 24 | Customer corrects an answer | 24 | latest value wins, audit trail, no stale disqualification |
| 25 | Interrupts with a product question | 25 | defers, no `%` in reply, bridges back |
| 26 | Missing interest-rate information | 26 | always deferred, even with a knowledge base |
| 27 | Missing RAG context | 27 | admits ignorance instead of inventing |
| 28 | Ambiguous document availability | 28 | no value recorded, not disqualified |
| 29 | Unverified customer | 29 | gate holds; wrong person → no offer disclosed |
| 30 | Malformed LLM extraction output | 30 | invalid fields dropped; missing ≠ eligible |
| 31 | Repeated webhook delivery | api 31 | unsigned rejected; duplicate deduplicated |
| 32 | Attempted premature handoff | 32 | blocked with reason, at 6/7 items and unverified |
| 33 | Continuation after disqualification | 33 | utterances ignored, state frozen (also for transfer) |
| 34 | History with answered questions | 34 | item asked exactly once, never re-asked across a diversion |
| 35 | Hindi and English configurations | 35 | Hindi call qualifies; gendered forms correct both ways |

### Additional cases beyond the required list

| Scenario | Test | Why it matters |
|---|---|---|
| Modest market value still qualifies | "Market value has no invented threshold" | Guards against inventing a minimum |
| Monthly income is not a loan amount | "Amount attribution" | The most likely extraction bug |
| Two amounts in one sentence | "Amount attribution" | Positional attribution correctness |
| Customer refuses to continue | "Refusal" | No pressure, immediate close |
| Busy without a stated time | 22 (second case) | Agent asks for the time |
| Correction removing a disqualification | 24 (second case) | A superseded answer must not disqualify |
| Gendered Hindi greeting | 35 | `agent_gender` is strict |
| Client cannot forge status | api lifecycle | Backend authority |
| Request validation (8 cases) | api validation | Language, gender, name, utterance, length, 404s, scenario id |
| Prompt renders all 11 variables | api lifecycle | Deliverable correctness |
| Knowledge base contains no rates | api knowledge | Cannot fabricate what is not there |
| Callback marked not scheduled | api callbacks | Honest reporting of a missing integration |
| Scenario runner stops at terminal | api scenario runner | Script cannot push past a closed call |

## Explicitly not covered by automated tests

| Area | Why | How it is handled instead |
|---|---|---|
| Live Retell call, recording, public log | No platform credentials in this workspace | `docs/voice-platform-status.md` states it plainly; never claimed as passing |
| Real Claude extraction quality | No API key; live calls cost money and are non-deterministic | Validation boundary tested with fault injection (30); manual procedure documented |
| Real webhook signature verification | Requires a Retell key and the optional SDK | Rejection path and idempotency are tested; verification gap is reported |
| Browser rendering across engines | No browser automation available here | Manual verification log with the exact steps run |
| Load / concurrency | Out of scope at this scale | — |

## Pass criteria

1. Every one of the 35 required scenarios has a passing assertion.
2. `npm run lint` parses all files.
3. No test asserts a live-platform capability that is not configured.
4. Any failing or blocked check appears in `docs/test-results.md` with its reason.
