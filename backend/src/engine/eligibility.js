// Deterministic eligibility engine.
//
// Every threshold and allowed value here comes straight from the assignment PDF
// (see shared-requirements/requirements-summary.md §4). No model output reaches these
// functions — they take normalised state and return a verdict, which is what makes the
// qualification decision reproducible and testable.

export const MAX_LOAN = 7_500_000; // ₹75,00,000 — boundary is inclusive
export const MIN_TENURE_YEARS = 3;
export const MAX_TENURE_YEARS = 15;

export const ELIGIBLE_PROPERTY_TYPES = ["residential", "commercial", "industrial"];
export const DISQUALIFYING_PROPERTY_TYPES = ["agricultural"];

/** Terminal statuses. Once set, the call does not return to qualification. */
export const TERMINAL_STATUSES = Object.freeze([
  "qualified",
  "disqualified",
  "transfer",
  "callback",
  "declined",
]);

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * The seven checklist items in the order the assignment specifies.
 * Item 5 holds two fields and is only complete when both are present.
 */
export const CHECKLIST = Object.freeze([
  { id: "property_type", item: 1, fields: ["property_type"] },
  { id: "ownership_status", item: 2, fields: ["ownership_status"] },
  { id: "documents_available", item: 3, fields: ["documents_available"] },
  { id: "requested_loan_amount", item: 4, fields: ["requested_loan_amount"] },
  { id: "occupation_income", item: 5, fields: ["occupation", "income_mode"] },
  { id: "market_value", item: 6, fields: ["market_value"] },
  { id: "tenure_years", item: 7, fields: ["tenure_years"] },
]);

function isItemAnswered(state, entry) {
  return entry.fields.every((field) => state[field] != null);
}

/**
 * Applies every disqualification rule and returns the first failure.
 *
 * Only *established* values can disqualify: a null field is unanswered, never a failure.
 * Market value is deliberately absent — the assignment specifies no threshold, and
 * inventing one would reject eligible customers.
 */
export function evaluateDisqualification(state) {
  if (DISQUALIFYING_PROPERTY_TYPES.includes(state.property_type)) {
    return {
      disqualified: true,
      reason: "agricultural_property_not_eligible",
      failedField: "property_type",
      rule: "§4.1 property type",
    };
  }
  if (state.documents_available === "unavailable" || state.documents_available === "photocopy_only") {
    return {
      disqualified: true,
      reason: "original_documents_required",
      failedField: "documents_available",
      rule: "§4.3 document availability",
    };
  }
  if (state.income_mode === "cash") {
    return {
      disqualified: true,
      reason: "cash_income_not_eligible",
      failedField: "income_mode",
      rule: "§4.5 income mode",
    };
  }
  if (state.tenure_years != null
    && (state.tenure_years < MIN_TENURE_YEARS || state.tenure_years > MAX_TENURE_YEARS)) {
    return {
      disqualified: true,
      reason: "tenure_out_of_range",
      failedField: "tenure_years",
      rule: "§4.7 tenure",
    };
  }
  return { disqualified: false, reason: null, failedField: null, rule: null };
}

export function isLoanAboveMax(amount) {
  return typeof amount === "number" && amount > MAX_LOAN;
}

/** True when all seven items are answered (item 5 requires both of its fields). */
export function isChecklistComplete(state) {
  return CHECKLIST.every((entry) => isItemAnswered(state, entry));
}

/**
 * The earliest unanswered checklist item, or a gating step that must be resolved first.
 * This is the "first missing question" rule that prevents re-asking answered items.
 */
export function nextChecklistItem(state) {
  if (!state.customer_verified) return "customer_verification";
  if (state.customer_available === false) return "callback";
  if (state.transfer_required) return "transfer";

  for (const entry of CHECKLIST) {
    if (!isItemAnswered(state, entry)) return entry.id;
    // The above-limit alternative is resolved immediately after the amount is captured,
    // before moving on to item 5.
    if (entry.id === "requested_loan_amount"
      && isLoanAboveMax(state.requested_loan_amount)
      && state.amount_alternative_status === "pending") {
      return "amount_alternative";
    }
  }
  return null;
}

/** Field-level list of what is still missing, for the UI checklist panel. */
export function missingFields(state) {
  const missing = [];
  for (const entry of CHECKLIST) {
    for (const field of entry.fields) {
      if (state[field] == null) missing.push(field);
    }
  }
  return missing;
}

/** Which of the seven items are answered, for progress display. */
export function checklistProgress(state) {
  return CHECKLIST.map((entry) => ({
    item: entry.item,
    id: entry.id,
    answered: isItemAnswered(state, entry),
    values: Object.fromEntries(entry.fields.map((f) => [f, state[f] ?? null])),
  }));
}

/**
 * The handoff gate. Every condition must hold before a senior-expert handoff is allowed.
 * Returns a reason on refusal so the UI can explain exactly what is blocking.
 */
export function canHandoff(state) {
  if (!state.customer_verified) return { ok: false, reason: "not_verified" };
  if (state.transfer_required) return { ok: false, reason: "transfer_flow" };
  if (state.disqualified) return { ok: false, reason: "disqualified" };
  if (state.customer_available === false) return { ok: false, reason: "callback_requested" };
  if (!isChecklistComplete(state)) return { ok: false, reason: "checklist_incomplete" };

  const verdict = evaluateDisqualification(state);
  if (verdict.disqualified) return { ok: false, reason: verdict.reason };

  // An above-limit request must have been explicitly accepted at ₹75 lakh.
  if (isLoanAboveMax(state.requested_loan_amount) && state.amount_alternative_status !== "accepted") {
    return { ok: false, reason: "amount_alternative_unresolved" };
  }
  return { ok: true, reason: null };
}

/** The amount that would actually be taken forward, after any cap adjustment. */
export function effectiveLoanAmount(state) {
  if (state.amount_alternative_status === "accepted") return MAX_LOAN;
  return state.requested_loan_amount;
}
