// Turn orchestration — the single entry point for advancing a conversation.
//
// It runs the decision sequence in a fixed order on every customer utterance:
//
//   1. Guard terminal states (a concluded call cannot reopen)
//   2. Extract facts from the utterance
//   3. Resolve context-dependent answers ("yes" means different things at different points)
//   4. Apply facts to state (recording corrections)
//   5. Evaluate transfer intent, disqualification and the alternative offer
//   6. Determine the earliest unanswered checklist item
//   7. Compose exactly one agent reply
//
// Routes stay thin because all of it lives here, and it is testable without HTTP.

import { extractFacts } from "../nlu/index.js";
import { applyFacts, evaluate } from "./state.js";
import { composeReply, greeting } from "./response.js";
import { isTerminal } from "./eligibility.js";

/** Bare agreement, with the Hindi forms that appear constantly on these calls. */
const AFFIRMATIVE = /^\s*(yes|yeah|yep|yup|sure|ok|okay|correct|right|that'?s right|absolutely|definitely|please|go ahead|fine|haan|haan ji|ji|ji haan|theek hai|bilkul|achha)\b[\s.!,]*$/i;
const NEGATIVE = /^\s*(no|nope|nah|not really|don'?t|do not|negative|nahi|nahi ji|na|bilkul nahi)\b[\s.!,]*$/i;

/** Agreement embedded in a longer sentence, e.g. "yes, let's proceed with 75 lakhs". */
const AFFIRMATIVE_LOOSE = /\b(yes|yeah|sure|ok|okay|agreed|proceed|go ahead|that works|let'?s do|i'?ll take|haan|theek hai|bilkul|chalega)\b/i;
const NEGATIVE_LOOSE = /\b(no|not interested|don'?t want|do not want|too low|not enough|forget it|leave it|nahi|nahi chahiye|kam hai)\b/i;

/**
 * Hedges that read as agreement to a keyword matcher but mean the opposite.
 * "I'm not sure where they are" contains "sure" and must never count as a yes.
 */
const HEDGE = /\b(not sure|no idea|don'?t know|do not know|not certain|maybe|might be|i think so|possibly|pata nahi)\b/i;

function isAffirmative(text) {
  if (HEDGE.test(text)) return false;
  if (AFFIRMATIVE.test(text)) return true;
  return AFFIRMATIVE_LOOSE.test(text) && !NEGATIVE_LOOSE.test(text);
}

function isNegative(text) {
  if (HEDGE.test(text)) return false;
  if (NEGATIVE.test(text)) return true;
  return NEGATIVE_LOOSE.test(text) && !AFFIRMATIVE_LOOSE.test(text);
}

/**
 * Fills in answers that only make sense relative to the question just asked.
 *
 * A bare "yes" carries no information on its own — it confirms an identity, accepts a
 * reduced loan amount, or confirms document availability depending entirely on where the
 * call is. Resolving it here, against the pending checklist item, keeps that ambiguity
 * out of both extractors.
 */
export function resolveContextualAnswer(state, utterance, facts) {
  const resolved = { ...facts };
  const text = (utterance || "").trim();
  const affirmative = isAffirmative(text);
  const negative = isNegative(text);

  // The alternative-offer question is resolved first: while it is pending, a yes/no is
  // unambiguously about the ₹75 lakh cap.
  if (state.amount_alternative_status === "pending" && resolved.amount_alternative == null) {
    if (affirmative) resolved.amount_alternative = "accepted";
    else if (negative) resolved.amount_alternative = "declined";
    return resolved;
  }

  if (!state.customer_verified) {
    // Only treat agreement as identity confirmation; never infer it from silence or
    // from an unrelated statement.
    if (affirmative && !resolved.not_intended_customer) resolved.confirms_identity = true;
    return resolved;
  }

  if (state.current_checklist_item === "documents_available" && resolved.documents_available == null) {
    if (affirmative) resolved.documents_available = "available";
    else if (negative) resolved.documents_available = "unavailable";
  }

  return resolved;
}

/**
 * Advances a call by one customer utterance.
 *
 * @param {object} params
 * @param {object} params.state      current conversation state
 * @param {string} params.utterance  raw customer speech
 * @param {Array}  [params.history]  prior transcript turns, oldest first
 * @param {boolean}[params.forceRules] bypass the LLM extractor (used by tests)
 * @returns {Promise<{state: object, reply: string, facts: object, terminal: boolean,
 *                    extraction: {source: string, degraded: boolean}, ignored?: boolean}>}
 */
export async function advanceTurn({ state, utterance, history = [], forceRules = false }) {
  // 1. Terminal guard. The utterance is still returned to the caller for the audit
  //    trail, but no state transition and no new question can follow a concluded call.
  if (isTerminal(state.qualification_status)) {
    return {
      state,
      reply: state.language_to_speak === "Hindi"
        ? "Yeh call pehle hi complete ho chuki hai. Aapke samay ke liye dhanyavaad."
        : "This call has already concluded. Thank you for your time.",
      facts: {},
      terminal: true,
      ignored: true,
      extraction: { source: "skipped_terminal", degraded: false },
    };
  }

  // 2. Extraction.
  const extraction = await extractFacts({
    utterance,
    conversationHistory: history,
    language: state.language_to_speak,
    forceRules,
  });

  // 3. Context-dependent resolution.
  const facts = resolveContextualAnswer(state, utterance, extraction.facts);

  // 4. Apply.
  const wasVerified = state.customer_verified;
  let next = applyFacts({ ...state, turn: (state.turn ?? 0) + 1 }, facts);

  // The offer is presented exactly once, on the turn verification first succeeds and
  // only when no terminal branch has taken over.
  const verificationJustSucceeded = !wasVerified
    && next.customer_verified
    && !next.transfer_required
    && next.customer_available !== false;
  if (verificationJustSucceeded && !next.offer_presented) {
    next.offer_presented = true;
  }

  // 5 & 6. Evaluate rules, terminal precedence and the next question.
  next = evaluate(next);

  // 7. Compose one reply.
  const reply = composeReply({
    state: next,
    facts,
    offerJustPresented: verificationJustSucceeded && next.qualification_status === "in_progress",
  });

  return {
    state: next,
    reply,
    facts,
    terminal: isTerminal(next.qualification_status),
    extraction: { source: extraction.source, degraded: extraction.degraded },
  };
}

export { greeting };
