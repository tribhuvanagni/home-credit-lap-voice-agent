# Test Results — Project 1

Measured on **2026-10-11**, Windows 11, Node **v22.22.3**, npm **10.9.8**.
These are actual recorded outputs, not projections.

## Commands executed

```bash
cd project-1/backend
npm install        # 147 packages, ~15s
npm run lint       # static parse check
NODE_ENV=test npm test
```

## Automated results

| Suite | File | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| Business rules & state machine | `tests/rules.test.js` | 46 | 46 | 0 | 0 |
| HTTP API | `tests/api.test.js` | 30 | 30 | 0 | 0 |
| **Total** | | **76** | **76** | **0** | **0** |

```
 Test Files  2 passed (2)
      Tests  76 passed (76)
   Duration  1.24s
```

Lint:

```
> node --check src/server.js && node scripts/syntax-check.mjs
OK — 22 file(s) parsed cleanly.
```

All tests run with `forceRules: true` — the LLM is never called, so the suite is offline,
deterministic and free to run.

## Required scenario coverage

All 35 scenarios from the assignment have a passing assertion. The mapping is in
`docs/test-plan.md`. Summary by group:

| Group | Scenarios | Result |
|---|---|---|
| Eligibility rules (1–19) | 19 | all pass |
| Transfer & busy routing (20–22) | 3 | all pass |
| Conversation handling (23–28) | 6 | all pass |
| Gates & robustness (29–34) | 6 | all pass |
| Language & gender (35) | 1 (+1 extra) | all pass |

Boundary conditions confirmed explicitly: tenure 2 ✗ / 3 ✓ / 15 ✓ / 16 ✗; loan
₹74,99,999 ✓ / ₹75,00,000 ✓ / ₹90,00,000 → cap offer.

## Production build

There is no build step. The frontend is static HTML/CSS/ES modules served by the backend,
so "build" is a no-op by design — nothing to compile, nothing to break between
`npm install` and `npm start`. This is recorded rather than reported as a passing build.

## End-to-end verification (actual transcript)

Server started on port 8193. Static assets: `index.html` 200, `app.js` 200,
`styles.css` 200. `GET /api/health` → `{"ok":true,...,"provider":"simulation"}`.

A full call driven through `POST /api/calls/:id/turn`:

| # | Customer utterance | Agent reply (abridged) | Status / next item |
|---|---|---|---|
| 1 | "Yes, this is Rahul speaking." | offer presented + "what type of property…" | in_progress / property_type |
| 2 | "It's a residential house, jointly owned with my wife, worth around 1.2 crore." | "Do you have the original property documents…" | in_progress / documents_available |
| 3 | "Before that, what interest rate will I get?" | "The exact interest rate will be shared by our senior loan expert… Now, coming back to it — Do you have the original property documents…" | in_progress / documents_available |
| 4 | "Okay, the original papers are available at home." | "How much loan amount are you looking for?" | in_progress / requested_loan_amount |
| 5 | "I was hoping for 90 lakhs." | "This offer is available for up to ₹75 lakh. Would you like to proceed with the maximum…" | in_progress / amount_alternative |
| 6 | "Yes, let's go with 75 lakhs." | "Could you tell me your occupation…" | in_progress / occupation_income |
| 7 | "I run a small business, income comes to my bank account." | "And over how many years would you like to repay the loan?" | in_progress / tenure_years |
| 8 | "10 years, actually make that 12." | "…you meet the criteria for this offer of ₹75 lakh. A senior loan expert will contact you shortly…" | **qualified** / handoff |
| 9 | "Can we change it to 20 years?" | "This call has already concluded. Thank you for your time." | qualified (unchanged) |

What this demonstrates concretely:

- **Out-of-order multi-fact capture** — turn 2 supplied items 1, 2 and 6; neither ownership
  nor market value was ever asked again.
- **Diversion handling** — turn 3 deferred the rate with no figure invented, then bridged
  back to the same pending question.
- **Cap negotiation** — turn 5 offered ₹75 lakh rather than rejecting ₹90 lakh; turn 6
  accepted and the checklist continued.
- **Self-correction** — turn 8 used 12 years, not the superseded 10.
- **Terminal guard** — turn 9 was logged in the transcript but changed nothing.

Prompt rendering: `GET /api/prompt?language=Hindi` → `unresolved: []` with all **11**
assignment variables bound.


## Live call verification

Four real calls were placed through Retell AI on 11 October 2026 (voice: Willa, British
female; language: English (India)). Audio and full transcripts are in
`recordings/`.

| Call | Scenario | Outcome | Result |
|---|---|---|---|
| 1 | Fully eligible, all 7 items | qualified → senior loan expert handoff | ✅ |
| 2 | Agricultural property | disqualified at item 1, items 2-7 never asked | ✅ |
| 3 | Existing property loan | routed to loan-transfer specialist | ✅ |
| 4 | Busy customer | callback captured, offer never pitched | ✅ |

No agent turn invented an interest rate, fee or approval. No answered item was re-asked.
In Call 1 speech recognition garbled "fifty lakhs" to "fifty x" and the agent asked for a
repeat rather than guessing — the ambiguity rule working on real input.

## What was NOT verified, and why

| Item | Status | Reason |
|---|---|---|
| Calls placed through the adapter *code* | **Not tested** | The 4 live calls were placed through Retell's dashboard, not through `src/provider/retell.js`. That code is written against the published API reference but has never received a real response. |
| Provider-hosted public share link | **Not available** | Retell's free trial exposes no per-call share URL. The recordings and transcripts are committed to `recordings/` instead. |
| Real webhook signature verification | **Not tested** | Requires a Retell key and the optional `retell-sdk`. The rejection path (`401`) and idempotency are tested. |
| Real Claude extraction quality | **Not tested** | No `ANTHROPIC_API_KEY`. The validation boundary is covered by fault injection (scenario 30). |
| Browser rendering | **Not automated** | No browser automation available in this environment. HTTP-level verification above was performed instead; UI logic was reviewed by hand. |
| Cross-browser / mobile layout | **Not tested** | Same reason. Responsive CSS is present but visually unverified. |

No screenshots, recordings, transcripts or deployment URLs are fabricated anywhere in this
repository.

## Known failures

None. All executed checks passed.

The outstanding items above are **blocked on external credentials**, not failing.
