// Agent response generation.
//
// Copy is templated rather than model-generated. For a compliance-sensitive outbound
// call this is the safer trade: the agent can never improvise an interest rate, a fee or
// an approval, because no code path exists that would let it.
//
// Hindi is a first-class language here, not a translation afterthought: `agent_gender`
// changes Hindi verb conjugation, so the gendered forms are built into the catalogue.

import { MAX_LOAN, effectiveLoanAmount } from "./eligibility.js";
import { retrieve } from "../rag/knowledge.js";

/** Formats rupees the way an Indian customer would hear them spoken. */
export function formatINR(amount) {
  if (amount == null) return "—";
  if (amount >= 10_000_000) {
    const crore = amount / 10_000_000;
    return `₹${Number.isInteger(crore) ? crore : crore.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} crore`;
  }
  if (amount >= 100_000) {
    const lakh = amount / 100_000;
    return `₹${Number.isInteger(lakh) ? lakh : lakh.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} lakh`;
  }
  return `₹${amount.toLocaleString("en-IN")}`;
}

function isHindi(state) {
  return state.language_to_speak === "Hindi";
}

/** Hindi first-person present tense differs by speaker gender. */
function hindiSpeaking(state) {
  return state.agent_gender === "female" ? "bol rahi hoon" : "bol raha hoon";
}

/** Hindi first-person future tense, also gendered. */
function hindiWill(state, verb) {
  const suffix = state.agent_gender === "female" ? "ungi" : "unga";
  return `${verb}${suffix}`;
}

const QUESTIONS = {
  English: {
    property_type: "Could you tell me what type of property it is — residential, commercial, industrial, or agricultural?",
    ownership_status: "Is the property solely in your name, or is it jointly owned?",
    documents_available: "Do you have the original property documents available for verification?",
    requested_loan_amount: "How much loan amount are you looking for?",
    occupation_income_both: "Could you tell me your occupation — salaried or self-employed — and whether your income comes into your bank account or in cash?",
    occupation_only: "And are you salaried or self-employed?",
    income_mode_only: "And is your income received in your bank account, or in cash?",
    market_value: "Approximately what is the current market value of the property?",
    tenure_years: "And over how many years would you like to repay the loan?",
    amount_alternative: `This offer is available for up to ${formatINR(MAX_LOAN)}. Would you like to proceed with the maximum eligible amount of ${formatINR(MAX_LOAN)}?`,
  },
  Hindi: {
    property_type: "Aap bata sakte hain property kis type ki hai — residential, commercial, industrial, ya agricultural?",
    ownership_status: "Property sirf aapke naam par hai, ya joint ownership mein hai?",
    documents_available: "Kya aapke paas property ke original documents verification ke liye available hain?",
    requested_loan_amount: "Aap kitne loan amount ki talaash mein hain?",
    occupation_income_both: "Aap bata sakte hain aapka occupation kya hai — salaried ya self-employed — aur aapki income bank account mein aati hai ya cash mein?",
    occupation_only: "Aap salaried hain ya self-employed?",
    income_mode_only: "Aapki income bank account mein aati hai ya cash mein?",
    market_value: "Property ki current market value approximately kitni hogi?",
    tenure_years: "Aap kitne saal mein loan repay karna chahenge?",
    amount_alternative: `Yeh offer ${formatINR(MAX_LOAN)} tak available hai. Kya aap maximum eligible amount ${formatINR(MAX_LOAN)} ke saath aage badhna chahenge?`,
  },
};

/** The question for the current checklist item, respecting partially-answered item 5. */
export function questionFor(state) {
  const lang = isHindi(state) ? "Hindi" : "English";
  const q = QUESTIONS[lang];

  switch (state.current_checklist_item) {
    case "property_type": return q.property_type;
    case "ownership_status": return q.ownership_status;
    case "documents_available": return q.documents_available;
    case "requested_loan_amount": return q.requested_loan_amount;
    case "occupation_income":
      if (state.occupation == null && state.income_mode == null) return q.occupation_income_both;
      if (state.occupation == null) return q.occupation_only;
      return q.income_mode_only;
    case "market_value": return q.market_value;
    case "tenure_years": return q.tenure_years;
    case "amount_alternative": return q.amount_alternative;
    default: return "";
  }
}

/** Opening line of the call. */
export function greeting(state) {
  if (isHindi(state)) {
    return `Namaste, kya main ${state.customer_name} se baat kar ${state.agent_gender === "female" ? "rahi" : "raha"} hoon? Main ${state.agent_name}, ${state.company_name} se ${hindiSpeaking(state)}.`;
  }
  return `Hello, may I please speak with ${state.customer_name}? This is ${state.agent_name} calling from ${state.company_name}.`;
}

function offerPresentation(state) {
  if (isHindi(state)) {
    return `Dhanyavaad, ${state.customer_name} ji. Aap humare valued customer hain, isliye hum aapko ek special Loan Against Property offer ke baare mein bata rahe hain — ${formatINR(MAX_LOAN)} tak. Main kuch chhote sawaal ${hindiWill(state, "pooch")} yeh dekhne ke liye ki offer aapke liye suitable hai ya nahi.`;
  }
  return `Thank you for confirming, ${state.customer_name}. As one of our valued existing customers, you may be eligible for a special Loan Against Property offer of up to ${formatINR(MAX_LOAN)}. I'd just like to ask a few quick questions to check whether this offer is suitable for you.`;
}

function disqualificationMessage(state) {
  const hindi = isHindi(state);
  const closing = hindi
    ? "Is specific offer ke criteria aap abhi poore nahi karte. Aapke samay ke liye dhanyavaad."
    : "You don't meet the criteria for this specific offer at this time. Thank you for your time.";

  const explanations = {
    agricultural_property_not_eligible: hindi
      ? "Jaankari ke liye dhanyavaad. Yeh offer agricultural property par available nahi hai."
      : "Thank you for letting me know. This particular offer isn't available for agricultural property.",
    original_documents_required: hindi
      ? "Jaankari ke liye dhanyavaad. Is offer ke liye original property documents verification ke liye available hona zaroori hai — photocopies se kaam nahi chalega."
      : "Thank you for confirming. This offer requires the original property documents to be available for verification, and photocopies alone aren't sufficient.",
    cash_income_not_eligible: hindi
      ? "Batane ke liye dhanyavaad. Is offer ke liye income bank account mein aana zaroori hai."
      : "Thank you for sharing that. This offer requires income to be received in a bank account.",
    tenure_out_of_range: hindi
      ? "Jaankari ke liye dhanyavaad. Is offer ke liye repayment tenure 3 se 15 saal ke beech hona chahiye."
      : "Thank you for that. The eligible repayment tenure for this offer is between 3 and 15 years.",
    not_intended_customer: hindi
      ? `Maaf kijiye, hum ${state.customer_name} se baat karna chahte the. Pareshaani ke liye khed hai.`
      : `My apologies — we were trying to reach ${state.customer_name}. Sorry for the disturbance, and thank you for your time.`,
  };

  const reason = state.disqualification_reason;
  if (reason === "not_intended_customer") return explanations.not_intended_customer;
  const explanation = explanations[reason];
  return explanation ? `${explanation} ${closing}` : closing;
}

function transferMessage(state) {
  const hindi = isHindi(state);
  if (state.existing_property_loan) {
    return hindi
      ? `Spasht karne ke liye dhanyavaad. Kyunki is property par aapka ek existing loan hai, ismein humare loan transfer specialist aapki madad karenge. Woh aapse shortly contact karenge. Aapke samay ke liye dhanyavaad.`
      : `Thank you for clarifying. Since you already have an existing loan on this property, this needs to be handled by our loan transfer specialist. A specialist will contact you shortly regarding this. Thank you for your time.`;
  }
  return hindi
    ? `Batane ke liye dhanyavaad. Aap apni current EMI kam karna chahte hain, iske liye humare loan transfer specialist aapse shortly contact karenge. Aapke samay ke liye dhanyavaad.`
    : `Thank you for letting me know. Since you'd like to reduce your current EMI, our loan transfer specialist will contact you shortly to help with that. Thank you for your time.`;
}

function callbackMessage(state) {
  const hindi = isHindi(state);
  if (state.callback_time) {
    return hindi
      ? `Bilkul, maine ${state.callback_time} ke liye callback request note kar li hai. Hum aapko tab call karenge. Dhanyavaad!`
      : `Of course — I've noted a callback request for ${state.callback_time}. We'll reach out to you then. Thank you, and have a good day!`;
  }
  return hindi
    ? `Bilkul, main samajh ${state.agent_gender === "female" ? "sakti" : "sakta"} hoon. Aapko kis samay call karna convenient hoga?`
    : "Certainly, I understand. What would be a convenient time for us to call you back?";
}

function qualifiedMessage(state) {
  const amount = formatINR(effectiveLoanAmount(state));
  if (isHindi(state)) {
    return `Saari jaankari ke liye dhanyavaad, ${state.customer_name} ji. Preliminary information ke aadhaar par aap is offer ke criteria poore karte hain — ${amount} tak. Humara senior loan expert aapse shortly contact karega, next steps aur exact interest rate discuss karne ke liye. Aapke samay ke liye dhanyavaad!`;
  }
  return `Thank you for sharing all of that, ${state.customer_name}. Based on this preliminary information, you meet the criteria for this offer of ${amount}. A senior loan expert will contact you shortly to discuss the next steps and the exact interest rates. Thank you for your time!`;
}

function declinedMessage(state) {
  const hindi = isHindi(state);
  if (state.termination_reason === "customer_declined_offer") {
    return hindi
      ? `Koi baat nahi, main samajh ${state.agent_gender === "female" ? "sakti" : "sakta"} hoon. Aapke samay ke liye dhanyavaad. Aapka din shubh ho!`
      : "That's completely fine, I understand. Thank you for your time, and have a good day!";
  }
  return hindi
    ? `Samajh gaya. Yeh offer ${formatINR(MAX_LOAN)} tak hi available hai, isliye hum aage nahi badh sakte. Zaroorat badalne par humse sampark kijiye. Dhanyavaad!`
    : `Understood. Since this offer is capped at ${formatINR(MAX_LOAN)}, we won't proceed further for now. Do reach out to us if your requirement changes. Thank you for your time!`;
}

/** Brief answer to an interruption, before returning to the pending question. */
function diversionAnswer(state, facts) {
  const hindi = isHindi(state);

  if (facts.asks_interest_rate) {
    return hindi
      ? "Exact interest rate humara senior loan expert preliminary qualification ke baad batayega."
      : "The exact interest rate will be shared by our senior loan expert once the preliminary qualification is complete.";
  }

  const question = facts.product_question ?? "";
  const result = retrieve(question);

  if (result.deferred) {
    return hindi
      ? "Iski exact jaankari humara senior loan expert aapko dega."
      : "Our senior loan expert will be able to give you the exact details on that.";
  }
  if (result.hit) return result.text;

  // No grounded answer available — say so plainly rather than improvising.
  return hindi
    ? "Mere paas iski jaankari abhi nahi hai, lekin humara senior loan expert yeh clarify kar dega."
    : "I don't have that information to hand, but our senior loan expert can clarify it for you.";
}

function identityExplanation(state) {
  if (isHindi(state)) {
    return `Main ${state.agent_name}, ${state.company_name} se ${hindiSpeaking(state)}. Hum ${state.customer_name} se ek pre-approved Loan Against Property offer ke baare mein baat karna chahte the, kyunki woh humare valued customer hain. Kya main ${state.customer_name} se baat kar ${state.agent_gender === "female" ? "rahi" : "raha"} hoon?`;
  }
  return `This is ${state.agent_name} calling from ${state.company_name}. We're reaching out to ${state.customer_name} about a pre-approved Loan Against Property offer available to them as a valued existing customer. May I please speak with ${state.customer_name}?`;
}

function clarificationRequest(state) {
  const pending = questionFor(state);
  const lead = isHindi(state)
    ? `Maaf kijiye, main theek se sun nahi ${state.agent_gender === "female" ? "payi" : "paya"}.`
    : "Sorry, I didn't quite catch that.";
  return pending ? `${lead} ${pending}` : lead;
}

/**
 * Composes the agent's reply for a turn.
 *
 * @param {object} params
 * @param {object} params.state  state *after* facts were applied and evaluated
 * @param {object} params.facts  validated facts extracted from this utterance
 * @param {boolean} [params.offerJustPresented] true on the turn verification succeeds
 */
export function composeReply({ state, facts, offerJustPresented = false }) {
  // Terminal outcomes are answered with a single closing message and nothing else.
  switch (state.qualification_status) {
    case "disqualified": return disqualificationMessage(state);
    case "transfer": return transferMessage(state);
    case "callback": return callbackMessage(state);
    case "declined": return declinedMessage(state);
    case "qualified": return qualifiedMessage(state);
    default: break;
  }

  if (facts.asks_who_is_calling && !state.customer_verified) return identityExplanation(state);
  if (facts.unclear) return clarificationRequest(state);
  if (!state.customer_verified) return greeting(state);

  const pending = questionFor(state);

  // A diversion is answered briefly, then the pending question is re-asked, so no
  // checklist item is ever lost to an interruption.
  if (facts.asks_interest_rate || facts.asks_product_question) {
    const answer = diversionAnswer(state, facts);
    const bridge = isHindi(state) ? "Aage badhte hain —" : "Now, coming back to it —";
    return pending ? `${answer} ${bridge} ${pending}` : answer;
  }

  if (offerJustPresented) {
    return `${offerPresentation(state)} ${pending}`.trim();
  }

  if (pending) return pending;

  // Reached only when the checklist is complete but the handoff gate is closed; the
  // gate reason is surfaced in state rather than guessed at here.
  return isHindi(state)
    ? `Jaankari ke liye dhanyavaad. Main ise aage verify kar ${state.agent_gender === "female" ? "rahi" : "raha"} hoon.`
    : "Thank you for that information. Let me just confirm the remaining details.";
}

export { offerPresentation };
