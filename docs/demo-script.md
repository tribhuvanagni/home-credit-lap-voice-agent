# Video Demo Script — Project 1 (Conversational AI Workbench)

**Target length: 4–5 minutes.** Record with OBS, Loom, or **Win + G** (Xbox Game Bar).

Before recording:
1. `cd backend && npm start`
2. Open **http://localhost:8080** in a clean browser window (no bookmarks bar visible)
3. If anything is left over from testing, click **End & reset**

Read the quoted lines aloud. Don't rush — pause after each click so the viewer sees it.

---

## PART 1 — Introduction (20 seconds)

**Show:** the workbench, nothing clicked yet.

> "This is an AI voice agent for Home Credit's Loan Against Property offer. It calls an
> existing customer, checks seven eligibility points, and decides whether to hand the lead
> to a senior loan expert."

**Point at the top-right badges:**

> "It's running in simulation mode here, with the rule-based understanding layer. The same
> engine runs a live phone call — I'll show the real recordings at the end."

---

## PART 2 — A qualified call (60 seconds)

**Click:** scenario **"Fully eligible customer"** (left panel, first one)

Let it finish — it plays eight turns.

> "That's a complete call. The agent verified who it was speaking to, presented the offer,
> then asked seven questions in order."

**Point at the checklist on the right:**

> "All seven items captured — property type, ownership, documents, loan amount, occupation
> and income, market value, tenure. Item five holds two fields, occupation and income mode,
> which is how the assignment defines it."

**Point at the Outcome panel:**

> "Status qualified, handoff gate open. The gate has six conditions and all of them have to
> pass before a handoff is allowed."

**Scroll the transcript to the last agent message:**

> "And notice what it doesn't say — it never quotes an interest rate. The senior expert
> provides that. There's no code path in this project that could produce one."

---

## PART 3 — Immediate disqualification (40 seconds)

**Click:** scenario **"Agricultural property"**

> "Agricultural land is excluded. Watch what happens."

**Point at the checklist:**

> "The call ended on question one. Items two through seven were never asked — that's the
> 'immediate disqualification' rule. It stops, explains politely, and ends."

**Point at the Outcome panel:**

> "And it tells me which rule fired, so if a customer disputes the outcome I can say exactly
> why."

---

## PART 4 — The ₹75 lakh cap (50 seconds)

**Click:** scenario **"₹90 lakh → still pending"**

> "This customer asked for ninety lakhs. The limit is seventy-five."

**Point at the last agent message:**

> "It doesn't reject them. It explains the cap and offers seventy-five lakhs instead."

**Point at the Outcome panel — gate blocked:**

> "And here's the subtle part. The customer hasn't answered yet, so the handoff gate is
> blocked with the reason 'amount alternative unresolved'. Silence is not acceptance. A
> naive implementation would treat this as agreement and hand off a lead that was never
> confirmed."

**Click:** scenario **"₹90 lakh → accepts ₹75 lakh"**

> "When they do accept, the amount becomes seventy-five lakhs and the checklist carries on."

---

## PART 5 — Out-of-order answers (40 seconds)

**Click:** scenario **"Multiple answers, out of order"**

> "Real customers don't answer one question at a time. Here the customer said: it's a
> residential house, jointly owned with my wife, worth around one point two crore."

**Point at the checklist — three items now filled:**

> "Three items captured from one sentence — property type, ownership, and market value."

**Point at the last agent question:**

> "And the next question is about documents. It skipped straight past the two it already
> knows. Re-asking something the customer already told you is the most noticeable failure
> on these calls."

> "Joint ownership is also accepted here — that's a trap in the brief, and disqualifying it
> would be wrong."

---

## PART 6 — Transfer routing (30 seconds)

**Click:** scenario **"Existing property loan"**

> "If there's already a loan on the property, this isn't a fresh loan case. It routes to a
> loan-transfer specialist and stops the checklist."

> "Worth noting: this outranks disqualification. The customer isn't rejected — they're
> handed to a different team."

---

## PART 7 — The prompt and grounding (45 seconds)

**Click:** the **Agent prompt** tab

> "This is the system prompt, rendered with live values."

**Point at the variable cards:**

> "All eleven dynamic variables from the brief — company name, customer name, agent name,
> agent gender, date, day, time, RAG context, language, conversation history, and the
> customer utterance. A test fails the build if any one of them is left unsubstituted."

**Click:** the **Knowledge & rules** tab

**Type in the lookup box:** `What interest rate do you offer?` → click **Query**

> "Asked about an interest rate, the agent defers to the senior expert. There is no rate
> anywhere in the knowledge base — so it can't invent one even if it wanted to."

**Point at the rules panel:**

> "And these rules come from the backend, not the frontend. The UI never holds a second copy
> that could drift."

---

## PART 8 — Tests and real calls (50 seconds)

**Switch to the terminal, run:**
```bash
npm test
```

> "Seventy-six automated tests, all passing, and they run completely offline — no API key
> needed. Every one of the thirty-five scenarios the assignment asks for is covered,
> including the boundaries: two years fails, three passes, fifteen passes, sixteen fails."

**Open `recordings/transcripts.md` (or the audio folder):**

> "And these are real calls, placed through Retell AI. Four of them — a full qualification,
> a disqualification, a transfer, and a busy customer."

**Play ~15 seconds of `call-1-fully-eligible-handoff.wav`**

> "One detail I'd point out: partway through this call, speech recognition garbled the
> amount. The agent asked the customer to repeat it instead of guessing a number. That's the
> ambiguity rule working on real input, not a scripted demo."

---

## PART 9 — Close (20 seconds)

> "The core decision in this project is that the language model decides nothing. It turns
> speech into structured facts, and that's all. Every eligibility rule is a plain function
> I can unit test, and all the agent's wording is templated — which is why it's incapable of
> inventing a rate or approving a loan."

> "Thanks for watching."

---

## Checklist before uploading

- [ ] The browser shows no personal bookmarks or tabs
- [ ] Audio is clear and there's no background noise
- [ ] The terminal font is large enough to read
- [ ] You actually showed the test run passing
- [ ] Upload to **Google Drive** or **YouTube (Unlisted)**, set to "anyone with the link"
- [ ] Paste the link into `SUBMISSION.md`
