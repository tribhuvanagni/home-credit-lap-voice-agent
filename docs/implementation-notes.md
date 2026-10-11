# Implementation Notes — Project 1

Decisions worth explaining, and the bugs that shaped the code.

## 1. Why the LLM is not allowed to decide anything

The obvious build is a long system prompt plus a model, letting it track state and apply
rules. It demos well and fails the assignment, which asks for "absolute accuracy" on
boundary conditions: 3 and 15 years pass, 2 and 16 do not; exactly ₹75,00,000 passes.

A model gets those right most of the time. "Most of the time" is not testable, and a
reviewer cannot tell a correct run from a lucky one. So:

- `engine/eligibility.js` holds every threshold as a pure function.
- The model's only job is utterance → fact object, validated against a schema.
- Customer-facing copy is templated, which makes fabricating an interest rate structurally
  impossible rather than merely discouraged.

The system prompt in `prompts/` is still written as a complete, standalone spec, because
the assignment's graded deliverable *is* the prompt — it has to work when pasted into
Retell with no backend at all. The backend is the verifiable implementation of the same
rules.

## 2. Prompt variable mapping

The assignment's variables are used verbatim. Retell injects
`retell_llm_dynamic_variables` using `{{name}}` placeholders, which is already the
assignment's notation, so no renaming was needed.

Were a platform to use different delimiters (`${name}`, `{name}`), the mapping belongs in
the provider adapter and should change **delimiters only, never names**:

```js
// illustrative — not needed for Retell
const toBolnaSyntax = (template) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, name) => `\${${name}}`);
```

`GET /api/prompt` renders the template with live values and returns an `unresolved` array;
a test asserts it is empty, so a typo in a variable name fails the build rather than
silently shipping an unsubstituted placeholder.

## 3. Positional amount attribution

The first version matched amounts with ordered regexes and got this wrong:

> "I need a loan of 40 lakhs, the property is worth 1 crore."

Whichever pattern ran first claimed both figures. The fix (`rules.js` → `extractMoney` +
`attributeAmounts`) records each figure's character offset, records each cue word's offset,
and assigns by proximity — preferring a *preceding* cue, since Indian English puts the cue
first ("loan of 40 lakhs", "worth 1 crore").

Figures nearest an income cue are discarded: "I earn ₹80,000 a month" is neither a loan
request nor a valuation, and recording it as either corrupts the checklist. A figure with
no cue within 45 characters becomes `ambiguous_amount`, which `state.js` places against
whichever money question is actually pending.

## 4. Bugs found and fixed during development

Worth recording because each was caught by a test, not by inspection.

| Bug | Symptom | Fix |
|---|---|---|
| `_ambiguous_amount` stripped by validation | Bare answers like "25 lakhs." were silently lost, so the loan item never filled and seven tests failed | Renamed to `ambiguous_amount` and added it to the schema's money fields. The underscore convention hid an internal field from the one function whose job is to let fields through. |
| "not sure" read as "yes" | "I'm not sure where they are" contains *sure*, so `AFFIRMATIVE_LOOSE` matched and recorded documents as available | Added a `HEDGE` guard checked before both affirmative and negative matching |
| "at home" / "ghar par" read as residential | "documents are at home" set `property_type` from a sentence about document location | Suppress the residential match when the only evidence is a home-location phrase and no explicit property word is present |
| "Home Credit" read as residential | Company name matched the `home` keyword | Same guard |
| Hindi ownership missed | "Sirf mere naam par hai" left item 2 unanswered, so a complete Hindi call never qualified | Added Hindi ownership patterns |
| Retrieval pulled everything to the overview entry | "What is the maximum amount?" returned the generic LAP description because `"what is"` scored 3 points | Removed question-framing phrases from keywords; they describe grammar, not topic |
| Literal `{{variable}}` in prompt prose | Prompt-render test reported two unresolved variables from the documentation note | Rewrote the note as `{{<name>}}` so the `\w+` matcher ignores it |

Two test assertions were also wrong rather than the code:

- Test 34 asserted item 1 was *never* asked. It is correctly asked once, with the offer;
  the requirement is that it is never asked *again*. Changed to assert exactly one
  occurrence.
- Test 35 asserted `rahi hoon` appeared in the replies, but the greeting is emitted at call
  creation and the helper only records replies. Split into a direct `greeting()` test for
  both genders.

## 5. Dropped supertest

`supertest` is the conventional choice, but its internal `require('./lib/test.js')`
resolved against the wrong root under Vitest because `tests/` sits outside `backend/` (the
layout the assignment's structure requires). Rather than reconfigure the bundler around a
test-only dependency, `tests/helpers/http.js` binds the real app to an ephemeral port and
uses Node's built-in `fetch`.

This turned out better than a workaround: the tests now exercise the genuine HTTP stack,
including the `express.json({ verify })` raw-body hook that webhook signature verification
depends on — which an in-process request stub bypasses entirely. One fewer dependency, more
realistic coverage.

## 6. Terminal-state guard placement

Terminal protection lives in `turn.js` as step 1, before extraction, rather than being
checked by each rule. The utterance is still appended to the transcript (the log must stay
faithful to what was said) but no fact is applied and no question is generated.

Putting it first means "continuation after disqualification" cannot regress: a new rule
added later inherits the guard automatically.

## 7. Transfer outranks disqualification

If one utterance establishes both a disqualifying answer and an existing property loan,
transfer wins. A transfer is a *routing* decision — the customer is handed to a different
product team — whereas disqualification rejects them for this offer. Routing someone to a
specialist is recoverable; wrongly telling them they do not qualify is not.

This is a genuine ambiguity in the assignment, recorded as A7 in the shared requirements
rather than resolved silently.

## 8. Market value has no threshold, deliberately

The reference material flags inventing a minimum property value as a common failure. There
is no `market_value` comparison anywhere in `eligibility.js`, `GET /api/rules` returns
`threshold: null` with an explanatory note, and a test qualifies a customer with an
₹18 lakh property against a ₹10 lakh loan. The absence is asserted, not just intended.

## 9. Knowledge base omits what it must not answer

`rag/knowledge.js` contains no interest rate, fee or approval timeline — not because they
were forgotten, but because the assignment states the senior expert supplies them. There
is no grounded value to serve, so the agent must defer.

`DEFERRED_TOPICS` is checked *before* retrieval, so even if operator-supplied context
mentioned a rate, the agent would still defer. A test asserts the corpus contains no `%`
figure at all.

## 10. Known limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| No live voice call | The required recording/public-log deliverable is unmet | `docs/voice-platform-status.md` with exact manual steps |
| Retell adapter unexecuted | A field mismatch would surface on first live use | Written against the published reference; endpoints cited in-file |
| Rule extractor is English + transliterated Hindi | Devanagari script input would extract poorly | The LLM path handles it when a key is configured |
| In-memory store | Calls are lost on restart | Deliberate for a workbench; isolated behind one module |
| Webhook verification needs an optional SDK | Deliveries rejected until installed | Reported via `/api/webhooks/status` |
| No browser automation available | UI verified by hand | Steps and results recorded in `docs/test-results.md` |
