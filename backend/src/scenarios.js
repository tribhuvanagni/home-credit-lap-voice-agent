// Scripted test scenarios.
//
// Each scenario is a sequence of customer utterances written the way a real customer
// would speak — full sentences, fillers, corrections and interruptions — plus the
// outcome it must produce. The frontend offers them as one-click test runs and the
// automated suite asserts against the same definitions, so the UI and the tests can
// never drift apart.

export const SCENARIOS = [
  {
    id: "eligible_full",
    label: "Fully eligible customer",
    hint: "Residential · sole · originals · ₹50L · salaried bank · ₹1.2cr · 10 years",
    expect: { status: "qualified", handoff_status: "simulated" },
    utterances: [
      "Yes, this is Rahul speaking.",
      "It's a residential flat.",
      "It's solely in my name.",
      "Yes, I have the original documents at home.",
      "I'm looking for about 50 lakhs.",
      "I'm salaried, and my salary comes into my bank account.",
      "The property is worth around 1.2 crore.",
      "Let's say 10 years.",
    ],
  },
  {
    id: "agricultural",
    label: "Agricultural property",
    hint: "Immediate disqualification on item 1",
    expect: { status: "disqualified", disqualification_reason: "agricultural_property_not_eligible" },
    utterances: ["Yes, speaking.", "It's agricultural land, about two acres."],
  },
  {
    id: "joint_ownership",
    label: "Joint ownership accepted",
    hint: "Joint must NOT disqualify",
    expect: { status: "qualified" },
    utterances: [
      "Yes, that's me.",
      "It's a residential house, jointly owned with my wife, worth around 1.2 crore.",
      "The original papers are available at home.",
      "I need 40 lakhs.",
      "I run a small business and the income comes into my bank account.",
      "12 years.",
    ],
  },
  {
    id: "photocopy_only",
    label: "Photocopies only",
    hint: "Originals required — disqualify",
    expect: { status: "disqualified", disqualification_reason: "original_documents_required" },
    utterances: [
      "Yes, speaking.",
      "Residential flat.",
      "Sole ownership.",
      "I only have photocopies, the originals are with my brother.",
    ],
  },
  {
    id: "documents_unavailable",
    label: "Documents unavailable",
    hint: "Originals cannot be produced — disqualify",
    expect: { status: "disqualified", disqualification_reason: "original_documents_required" },
    utterances: [
      "Yes, this is me.",
      "Commercial shop.",
      "Sole owner.",
      "No, I don't have the original documents.",
    ],
  },
  {
    id: "amount_exactly_max",
    label: "Loan exactly ₹75 lakh",
    hint: "Boundary is inclusive — no alternative offer",
    expect: { status: "qualified" },
    utterances: [
      "Yes, speaking.",
      "Industrial — it's a small factory unit.",
      "Sole ownership.",
      "Originals are available.",
      "I need exactly 75 lakhs.",
      "Self-employed, income comes to my bank.",
      "The unit is worth about 2 crore.",
      "15 years.",
    ],
  },
  {
    id: "amount_above_accept",
    label: "₹90 lakh → accepts ₹75 lakh",
    hint: "Cap explained, customer proceeds",
    expect: { status: "qualified", adjusted_loan_amount: 7500000 },
    utterances: [
      "Yes, that's right.",
      "Residential apartment.",
      "Joint with my husband.",
      "Yes, originals are with us.",
      "I was hoping for 90 lakhs.",
      "Yes, let's proceed with 75 lakhs.",
      "Salaried, bank account.",
      "Around 1.5 crore.",
      "10 years.",
    ],
  },
  {
    id: "amount_above_decline",
    label: "₹90 lakh → declines ₹75 lakh",
    hint: "Politely ends as declined",
    expect: { status: "declined", termination_reason: "amount_alternative_declined" },
    utterances: [
      "Yes, speaking.",
      "Residential house.",
      "Sole.",
      "Originals available.",
      "I need 90 lakhs.",
      "No, that's not enough for me.",
    ],
  },
  {
    id: "amount_above_pending",
    label: "₹90 lakh → still pending",
    hint: "Must not be treated as accepted",
    expect: { status: "in_progress", current_checklist_item: "amount_alternative" },
    utterances: [
      "Yes, speaking.",
      "Residential.",
      "Sole.",
      "Originals available.",
      "I need 90 lakhs.",
    ],
  },
  {
    id: "cash_income",
    label: "Cash income",
    hint: "Disqualify regardless of occupation",
    expect: { status: "disqualified", disqualification_reason: "cash_income_not_eligible" },
    utterances: [
      "Yes.",
      "Commercial shop.",
      "Sole ownership.",
      "Originals are ready.",
      "30 lakhs.",
      "I'm self-employed and I mostly get paid in cash.",
    ],
  },
  {
    id: "tenure_two_years",
    label: "Tenure 2 years",
    hint: "Below the 3-year minimum",
    expect: { status: "disqualified", disqualification_reason: "tenure_out_of_range" },
    utterances: [
      "Yes, speaking.",
      "Residential flat, sole ownership, originals available.",
      "25 lakhs.",
      "Salaried, bank.",
      "Worth about 80 lakhs.",
      "Just 2 years.",
    ],
  },
  {
    id: "tenure_sixteen_years",
    label: "Tenure 16 years",
    hint: "Above the 15-year maximum",
    expect: { status: "disqualified", disqualification_reason: "tenure_out_of_range" },
    utterances: [
      "Yes, speaking.",
      "Residential flat, sole ownership, originals available.",
      "25 lakhs.",
      "Salaried, bank.",
      "Worth about 80 lakhs.",
      "16 years please.",
    ],
  },
  {
    id: "existing_loan",
    label: "Existing property loan",
    hint: "Routes to loan-transfer specialist",
    expect: { status: "transfer", termination_reason: "existing_loan_transfer" },
    utterances: ["Yes, speaking.", "I already have a loan running on this property."],
  },
  {
    id: "emi_reduction",
    label: "EMI reduction request",
    hint: "Routes to loan-transfer specialist",
    expect: { status: "transfer", termination_reason: "emi_reduction_transfer" },
    utterances: ["Yes, that's me.", "Actually I just want to reduce my current EMI."],
  },
  {
    id: "busy_callback",
    label: "Busy customer",
    hint: "Captures callback time and ends",
    expect: { status: "callback", callback_requested: true },
    utterances: ["I'm driving right now, can you call me tomorrow evening?"],
  },
  {
    id: "out_of_order",
    label: "Multiple answers, out of order",
    hint: "Three facts in one utterance, none re-asked",
    expect: { status: "in_progress" },
    utterances: [
      "Yes, speaking.",
      "It's a residential house, jointly owned with my wife, worth around 1.2 crore.",
    ],
  },
  {
    id: "correction",
    label: "Customer corrects an answer",
    hint: "\"10 years, actually make that 12\" → 12",
    expect: { status: "qualified", tenure_years: 12 },
    utterances: [
      "Yes, speaking.",
      "Residential, sole ownership, originals available.",
      "45 lakhs.",
      "Salaried, salary goes to my bank.",
      "Worth about 1 crore.",
      "10 years — actually, make that 12.",
    ],
  },
  {
    id: "interest_rate_diversion",
    label: "Interrupts asking the interest rate",
    hint: "Defers, never fabricates, returns to the checklist",
    expect: { status: "in_progress" },
    utterances: [
      "Yes, speaking.",
      "Before that, what interest rate will I get?",
    ],
  },
  {
    id: "not_intended_customer",
    label: "Wrong person answers",
    hint: "Does not proceed as verified",
    expect: { status: "disqualified", disqualification_reason: "not_intended_customer" },
    utterances: ["Sorry, wrong number, I'm not Rahul."],
  },
  {
    id: "hindi_eligible",
    label: "Hindi call, eligible",
    hint: "Configured language is respected throughout",
    config: { language_to_speak: "Hindi", agent_name: "Priya", agent_gender: "female" },
    expect: { status: "qualified" },
    utterances: [
      "Haan ji, main Rahul bol raha hoon.",
      "Residential flat hai.",
      "Sirf mere naam par hai.",
      "Haan, original documents ghar par available hain.",
      "40 lakh chahiye.",
      "Main salaried hoon, salary bank account mein aati hai.",
      "Property ki value lagbhag 1 crore hai.",
      "10 saal.",
    ],
  },
];

export function getScenario(id) {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

/** Scenario metadata for the UI; utterances are included so runs are transparent. */
export function listScenarios() {
  return SCENARIOS.map(({ id, label, hint, expect, utterances, config: cfg }) => ({
    id,
    label,
    hint,
    expect,
    turns: utterances.length,
    utterances,
    config: cfg ?? null,
  }));
}
