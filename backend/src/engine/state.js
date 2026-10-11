// Conversation state: construction, fact application, and evaluation.
//
// All three are pure functions over plain objects. Nothing here performs I/O, which
// makes the whole qualification flow straightforward to test turn by turn.

import { config } from "../config.js";
import {
  MAX_LOAN,
  canHandoff,
  evaluateDisqualification,
  isLoanAboveMax,
  missingFields,
  nextChecklistItem,
} from "./eligibility.js";

export function createInitialState(callConfig = {}) {
  return {
    // --- dynamic prompt variables -------------------------------------------
    company_name: callConfig.company_name ?? config.defaults.companyName,
    customer_name: callConfig.customer_name ?? "Customer",
    agent_name: callConfig.agent_name ?? config.defaults.agentName,
    agent_gender: callConfig.agent_gender ?? config.defaults.agentGender,
    language_to_speak: callConfig.language_to_speak ?? config.defaults.language,
    additional_context_from_rag: callConfig.additional_context_from_rag ?? "",

    // --- verification and availability --------------------------------------
    customer_verified: false,
    customer_available: null, // null = unknown, true = available, false = busy
    callback_requested: false,
    callback_time: null,

    // --- offer ---------------------------------------------------------------
    offer_presented: false,
    offer_interest: null,

    // --- the seven checklist items ------------------------------------------
    property_type: null,
    ownership_status: null,
    documents_available: null,
    requested_loan_amount: null,
    adjusted_loan_amount: null,
    amount_alternative_status: null, // null | pending | accepted | declined
    occupation: null,
    income_mode: null,
    market_value: null,
    tenure_years: null,

    // --- transfer branch -----------------------------------------------------
    existing_property_loan: false,
    emi_reduction_request: false,
    transfer_required: false,

    // --- outcome -------------------------------------------------------------
    disqualified: false,
    disqualification_reason: null,
    disqualification_field: null,
    disqualification_rule: null,
    qualification_status: "in_progress",
    termination_reason: null,
    handoff_status: "not_started", // not_started | simulated | dispatched | failed

    // --- flow bookkeeping ----------------------------------------------------
    current_checklist_item: "customer_verification",
    missing_fields: [
      "property_type", "ownership_status", "documents_available",
      "requested_loan_amount", "occupation", "income_mode", "market_value", "tenure_years",
    ],
    turn: 0,
    // Append-only audit of field changes, so a correction is visible rather than silent.
    answer_history: [],
  };
}

/** Fields whose changes are worth recording in the audit trail. */
const AUDITED_FIELDS = [
  "property_type", "ownership_status", "documents_available", "requested_loan_amount",
  "occupation", "income_mode", "market_value", "tenure_years",
];

function recordChange(history, field, from, to, turn) {
  return [...history, { field, from: from ?? null, to, turn, at: new Date().toISOString() }];
}

/**
 * Places an amount that carried no "worth"/"loan" cue against whichever money field is
 * actually pending, so "about one crore" answers the question that was just asked.
 */
function placeAmbiguousAmount(state, facts) {
  const amount = facts.ambiguous_amount;
  if (amount == null) return facts;
  const resolved = { ...facts };
  delete resolved.ambiguous_amount;

  if (resolved.requested_loan_amount != null || resolved.market_value != null) return resolved;

  const pending = state.current_checklist_item;
  if (pending === "market_value" && state.market_value == null) {
    resolved.market_value = amount;
  } else if (pending === "requested_loan_amount" && state.requested_loan_amount == null) {
    resolved.requested_loan_amount = amount;
  } else if (state.requested_loan_amount == null) {
    resolved.requested_loan_amount = amount;
  } else if (state.market_value == null) {
    resolved.market_value = amount;
  }
  return resolved;
}

/**
 * Applies validated facts to state.
 *
 * A later clear answer overwrites an earlier one — that is how self-corrections work —
 * but the previous value is kept in answer_history rather than discarded.
 */
export function applyFacts(state, rawFacts) {
  const next = { ...state };
  const facts = placeAmbiguousAmount(state, rawFacts);

  // Identity must be settled before anything else is believed about this speaker.
  if (facts.not_intended_customer) {
    next.customer_verified = false;
    next.termination_reason = "not_intended_customer";
    return next; // evaluate() turns this into a terminal state
  }
  if (facts.confirms_identity) {
    next.customer_verified = true;
    if (next.customer_available == null) next.customer_available = true;
  }

  if (facts.busy) {
    next.customer_available = false;
    next.callback_requested = true;
    if (facts.callback_time) next.callback_time = facts.callback_time;
  } else if (facts.callback_time && next.callback_requested) {
    // Callback time supplied on a later turn, after the customer said they were busy.
    next.callback_time = facts.callback_time;
  }

  if (facts.refuses_to_continue) next.offer_interest = false;

  if (facts.existing_property_loan) {
    next.existing_property_loan = true;
    next.transfer_required = true;
  }
  if (facts.emi_reduction_request) {
    next.emi_reduction_request = true;
    next.transfer_required = true;
  }

  for (const field of AUDITED_FIELDS) {
    const value = facts[field];
    if (value == null) continue;
    if (next[field] !== value) {
      next.answer_history = recordChange(next.answer_history, field, next[field], value, next.turn);
    }
    next[field] = value;
  }

  // Capturing an amount decides whether the alternative-offer question is needed.
  if (facts.requested_loan_amount != null) {
    if (isLoanAboveMax(facts.requested_loan_amount)) {
      next.amount_alternative_status = "pending";
      next.adjusted_loan_amount = null;
    } else {
      next.amount_alternative_status = null;
      next.adjusted_loan_amount = null;
    }
  }

  // An explicit answer to the alternative offer only counts while one is pending.
  if (facts.amount_alternative && next.amount_alternative_status === "pending") {
    next.amount_alternative_status = facts.amount_alternative;
    if (facts.amount_alternative === "accepted") next.adjusted_loan_amount = MAX_LOAN;
  }

  return next;
}

/**
 * Derives status, terminal outcome and the next question from the current facts.
 *
 * Precedence is fixed and documented in requirements-summary.md §5.1. Transfer outranks
 * disqualification because it routes the customer to a different team rather than
 * rejecting them.
 */
export function evaluate(state) {
  const next = { ...state };

  // 1. Wrong person — never proceed as if verified.
  if (!next.customer_verified && next.termination_reason === "not_intended_customer") {
    next.qualification_status = "disqualified";
    next.disqualified = true;
    next.disqualification_reason = "not_intended_customer";
    next.missing_fields = missingFields(next);
    return next;
  }

  // 2. Transfer branch.
  if (next.transfer_required) {
    next.qualification_status = "transfer";
    next.termination_reason = next.existing_property_loan
      ? "existing_loan_transfer"
      : "emi_reduction_transfer";
    next.current_checklist_item = "transfer";
    next.handoff_status = "not_started";
    next.missing_fields = missingFields(next);
    return next;
  }

  // 3. Deterministic disqualification.
  const verdict = evaluateDisqualification(next);
  if (verdict.disqualified) {
    next.disqualified = true;
    next.disqualification_reason = verdict.reason;
    next.disqualification_field = verdict.failedField;
    next.disqualification_rule = verdict.rule;
    next.qualification_status = "disqualified";
    next.termination_reason = verdict.reason;
    next.current_checklist_item = "disqualified";
    next.missing_fields = missingFields(next);
    return next;
  }

  // 4. Busy customer — callback requested, call ends.
  if (next.customer_available === false) {
    next.qualification_status = "callback";
    next.termination_reason = "busy_callback";
    next.current_checklist_item = "callback";
    next.missing_fields = missingFields(next);
    return next;
  }

  // 5. Verification gate.
  if (!next.customer_verified) {
    next.qualification_status = "in_progress";
    next.current_checklist_item = "customer_verification";
    next.missing_fields = missingFields(next);
    return next;
  }

  // 6. Above-limit alternative offer.
  if (next.amount_alternative_status === "declined") {
    next.qualification_status = "declined";
    next.termination_reason = "amount_alternative_declined";
    next.current_checklist_item = "declined";
    next.missing_fields = missingFields(next);
    return next;
  }
  if (next.amount_alternative_status === "accepted") next.adjusted_loan_amount = MAX_LOAN;

  // 7. Customer refused to continue.
  if (next.offer_interest === false) {
    next.qualification_status = "declined";
    next.termination_reason = "customer_declined_offer";
    next.current_checklist_item = "declined";
    next.missing_fields = missingFields(next);
    return next;
  }

  // 8. Handoff gate.
  const gate = canHandoff(next);
  if (gate.ok) {
    next.qualification_status = "qualified";
    next.termination_reason = "qualified_handoff";
    next.handoff_status = "simulated";
    next.current_checklist_item = "handoff";
    next.missing_fields = [];
    return next;
  }

  // 9. Still qualifying — ask the earliest unanswered item.
  next.qualification_status = "in_progress";
  next.current_checklist_item = nextChecklistItem(next) ?? "handoff_blocked";
  next.missing_fields = missingFields(next);
  return next;
}
