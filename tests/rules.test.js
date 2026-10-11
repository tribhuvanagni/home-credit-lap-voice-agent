// Deterministic business-rule and state-machine tests.
//
// Every test runs with forceRules: true, so the LLM is never called. The suite is
// therefore fully offline and deterministic — a pass here says the business rules are
// correct, and says nothing at all about whether the live voice platform works.

import { describe, it, expect, beforeEach } from "vitest";
import { createInitialState } from "../backend/src/engine/state.js";
import { advanceTurn } from "../backend/src/engine/turn.js";
import {
  MAX_LOAN,
  canHandoff,
  evaluateDisqualification,
  isChecklistComplete,
  nextChecklistItem,
} from "../backend/src/engine/eligibility.js";
import { clearAll } from "../backend/src/store/memory.js";

/** Drives a conversation through a list of utterances using the rule extractor only. */
async function runConversation(utterances, callConfig = {}) {
  let state = createInitialState({ customer_name: "Rahul Sharma", ...callConfig });
  const history = [];
  const replies = [];

  for (const utterance of utterances) {
    const result = await advanceTurn({ state, utterance, history, forceRules: true });
    history.push({ role: "customer", text: utterance });
    history.push({ role: "agent", text: result.reply });
    replies.push(result.reply);
    state = result.state;
  }
  return { state, replies, history };
}

/** Utterances that clear verification and items 1–3. */
const THROUGH_DOCUMENTS = [
  "Yes, this is Rahul speaking.",
  "It's a residential flat.",
  "It's solely in my name.",
  "Yes, the original documents are available at home.",
];

beforeEach(() => clearAll());

describe("1. Fully eligible customer", () => {
  it("reaches a qualified handoff with all seven items captured", async () => {
    const { state } = await runConversation([
      ...THROUGH_DOCUMENTS,
      "I'm looking for about 50 lakhs.",
      "I'm salaried and my salary comes into my bank account.",
      "The property is worth around 1.2 crore.",
      "Let's say 10 years.",
    ]);

    expect(state.qualification_status).toBe("qualified");
    expect(isChecklistComplete(state)).toBe(true);
    expect(state.handoff_status).toBe("simulated");
    expect(state.property_type).toBe("residential");
    expect(state.requested_loan_amount).toBe(5_000_000);
    expect(state.market_value).toBe(12_000_000);
    expect(state.tenure_years).toBe(10);
  });
});

describe("2. Agricultural property", () => {
  it("disqualifies immediately and asks nothing further", async () => {
    const { state, replies } = await runConversation([
      "Yes, speaking.",
      "It's agricultural land, about two acres.",
    ]);

    expect(state.qualification_status).toBe("disqualified");
    expect(state.disqualification_reason).toBe("agricultural_property_not_eligible");
    expect(state.ownership_status).toBeNull(); // item 2 was never asked
    expect(replies.at(-1)).toMatch(/agricultural/i);
    expect(replies.at(-1)).toMatch(/this specific offer at this time/i);
  });
});

describe("3. Sole ownership", () => {
  it("is eligible", async () => {
    const { state } = await runConversation([...THROUGH_DOCUMENTS]);
    expect(state.ownership_status).toBe("sole");
    expect(state.disqualified).toBe(false);
  });
});

describe("4. Joint ownership", () => {
  it("is eligible and must not disqualify", async () => {
    const { state } = await runConversation([
      "Yes, that's me.",
      "Residential house, jointly owned with my wife.",
    ]);
    expect(state.ownership_status).toBe("joint");
    expect(state.disqualified).toBe(false);
    expect(state.qualification_status).toBe("in_progress");
  });
});

describe("5. Original documents available", () => {
  it("accepts originals kept at home", async () => {
    const { state } = await runConversation([...THROUGH_DOCUMENTS]);
    expect(state.documents_available).toBe("available");
    expect(state.disqualified).toBe(false);
  });
});

describe("6. Photocopies only", () => {
  it("disqualifies — copies do not satisfy the requirement", async () => {
    const { state, replies } = await runConversation([
      "Yes, speaking.",
      "Residential flat.",
      "Sole ownership.",
      "I only have photocopies, the originals are with my brother.",
    ]);
    expect(state.documents_available).toBe("photocopy_only");
    expect(state.qualification_status).toBe("disqualified");
    expect(state.disqualification_reason).toBe("original_documents_required");
    expect(replies.at(-1)).toMatch(/photocopies/i);
  });
});

describe("7. Documents unavailable", () => {
  it("disqualifies", async () => {
    const { state } = await runConversation([
      "Yes, speaking.",
      "Commercial shop.",
      "Sole owner.",
      "No, I don't have the original documents.",
    ]);
    expect(state.documents_available).toBe("unavailable");
    expect(state.disqualification_reason).toBe("original_documents_required");
  });
});

describe("8. Loan amount below ₹75 lakh", () => {
  it("is eligible and opens no alternative-offer question", async () => {
    const { state } = await runConversation([...THROUGH_DOCUMENTS, "I need 50 lakhs."]);
    expect(state.requested_loan_amount).toBe(5_000_000);
    expect(state.amount_alternative_status).toBeNull();
    expect(state.disqualified).toBe(false);
  });
});

describe("9. Loan amount exactly ₹75 lakh", () => {
  it("is eligible — the boundary is inclusive", async () => {
    const { state } = await runConversation([...THROUGH_DOCUMENTS, "I need exactly 75 lakhs."]);
    expect(state.requested_loan_amount).toBe(MAX_LOAN);
    expect(state.amount_alternative_status).toBeNull();
    expect(state.disqualified).toBe(false);
    expect(nextChecklistItem(state)).toBe("occupation_income");
  });
});

describe("10. Above ₹75 lakh, then accepted", () => {
  it("stores the adjusted amount and continues the checklist", async () => {
    const { state, replies } = await runConversation([
      ...THROUGH_DOCUMENTS,
      "I was hoping for 90 lakhs.",
      "Yes, let's proceed with 75 lakhs.",
    ]);
    expect(replies.at(-2)).toMatch(/75/);
    expect(state.amount_alternative_status).toBe("accepted");
    expect(state.adjusted_loan_amount).toBe(MAX_LOAN);
    expect(state.qualification_status).toBe("in_progress");
    expect(nextChecklistItem(state)).toBe("occupation_income");
  });
});

describe("11. Above ₹75 lakh, then declined", () => {
  it("ends the call politely as declined", async () => {
    const { state } = await runConversation([
      ...THROUGH_DOCUMENTS,
      "I need 90 lakhs.",
      "No, that's not enough for me.",
    ]);
    expect(state.amount_alternative_status).toBe("declined");
    expect(state.qualification_status).toBe("declined");
    expect(state.termination_reason).toBe("amount_alternative_declined");
  });
});

describe("12. Above-limit alternative still pending", () => {
  it("is not treated as accepted and blocks handoff", async () => {
    const { state } = await runConversation([...THROUGH_DOCUMENTS, "I need 90 lakhs."]);
    expect(state.amount_alternative_status).toBe("pending");
    expect(state.adjusted_loan_amount).toBeNull();
    expect(state.qualification_status).toBe("in_progress");
    expect(state.current_checklist_item).toBe("amount_alternative");
    expect(canHandoff(state).ok).toBe(false);
  });
});

describe("13. Salaried with bank income", () => {
  it("is eligible", async () => {
    const { state } = await runConversation([
      ...THROUGH_DOCUMENTS,
      "40 lakhs.",
      "I'm salaried, salary is credited to my bank account.",
    ]);
    expect(state.occupation).toBe("salaried");
    expect(state.income_mode).toBe("bank");
    expect(state.disqualified).toBe(false);
  });
});

describe("14. Self-employed with bank income", () => {
  it("is eligible", async () => {
    const { state } = await runConversation([
      ...THROUGH_DOCUMENTS,
      "40 lakhs.",
      "I run a small business and the income comes into my bank account.",
    ]);
    expect(state.occupation).toBe("self_employed");
    expect(state.income_mode).toBe("bank");
    expect(state.disqualified).toBe(false);
  });
});

describe("15. Cash income", () => {
  it("disqualifies regardless of occupation", async () => {
    const { state, replies } = await runConversation([
      ...THROUGH_DOCUMENTS,
      "30 lakhs.",
      "I'm self-employed and I mostly get paid in cash.",
    ]);
    expect(state.income_mode).toBe("cash");
    expect(state.qualification_status).toBe("disqualified");
    expect(state.disqualification_reason).toBe("cash_income_not_eligible");
    expect(replies.at(-1)).toMatch(/bank account/i);
    expect(state.market_value).toBeNull(); // items 6 and 7 were never asked
  });
});

describe("16-19. Tenure boundaries", () => {
  const upToTenure = [
    ...THROUGH_DOCUMENTS,
    "25 lakhs.",
    "Salaried, paid into my bank.",
    "Worth about 80 lakhs.",
  ];

  it("16. two years disqualifies", async () => {
    const { state } = await runConversation([...upToTenure, "Just 2 years."]);
    expect(state.tenure_years).toBe(2);
    expect(state.disqualification_reason).toBe("tenure_out_of_range");
  });

  it("17. three years is eligible (inclusive lower bound)", async () => {
    const { state } = await runConversation([...upToTenure, "3 years."]);
    expect(state.tenure_years).toBe(3);
    expect(state.qualification_status).toBe("qualified");
  });

  it("18. fifteen years is eligible (inclusive upper bound)", async () => {
    const { state } = await runConversation([...upToTenure, "15 years."]);
    expect(state.tenure_years).toBe(15);
    expect(state.qualification_status).toBe("qualified");
  });

  it("19. sixteen years disqualifies", async () => {
    const { state } = await runConversation([...upToTenure, "16 years please."]);
    expect(state.tenure_years).toBe(16);
    expect(state.disqualification_reason).toBe("tenure_out_of_range");
  });
});

describe("20. Existing property loan", () => {
  it("routes to the loan-transfer specialist and stops the checklist", async () => {
    const { state, replies } = await runConversation([
      "Yes, speaking.",
      "I already have a loan running on this property.",
    ]);
    expect(state.existing_property_loan).toBe(true);
    expect(state.transfer_required).toBe(true);
    expect(state.qualification_status).toBe("transfer");
    expect(state.termination_reason).toBe("existing_loan_transfer");
    expect(replies.at(-1)).toMatch(/transfer specialist/i);
    expect(state.property_type).toBeNull();
  });
});

describe("21. EMI reduction request", () => {
  it("routes to the loan-transfer specialist", async () => {
    const { state, replies } = await runConversation([
      "Yes, that's me.",
      "Actually I just want to reduce my current EMI.",
    ]);
    expect(state.emi_reduction_request).toBe(true);
    expect(state.qualification_status).toBe("transfer");
    expect(state.termination_reason).toBe("emi_reduction_transfer");
    expect(replies.at(-1)).toMatch(/transfer specialist/i);
  });
});

describe("22. Busy customer", () => {
  it("captures a callback time, ends the call, and presents no offer", async () => {
    const { state, replies } = await runConversation([
      "I'm driving right now, can you call me tomorrow evening?",
    ]);
    expect(state.customer_available).toBe(false);
    expect(state.callback_requested).toBe(true);
    expect(state.callback_time).toMatch(/tomorrow evening/i);
    expect(state.qualification_status).toBe("callback");
    expect(state.offer_presented).toBe(false);
    expect(replies.at(-1)).not.toMatch(/75/); // the offer was never pitched
  });

  it("asks for a time when none was given", async () => {
    const { state, replies } = await runConversation(["Sorry, I'm really busy right now."]);
    expect(state.callback_requested).toBe(true);
    expect(state.callback_time).toBeNull();
    expect(replies.at(-1)).toMatch(/convenient time/i);
  });
});

describe("23. Multiple answers out of order", () => {
  it("captures three facts from one utterance and asks only the earliest missing item", async () => {
    const { state, replies } = await runConversation([
      "Yes, speaking.",
      "It's a residential house, jointly owned with my wife, worth around 1.2 crore.",
    ]);
    expect(state.property_type).toBe("residential");
    expect(state.ownership_status).toBe("joint");
    expect(state.market_value).toBe(12_000_000);
    expect(state.current_checklist_item).toBe("documents_available");
    expect(replies.at(-1)).toMatch(/original property documents/i);
    expect(replies.at(-1)).not.toMatch(/market value/i);
    expect(replies.at(-1)).not.toMatch(/jointly/i);
  });
});

describe("24. Customer corrects a previous answer", () => {
  it("uses the latest value and keeps an audit trail", async () => {
    const { state } = await runConversation([
      ...THROUGH_DOCUMENTS,
      "45 lakhs.",
      "Salaried, salary goes to my bank.",
      "Worth about 1 crore.",
      "10 years — actually, make that 12.",
    ]);
    expect(state.tenure_years).toBe(12);
    expect(state.qualification_status).toBe("qualified");
    const tenureChanges = state.answer_history.filter((e) => e.field === "tenure_years");
    expect(tenureChanges.length).toBeGreaterThanOrEqual(1);
    expect(tenureChanges.at(-1).to).toBe(12);
  });

  it("does not disqualify on a superseded out-of-range answer", async () => {
    const { state } = await runConversation([
      ...THROUGH_DOCUMENTS,
      "45 lakhs.",
      "Salaried, bank.",
      "1 crore.",
      "20 years, actually make that 10.",
    ]);
    expect(state.tenure_years).toBe(10);
    expect(state.disqualified).toBe(false);
  });
});

describe("25. Customer interrupts with a product question", () => {
  it("answers briefly, fabricates nothing, and returns to the pending item", async () => {
    const { state, replies } = await runConversation([
      "Yes, speaking.",
      "Before that, what interest rate will I get?",
    ]);
    const reply = replies.at(-1);
    expect(reply).toMatch(/senior loan expert/i);
    expect(reply).not.toMatch(/\d+(\.\d+)?\s*%/); // no invented rate
    expect(reply).toMatch(/type of property/i); // bridged back to item 1
    expect(state.qualification_status).toBe("in_progress");
    expect(state.disqualified).toBe(false);
  });
});

describe("26. Missing interest-rate information", () => {
  it("always defers the rate, even when a knowledge base is supplied", async () => {
    const { replies } = await runConversation(
      ["Yes, speaking.", "What's the rate of interest?"],
      { additional_context_from_rag: "Loan Against Property is available up to ₹75,00,000." },
    );
    expect(replies.at(-1)).toMatch(/senior loan expert/i);
    expect(replies.at(-1)).not.toMatch(/\d+(\.\d+)?\s*%/);
  });
});

describe("27. Missing RAG context", () => {
  it("says it does not know rather than inventing an answer", async () => {
    const { replies } = await runConversation([
      "Yes, speaking.",
      "Where is your nearest branch?",
    ]);
    expect(replies.at(-1)).toMatch(/senior loan expert|don't have that information/i);
  });
});

describe("28. Ambiguous document availability", () => {
  it("does not record an answer it cannot establish", async () => {
    const { state } = await runConversation([
      "Yes, speaking.",
      "Residential flat.",
      "Sole ownership.",
      "Hmm, I'm not sure where they are right now.",
    ]);
    expect(state.documents_available).toBeNull();
    expect(state.disqualified).toBe(false);
    expect(state.current_checklist_item).toBe("documents_available");
  });
});

describe("29. Unverified customer", () => {
  it("stays at the verification gate and presents no offer", async () => {
    const { state, replies } = await runConversation(["Who is this calling?"]);
    expect(state.customer_verified).toBe(false);
    expect(state.current_checklist_item).toBe("customer_verification");
    expect(state.offer_presented).toBe(false);
    expect(replies.at(-1)).toMatch(/Home Credit/);
    expect(replies.at(-1)).toMatch(/Rahul Sharma/);
  });

  it("does not proceed as verified when the wrong person answers", async () => {
    const { state, replies } = await runConversation(["Sorry, wrong number, I'm not Rahul."]);
    expect(state.customer_verified).toBe(false);
    expect(state.qualification_status).toBe("disqualified");
    expect(state.disqualification_reason).toBe("not_intended_customer");
    expect(replies.at(-1)).not.toMatch(/75,00,000|75 lakh/i);
  });
});

describe("30. Malformed extraction output", () => {
  it("drops invalid fields instead of trusting them", async () => {
    const { validateFacts } = await import("../backend/src/nlu/schema.js");
    const { facts, rejected } = validateFacts({
      property_type: "spaceship",          // not in the enum
      tenure_years: "ten",                 // wrong type
      requested_loan_amount: -5,           // out of range
      income_mode: "bank",                 // valid
      made_up_field: true,                 // unknown key
      documents_available: "available",    // valid
    });
    expect(facts).toEqual({ income_mode: "bank", documents_available: "available" });
    expect(rejected).toContain("property_type");
    expect(rejected).toContain("tenure_years");
    expect(rejected).toContain("requested_loan_amount");
    expect(rejected).toContain("made_up_field");
  });

  it("never converts missing data into an eligible answer", async () => {
    const { validateFacts } = await import("../backend/src/nlu/schema.js");
    const { facts } = validateFacts({ property_type: null, income_mode: undefined });
    expect(facts).toEqual({});
    expect(evaluateDisqualification({ ...createInitialState(), ...facts }).disqualified).toBe(false);
  });
});

describe("32. Attempted premature handoff", () => {
  it("blocks handoff until every item is answered", async () => {
    const { state } = await runConversation([
      ...THROUGH_DOCUMENTS,
      "40 lakhs.",
      "Salaried, bank account.",
      "Worth 1 crore.",
    ]);
    // Six of seven items answered; tenure outstanding.
    expect(isChecklistComplete(state)).toBe(false);
    expect(canHandoff(state)).toEqual({ ok: false, reason: "checklist_incomplete" });
    expect(state.qualification_status).toBe("in_progress");
    expect(state.handoff_status).toBe("not_started");
  });

  it("blocks handoff for an unverified customer", () => {
    const state = { ...createInitialState(), customer_verified: false };
    expect(canHandoff(state)).toEqual({ ok: false, reason: "not_verified" });
  });
});

describe("33. Attempted continuation after disqualification", () => {
  it("ignores further utterances and does not reopen the call", async () => {
    const { state } = await runConversation([
      "Yes, speaking.",
      "It's agricultural land.",
      "Wait, actually it's residential — can we continue?",
      "I need 40 lakhs over 10 years.",
    ]);
    expect(state.qualification_status).toBe("disqualified");
    expect(state.property_type).toBe("agricultural"); // never overwritten
    expect(state.requested_loan_amount).toBeNull();
    expect(state.tenure_years).toBeNull();
  });

  it("ignores further utterances after a transfer routing", async () => {
    const { state, replies } = await runConversation([
      "Yes, speaking.",
      "I already have a loan on this property.",
      "Okay but can you still check the fresh loan for me?",
    ]);
    expect(state.qualification_status).toBe("transfer");
    expect(replies.at(-1)).toMatch(/already concluded/i);
  });
});

describe("34. Conversation history with previously answered questions", () => {
  it("never re-asks an item answered earlier, even across a diversion", async () => {
    const { state, replies } = await runConversation([
      "Yes, speaking.",
      "It's a commercial shop, I'm the sole owner.",
      "Hold on — what documents will you need?",
      "Yes, originals are available.",
    ]);
    const asked = replies.join(" | ");
    // Item 1 is asked once, with the offer. The customer then answers items 1 and 2 in a
    // single utterance, so neither may be asked again — that is the requirement here.
    expect(asked.match(/what type of property/gi)).toHaveLength(1);
    expect(asked.match(/solely in your name/gi)).toBeNull();
    expect(state.property_type).toBe("commercial");
    expect(state.ownership_status).toBe("sole");
    expect(state.documents_available).toBe("available");
    expect(state.current_checklist_item).toBe("requested_loan_amount");
  });
});

describe("35. Hindi and English configurations", () => {
  it("conducts the call in Hindi when configured, with female agent forms", async () => {
    const { state, replies } = await runConversation(
      [
        "Haan ji, main Rahul bol raha hoon.",
        "Residential flat hai.",
        "Sirf mere naam par hai.",
        "Haan, original documents ghar par available hain.",
        "40 lakh chahiye.",
        "Main salaried hoon, salary bank account mein aati hai.",
        "Property ki value lagbhag 1 crore hai.",
        "10 saal.",
      ],
      { language_to_speak: "Hindi", agent_name: "Priya", agent_gender: "female" },
    );
    expect(state.qualification_status).toBe("qualified");
    expect(state.tenure_years).toBe(10);
    expect(state.requested_loan_amount).toBe(4_000_000);
    const all = replies.join(" ");
    expect(all).toMatch(/dhanyavaad|senior loan expert/i);
    // Female agent: first-person future takes -ungi, never -unga.
    expect(all).toMatch(/poochungi/);
    expect(all).not.toMatch(/poochunga/);
  });

  it("uses gendered Hindi forms in the opening greeting", async () => {
    const { greeting } = await import("../backend/src/engine/response.js");
    const female = greeting(createInitialState({
      customer_name: "Rahul Sharma", language_to_speak: "Hindi", agent_gender: "female",
    }));
    const male = greeting(createInitialState({
      customer_name: "Rahul Sharma", language_to_speak: "Hindi", agent_gender: "male",
    }));
    expect(female).toMatch(/rahi hoon/);
    expect(female).not.toMatch(/raha hoon/);
    expect(male).toMatch(/raha hoon/);
    expect(male).not.toMatch(/rahi hoon/);
  });

  it("conducts the call in English when configured", async () => {
    const { replies } = await runConversation(["Yes, speaking."], {
      language_to_speak: "English",
    });
    expect(replies.at(-1)).toMatch(/valued existing customers/i);
  });
});

describe("Market value has no invented threshold", () => {
  it("qualifies a customer whose property value is modest", async () => {
    const { state } = await runConversation([
      ...THROUGH_DOCUMENTS,
      "I need 10 lakhs.",
      "Salaried, bank account.",
      "The property is worth about 18 lakhs.",
      "5 years.",
    ]);
    expect(state.market_value).toBe(1_800_000);
    expect(state.qualification_status).toBe("qualified");
  });
});

describe("Amount attribution", () => {
  it("does not mistake monthly income for a loan amount or a valuation", async () => {
    const { state } = await runConversation([
      "Yes, speaking.",
      "I earn 80,000 a month.",
    ]);
    expect(state.requested_loan_amount).toBeNull();
    expect(state.market_value).toBeNull();
  });

  it("separates loan amount from market value in a single utterance", async () => {
    const { state } = await runConversation([
      ...THROUGH_DOCUMENTS,
      "I need a loan of 40 lakhs, the property is worth 1 crore.",
    ]);
    expect(state.requested_loan_amount).toBe(4_000_000);
    expect(state.market_value).toBe(10_000_000);
  });
});

describe("Refusal", () => {
  it("accepts a refusal immediately without re-pitching", async () => {
    const { state, replies } = await runConversation([
      "Yes, speaking.",
      "I'm not interested, please don't call again.",
    ]);
    expect(state.qualification_status).toBe("declined");
    expect(state.termination_reason).toBe("customer_declined_offer");
    expect(replies.at(-1)).not.toMatch(/75 lakh/i);
  });
});
