// The fact schema shared by both extractors (rules and LLM).
//
// Everything crossing the NLU boundary is validated against this schema before it can
// touch conversation state. Unknown keys, wrong types and out-of-vocabulary enum values
// are dropped rather than trusted — a malformed model response must never be able to
// invent an eligible answer.

export const PROPERTY_TYPES = ["residential", "commercial", "industrial", "agricultural"];
export const OWNERSHIP_VALUES = ["sole", "joint"];
export const DOCUMENT_VALUES = ["available", "unavailable", "photocopy_only"];
export const OCCUPATION_VALUES = ["salaried", "self_employed"];
export const INCOME_MODE_VALUES = ["bank", "cash"];

/** Smallest plausible rupee figure for a loan or a property valuation. */
const MIN_RUPEES = 10_000;
/** ₹1000 crore — anything larger is a transcription artefact, not a real answer. */
const MAX_RUPEES = 10_000_000_000;

const ENUM_FIELDS = {
  property_type: PROPERTY_TYPES,
  ownership_status: OWNERSHIP_VALUES,
  documents_available: DOCUMENT_VALUES,
  occupation: OCCUPATION_VALUES,
  income_mode: INCOME_MODE_VALUES,
};

// `ambiguous_amount` is internal: a rupee figure the rule extractor found with no
// nearby "worth"/"loan" cue. The state layer assigns it to whichever money field the
// pending question is actually asking about. The LLM never emits it, so it is absent
// from FACT_JSON_SCHEMA, but it must survive validation to reach the state layer.
const MONEY_FIELDS = ["requested_loan_amount", "market_value", "ambiguous_amount"];

const BOOLEAN_FIELDS = [
  "busy",
  "not_intended_customer",
  "asks_who_is_calling",
  "existing_property_loan",
  "emi_reduction_request",
  "asks_interest_rate",
  "asks_product_question",
  "correction",
  "refuses_to_continue",
  "confirms_identity",
  "unclear",
];

const STRING_FIELDS = ["callback_time", "product_question"];

/** Tri-state answer to the above-limit alternative offer. */
const ALTERNATIVE_VALUES = ["accepted", "declined"];

/**
 * Validates and normalises a raw fact object from any extractor.
 * @returns {{ facts: object, rejected: string[] }} rejected lists dropped keys for logging.
 */
export function validateFacts(raw) {
  const facts = {};
  const rejected = [];

  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { facts, rejected: ["<not-an-object>"] };
  }

  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue; // absent is not the same as false; skip silently

    if (key in ENUM_FIELDS) {
      if (typeof value === "string" && ENUM_FIELDS[key].includes(value)) facts[key] = value;
      else rejected.push(key);
      continue;
    }

    if (MONEY_FIELDS.includes(key)) {
      const n = typeof value === "number" ? value : Number.NaN;
      if (Number.isFinite(n) && n >= MIN_RUPEES && n <= MAX_RUPEES) facts[key] = Math.round(n);
      else rejected.push(key);
      continue;
    }

    if (key === "tenure_years") {
      const n = typeof value === "number" ? value : Number.NaN;
      // Accept any plausible tenure, including ineligible ones — the eligibility engine,
      // not the extractor, decides whether 2 or 16 years disqualifies.
      if (Number.isFinite(n) && n >= 1 && n <= 40) facts[key] = Math.round(n);
      else rejected.push(key);
      continue;
    }

    if (BOOLEAN_FIELDS.includes(key)) {
      if (typeof value === "boolean") {
        if (value) facts[key] = true; // only positive signals are carried forward
      } else rejected.push(key);
      continue;
    }

    if (key === "amount_alternative") {
      if (typeof value === "string" && ALTERNATIVE_VALUES.includes(value)) facts[key] = value;
      else rejected.push(key);
      continue;
    }

    if (STRING_FIELDS.includes(key)) {
      if (typeof value === "string" && value.trim() !== "") {
        facts[key] = value.trim().slice(0, 120);
      } else rejected.push(key);
      continue;
    }

    rejected.push(key); // unknown key — never forwarded
  }

  return { facts, rejected };
}

/**
 * JSON Schema handed to the model for structured extraction.
 * Mirrors validateFacts exactly; validateFacts remains the enforcement point.
 */
export const FACT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    property_type: { type: ["string", "null"], enum: [...PROPERTY_TYPES, null] },
    ownership_status: { type: ["string", "null"], enum: [...OWNERSHIP_VALUES, null] },
    documents_available: { type: ["string", "null"], enum: [...DOCUMENT_VALUES, null] },
    requested_loan_amount: {
      type: ["number", "null"],
      description: "Loan amount the customer asked to borrow, in rupees. Null unless clearly a loan request.",
    },
    market_value: {
      type: ["number", "null"],
      description: "Estimated current market value of the property, in rupees. Null unless clearly a valuation.",
    },
    occupation: { type: ["string", "null"], enum: [...OCCUPATION_VALUES, null] },
    income_mode: { type: ["string", "null"], enum: [...INCOME_MODE_VALUES, null] },
    tenure_years: {
      type: ["number", "null"],
      description: "Repayment tenure in years. On a correction, use the customer's latest clear value.",
    },
    confirms_identity: { type: ["boolean", "null"], description: "Customer confirms they are the named person." },
    not_intended_customer: { type: ["boolean", "null"], description: "Speaker says they are someone else or wrong number." },
    asks_who_is_calling: { type: ["boolean", "null"] },
    busy: { type: ["boolean", "null"], description: "Customer says they cannot talk now." },
    callback_time: { type: ["string", "null"], description: "Callback time exactly as the customer expressed it." },
    existing_property_loan: { type: ["boolean", "null"], description: "Already has a loan against this property." },
    emi_reduction_request: { type: ["boolean", "null"], description: "Wants to reduce an existing EMI." },
    amount_alternative: {
      type: ["string", "null"],
      enum: [...ALTERNATIVE_VALUES, null],
      description: "Only when answering the ₹75 lakh alternative-offer question.",
    },
    asks_interest_rate: { type: ["boolean", "null"] },
    asks_product_question: { type: ["boolean", "null"], description: "Any other product/company question." },
    product_question: { type: ["string", "null"], description: "The product question, verbatim." },
    correction: { type: ["boolean", "null"], description: "Customer is revising an earlier answer." },
    refuses_to_continue: { type: ["boolean", "null"] },
    unclear: { type: ["boolean", "null"], description: "Utterance is unintelligible or too ambiguous to extract." },
  },
  required: [],
};
