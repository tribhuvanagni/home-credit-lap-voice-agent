# Call Transcripts — Home Credit LAP Qualification Agent

Real calls placed on **11 October 2026** against a Retell AI agent running the system
prompt from `project-1/prompts/system_prompt.md`.

| Setting | Value |
|---|---|
| Platform | Retell AI (web call) |
| Agent | Single-Prompt Agent |
| Voice | Willa (British, female) |
| Language | English (India) |
| Model | GPT 5.6 Terra |
| Dynamic variables | `customer_name=Rahul Sharma`, `agent_name=Priya`, `agent_gender=female`, `company_name=Home Credit`, `language_to_speak=English` |

Audio for each call is in `recordings/audio/`.

Customer identity is synthetic ("Rahul Sharma"). No real customer data was used.

---

## Call 1 — Fully eligible customer → senior loan expert handoff

**Duration:** 2m 39s · **Call ID:** `call_bbf0fb96e75402b37755c5278a4`
**Audio:** `audio/call-1-fully-eligible-handoff.wav`

> **Agent:** Hello, am I speaking with Rahul Sharma? This is Priya from Home Credit.
> **Agent:** Hello, Rahul Sharma? Can you hear me?
> **Customer:** Yes. This is Rahul speaking.
> **Agent:** Thank you for confirming, Rahul Sharma. As a valued existing customer, you may be eligible for a Loan Against Property of up to seventy-five lakhs. Is the property residential, commercial, industrial, or agricultural?
> **Agent:** Rahul, are you still there?
> **Customer:** It's residential flat.
> **Agent:** Is it solely owned by you, or jointly owned with someone else?
> **Customer:** Or just in my name.
> **Agent:** Do you have the original property documents available for verification?
> **Customer:** Yes. The originals are there at home.
> **Agent:** How much would you like to borrow?
> **Customer:** I'm looking for about fifty x.
> **Agent:** Sorry, I didn't quite catch the amount. Could you repeat how much you'd like to borrow?
> **Customer:** For about fifty lakhs.
> **Agent:** Fifty lakhs, noted. Are you salaried or self-employed, and is your income received in your bank account or in cash?
> **Customer:** I'm salaried, and my salary comes into my bank account.
> **Agent:** What would you estimate the current market value of the flat to be?
> **Customer:** The flat is worth around one point two crore.
> **Agent:** Over how many years would you like to repay the loan?
> **Customer:** Ten years.
> **Agent:** Thank you for sharing all of that, Rahul Sharma. Based on this preliminary information, you meet the criteria for this offer. A senior loan expert will contact you shortly to discuss the next steps and the exact interest rates. Thank you for your time!

**What this call demonstrates**

| Requirement | Evidence |
|---|---|
| Verification gate before anything else | Agent asked for Rahul by name and waited for confirmation before presenting the offer |
| Offer framed as existing-customer benefit | "As a valued existing customer… up to seventy-five lakhs" |
| All 7 checklist items captured sequentially | property → ownership → documents → amount → occupation+income → market value → tenure |
| No item re-asked | Each question asked exactly once |
| Ambiguity clarified, never guessed | Speech recognition produced "fifty **x**"; the agent asked for a repeat instead of assuming a figure |
| Answer acknowledged before moving on | "Fifty lakhs, noted." |
| Handoff only after all 7 answered and passed | Handoff came after tenure, the final item |
| **No interest rate invented** | Deferred to the senior loan expert, as required |

Retell's own post-call analysis recorded: *Call Successful · Ended · User Sentiment Neutral*,
with the summary: *"Rahul Sharma confirmed interest in a loan against a residential flat
solely owned by him, with original documents available. He requested ₹50 lakhs against an
estimated property value of ₹1.2 crore, is salaried with bank-account salary credit, and
prefers a 10-year repayment term; the agent said a senior loan expert would follow up."*

---

## Call 2 — Agricultural property → immediate disqualification

**Duration:** 37s · **Audio:** `audio/call-2-agricultural-disqualified.wav`

> **Agent:** Hello, am I speaking with Rahul Sharma? This is Priya from Home Credit.
> **Customer:** Yes. Speaking.
> **Agent:** Thank you for confirming, Rahul Sharma. You may be eligible for a Loan Against Property offer of up to seventy-five lakhs. Is the property residential, commercial, industrial, or agricultural?
> **Customer:** It's agricultural right.
> **Agent:** Thank you for letting me know. This offer isn't available for agricultural property, so you don't meet the criteria for this specific offer at this time. Thank you for your time.

**What this call demonstrates**

| Requirement | Evidence |
|---|---|
| Agricultural property disqualifies | Rejected on checklist item 1 |
| Disqualification is **immediate** | Items 2–7 were never asked |
| Polite, reason given | Named the reason plainly, no lecture |
| Exact wording from the brief | "do not meet the criteria for this specific offer at this time" |
| Call ends | No attempt to continue or upsell |

---

## Call 3 — Existing property loan → transfer specialist

**Duration:** 33s · **Audio:** `audio/call-3-existing-loan-transfer.wav`

> **Agent:** Hello, am I speaking with Rahul Sharma? This is Priya from Home Credit.
> **Customer:** Yes. Speaking.
> **Agent:** Thank you for confirming, Rahul Sharma. You may be eligible for a Loan Against Property offer of up to seventy-five lakhs. What type of property is it: residential, commercial, industrial, or agricultural?
> **Customer:** I already have a loan running on this property.
> **Agent:** Since there's already a loan on this property, our loan-transfer specialist will contact you shortly. Thank you for your time.

**What this call demonstrates**

| Requirement | Evidence |
|---|---|
| Transfer Logic Switch detected mid-flow | Customer raised it while answering item 1 |
| Routed, **not rejected** | Handed to the loan-transfer specialist — a different outcome from disqualification |
| Fresh-loan checklist abandoned | Items 1–7 not continued |
| Call ends | Single closing message |

---

## Call 4 — Busy customer → callback captured

**Duration:** 31s · **Audio:** `audio/call-4-busy-callback.wav`

> **Agent:** Hello, am I speaking with Rahul Sharma? This is Priya from Home Credit.
> **Customer:** I'm trying right now you call me tomorrow evening?
> **Agent:** Okay, I understand. What time tomorrow evening would be convenient for a callback?
> **Customer:** At evening.
> **Agent:** We'll call you tomorrow evening. Thank you for your time.

*(The customer said "I'm driving right now" — speech recognition transcribed it as "trying".
The agent still interpreted the intent correctly.)*

**What this call demonstrates**

| Requirement | Evidence |
|---|---|
| Busy state recognised | Picked up the intent despite a transcription error |
| Acknowledged without pressure | "Okay, I understand." |
| Preferred callback time requested and captured | "tomorrow evening" |
| **Offer never presented** | The ₹75 lakh offer is absent from this call entirely — correct for a busy customer |
| Call ends | No pitch, no eligibility questions |

---

## Coverage summary

| Branch from the assignment | Call | Outcome |
|---|---|---|
| Qualified → senior loan expert handoff | 1 | ✅ |
| Immediate disqualification | 2 | ✅ |
| Transfer logic switch | 3 | ✅ |
| Busy customer / callback | 4 | ✅ |
| Loan amount above ₹75 lakh | — | covered by the automated suite |
| Self-correction, out-of-order answers | — | covered by the automated suite |
| Cash income, tenure boundaries | — | covered by the automated suite |

The branches not recorded live are each covered by automated tests in both projects —
185 tests in total. See `project-1/docs/test-results.md` and
`project-2/docs/test-results.md`.

## Known imperfections (stated, not hidden)

1. **Call 1 contains two filler prompts** ("Can you hear me?", "Rahul, are you still
   there?") caused by microphone delay on the tester's side, not by agent logic.
2. **Speech recognition errors occurred twice** — "fifty lakhs" → "fifty x", and
   "driving" → "trying". Both are ASR limitations rather than prompt failures, and the
   agent handled both correctly: it asked for clarification in the first case and
   interpreted intent correctly in the second.
3. **Voice accent** — Retell's free platform voices offer American, British and Mexican
   accents only. A British female voice was used; no Indian-accent voice was available.
