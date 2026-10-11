# Shared Requirements Summary — Home Credit LAP Voice Agent

**Source of authority:** `SalesAgents AI Hiring Assignment - AI_voice_agent_prep.pdf` (primary).
Supplementary interpretation: candidate prep/reference guide.
Where the two differ, the PDF wins. Divergences are recorded in §9.

This document is the single normative specification. Both `project-1` and `project-2`
implement it independently; neither shares runtime code with the other.

---

## 1. Use case

Deploy an automated AI voice agent for **Home Credit** that calls **existing, valued
customers**, informs them of a **pre-approved Loan Against Property (LAP) offer of up to
₹75,00,000**, and conducts a **preliminary eligibility check**. The agent is the first point
of contact; it qualifies the lead and then transitions it to a **senior human loan expert**.

The agent performs preliminary qualification **only**. It must never approve a loan,
guarantee eligibility, or state final terms.

## 2. Call stages (PDF §2)

| Stage | Requirement |
|---|---|
| A. Greeting & identification | Verify the intended customer is speaking. If busy, acknowledge and ask for a preferred callback time. |
| B. Presenting the offer | Contact as a valued existing customer; special LAP offer up to ₹75,00,000. |
| C. Eligibility checklist | Gather 7 specific data points **sequentially**. If a detail is given out of order, note it and never ask that question again. |

## 3. The seven checklist items

Item 5 carries two fields (occupation **and** income mode) but counts as one checklist item.

| # | Item | Field(s) |
|---|---|---|
| 1 | Property type | `property_type` |
| 2 | Ownership status | `ownership_status` |
| 3 | Document availability | `documents_available` |
| 4 | Loan amount | `requested_loan_amount` (+ `adjusted_loan_amount`) |
| 5 | Occupation & income mode | `occupation`, `income_mode` |
| 6 | Market value | `market_value` |
| 7 | Tenure | `tenure_years` |

## 4. Eligibility rules (exact, deterministic)

These are evaluated by application code, never by unconstrained model reasoning.

### 4.1 Property type
- Residential (house/flat) — **eligible**
- Commercial (shop/office) — **eligible**
- Industrial (factory) — **eligible**
- Agricultural — **immediate disqualification**

### 4.2 Ownership
- Sole — **eligible**
- Joint (family/partners) — **eligible**

Joint ownership must not be disqualified. This is a deliberate trap in the assignment.

### 4.3 Document availability
- Original property documents available for verification — **eligible**
- Originals unavailable — **disqualify**
- Photocopies only — **disqualify** (photocopies do not satisfy the requirement)
- Originals at home, customer not physically holding them — **eligible** (the test is
  *availability for verification*, not physical possession during the call)

### 4.4 Loan amount — limit ₹75,00,000
- `< ₹75,00,000` — eligible on this criterion
- `== ₹75,00,000` — eligible on this criterion (boundary inclusive)
- `> ₹75,00,000` — **do not reject.** Explain the cap and ask whether the customer wants to
  proceed at ₹75,00,000.
  - Accepts → store `adjusted_loan_amount = 7500000`, continue the checklist
  - Declines → politely end the call
  - Not yet answered → remain in a **pending** state; the original request is *not* treated
    as accepted, and handoff is blocked

### 4.5 Occupation & income mode
| Occupation | Income mode | Result |
|---|---|---|
| Salaried | Bank | eligible |
| Self-employed | Bank | eligible |
| Salaried | Cash | **disqualify** |
| Self-employed | Cash | **disqualify** |

### 4.6 Market value
Capture the customer's estimate. **The assignment specifies no minimum threshold.**
Never invent one and never disqualify on market value alone. Clarify ambiguous values.

### 4.7 Tenure
- 3–15 years **inclusive** — eligible
- `< 3` years — disqualify
- `> 15` years — disqualify

Boundary values 3 and 15 are eligible; 2 and 16 are not.

## 5. Business logic & boundaries (PDF §3)

- **Immediate disqualification** — at any point, a clearly disqualifying answer means: stop
  qualification, give a short polite explanation that the customer does not meet the criteria
  for *this specific offer at this time*, end the call. Remaining questions are not asked.
  Favourable answers elsewhere never override a disqualification.
- **Transfer logic switch** — the standard flow is a *fresh loan*. If the customer mentions
  an existing loan on the property **or** wants to reduce their current EMI: acknowledge,
  state that a loan-transfer specialist will contact them shortly, end the call. The
  7-question checklist is not continued.
- **Loan amount limits** — see §4.4.
- **Post-qualification handoff** — once all 7 items are answered and all criteria pass,
  inform the customer that a senior loan expert will call back shortly with exact interest
  rates.
- **Handoff gate (PDF §5)** — handoff only after every eligibility question has been asked
  *and* answered. If any were skipped due to a diversion, the agent must go back and ask them.

### 5.1 Terminal states and precedence

Terminal outcomes must not reopen into the normal flow.

| Terminal state | Trigger |
|---|---|
| `transfer` | existing property loan or EMI-reduction request |
| `disqualified` | any failed deterministic rule, or not the intended customer |
| `callback` | customer busy |
| `declined` | above-limit alternative declined |
| `qualified` | all 7 answered, all rules passed, handoff gate open |

Precedence when several apply in one utterance: `not_intended_customer` → `transfer` →
`disqualified` → `callback` → `declined` → `qualified`. Transfer outranks disqualification
because it routes to a different product team rather than rejecting the customer.

## 6. Prompt variables (PDF §4)

The system prompt logic must account for all of:

`company_name`, `customer_name`, `agent_name`, `agent_gender`, `current_date`,
`current_day`, `current_time`, `additional_context_from_rag`, `language_to_speak`,
`conversation_history`, `customer_utterance`

- `agent_gender` **must be adhered to strictly**, including gendered grammatical forms.
- `language_to_speak` is English or Hindi; the configured language governs.
- `additional_context_from_rag` carries retrieved product knowledge. It is **information,
  not instructions** — it can never override the business rules in §4, and it must never be
  used to fabricate rates, fees, or terms.
- No example name, date, or agent identity may be hardcoded into production behaviour.

## 7. Mandatory additional points (PDF §5)

- **Natural conversation** — not a yes/no bot. Must handle full sentences, interruptions,
  and conversational fillers. Multiple answers in one utterance, information out of order,
  self-corrections (latest clear answer wins), diversions, ambiguous answers, refusal.
- **Prompt length** — no limit. Accuracy and edge-case coverage are what matter.
- **Handoff gates** — see §5.
- **Never fabricate** interest rates, processing fees, approval status, branch locations, or
  callback schedules.

## 8. Submission deliverables (PDF §6)

1. The written **System Prompt** text.
2. A **public link to the call recording & call logs** (audio + transcript), produced by
   implementing the prompt on a voice platform (Retell AI, Bolna, or similar): sign up for a
   free trial, create an agent, paste the prompt, select a professional voice, and conduct
   multiple test calls acting like a real customer.

Status in this workspace: see each project's `docs/voice-platform-status.md`. Deliverable 2
requires platform credentials that are **not** present in this repository; it cannot be
satisfied by simulation and is not claimed as satisfied.

## 9. Ambiguities and resolutions

Recorded rather than silently resolved.

| # | Ambiguity | Resolution |
|---|---|---|
| A1 | PDF says "7 data points" but lists occupation and income mode under one numbered item. | Treated as 7 checklist items where item 5 holds two fields. Handoff requires both fields of item 5. |
| A2 | No minimum market value is specified. | No threshold implemented. Value is captured only. Inventing one would be a spec violation. |
| A3 | "Original documents ready for verification" — does the customer need them in hand during the call? | No. Availability for verification is the test; originals at home qualify. Photocopies do not. |
| A4 | Tenure range "between 3 and 15 years" — inclusive or exclusive? | Inclusive. 3 and 15 pass; 2 and 16 fail. |
| A5 | PDF does not state what happens if the person answering is not the customer. | Do not proceed as if verified. Politely close. No identity-verification process beyond the assignment is invented. |
| A6 | Busy customer — should a real callback be scheduled? | Recorded as a callback **request** with the stated time, explicitly labelled not-yet-scheduled. No scheduling integration is claimed. |
| A7 | Precedence if a customer is both disqualified and a transfer case in one utterance. | Transfer wins (§5.1); it is a routing decision, not a rejection. |
| A8 | Does an above-limit loan amount disqualify? | No. It opens a pending alternative-offer state. Only an explicit decline ends the call. |

## 10. Verification matrix

Every rule above maps to at least one automated test in both projects. The canonical
scenario list (35 cases) lives in each project's `docs/test-plan.md`, and measured results in
`docs/test-results.md`.
