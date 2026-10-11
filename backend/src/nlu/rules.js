// Deterministic rule-based extractor.
//
// Two roles: it is the only extractor when no LLM key is configured, and it is the
// fallback whenever the LLM path errors or returns unusable output. It is also what the
// automated tests run against, which keeps the suite deterministic and offline.
//
// The hard part is not keyword spotting — it is deciding which of two rupee figures in
// one sentence is the loan request and which is the valuation. That is done positionally
// (see extractMoney) rather than by whichever regex happens to match first.

const LAKH = 100_000;
const CRORE = 10_000_000;

/** Lowercased, with Indian digit grouping removed so "75,00,000" parses as one number. */
function normalise(text) {
  return (text || "").toLowerCase().replace(/(\d),(?=\d)/g, "$1");
}

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  // Hindi, transliterated — commonly spoken in Indian voice calls.
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5, chah: 6, saat: 7, aath: 8, nau: 9, das: 10,
  baarah: 12, pandrah: 15, solah: 16,
};

/** "seventy five" / "one point two" style spelled-out quantities before a unit. */
const SPELLED_QUANTITY = {
  "seventy five": 75, seventy: 70, "sixty": 60, "fifty": 50, "forty": 40, "thirty": 30,
  "twenty five": 25, "one and a half": 1.5, "one point two": 1.2, "half": 0.5,
  "sava": 1.25, "dedh": 1.5, "paune": 0.75,
};

const UNIT_MULTIPLIERS = [
  { pattern: "crore", value: CRORE },
  { pattern: "crores", value: CRORE },
  { pattern: "cr", value: CRORE },
  { pattern: "karod", value: CRORE },
  { pattern: "lakh", value: LAKH },
  { pattern: "lakhs", value: LAKH },
  { pattern: "lac", value: LAKH },
  { pattern: "lacs", value: LAKH },
  { pattern: "lakhs", value: LAKH },
];

// Cue vocabularies for positional attribution of rupee figures.
const VALUE_CUES = /\b(worth|value|valued|valuation|market|costs?|price[ds]?|estimate[ds]?|appraised)\b/g;
const LOAN_CUES = /\b(loan|borrow|need|needed|want|require|looking for|take|avail|chahiye|sanction)\b/g;
const INCOME_CUES = /\b(earn|earning|salary|income|per month|a month|monthly|p\.?m\.?|take home|kamata|tankha)\b/g;

/** All rupee quantities in the utterance, each with its character offset. */
function extractMoney(text) {
  const hits = [];
  const seen = new Set();

  // Pass 1: numeral + unit ("1.2 crore", "75 lakhs").
  for (const { pattern, value } of UNIT_MULTIPLIERS) {
    const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${pattern}\\b`, "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      const key = `${m.index}:${m[0].length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ amount: Math.round(Number.parseFloat(m[1]) * value), index: m.index });
    }
  }

  // Pass 2: spelled-out quantity + unit ("seventy five lakh", "dedh crore").
  for (const [word, qty] of Object.entries(SPELLED_QUANTITY)) {
    for (const { pattern, value } of UNIT_MULTIPLIERS) {
      const re = new RegExp(`\\b${word}\\s*${pattern}\\b`, "g");
      let m;
      while ((m = re.exec(text)) !== null) {
        hits.push({ amount: Math.round(qty * value), index: m.index });
      }
    }
  }

  // Pass 3: bare large numerals ("7500000", "₹75,00,000" already de-grouped).
  const bare = /(?:₹|rs\.?|rupees)?\s*(\d{5,})\b/g;
  let m;
  while ((m = bare.exec(text)) !== null) {
    const n = Number.parseInt(m[1], 10);
    // Skip if this numeral is part of an already-captured "N lakh/crore" phrase.
    const overlaps = hits.some((h) => Math.abs(h.index - m.index) < 4);
    if (!overlaps && n >= 10_000) hits.push({ amount: n, index: m.index });
  }

  return hits.sort((a, b) => a.index - b.index);
}

/** Character offsets of every match of a cue pattern. */
function cuePositions(text, pattern) {
  const re = new RegExp(pattern.source, "g");
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m.index);
  return out;
}

/** Distance from an amount to the nearest cue, preferring cues that precede it. */
function nearestCueDistance(amountIndex, positions) {
  let best = Number.POSITIVE_INFINITY;
  for (const pos of positions) {
    // A preceding cue ("loan of 50 lakh") is weighted closer than a following one,
    // because Indian English overwhelmingly places the cue before the figure.
    const raw = amountIndex - pos;
    const distance = raw >= 0 ? raw : Math.abs(raw) * 1.6;
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * Assigns each rupee figure to loan amount, market value, or neither.
 * Amounts attributed to monthly income are discarded: "I earn ₹80,000 a month" is
 * neither a loan request nor a valuation, and treating it as one corrupts the checklist.
 */
function attributeAmounts(text, hits) {
  const result = {};
  if (hits.length === 0) return result;

  const valuePos = cuePositions(text, VALUE_CUES);
  const loanPos = cuePositions(text, LOAN_CUES);
  const incomePos = cuePositions(text, INCOME_CUES);
  const WINDOW = 45; // characters; beyond this a cue is unrelated to the figure

  const scored = hits.map((hit) => ({
    ...hit,
    value: nearestCueDistance(hit.index, valuePos),
    loan: nearestCueDistance(hit.index, loanPos),
    income: nearestCueDistance(hit.index, incomePos),
  }));

  for (const hit of scored) {
    const best = Math.min(hit.value, hit.loan, hit.income);
    if (best > WINDOW) {
      // No nearby cue: remember it as ambiguous so the orchestrator can place it
      // against whichever checklist item is actually pending.
      if (result.ambiguous_amount == null) result.ambiguous_amount = hit.amount;
      continue;
    }
    if (best === hit.income) continue; // monthly income — not a checklist field
    if (best === hit.value) {
      if (result.market_value == null) result.market_value = hit.amount;
    } else if (result.requested_loan_amount == null) {
      result.requested_loan_amount = hit.amount;
    }
  }

  return result;
}

function extractPropertyType(t) {
  if (/\b(agricultur\w*|farm\s*land|farmland|kheti|krishi|khet)\b/.test(t)) return "agricultural";
  if (/\b(commercial|shop|office|showroom|dukaan|godown|warehouse)\b/.test(t)) return "commercial";
  if (/\b(industrial|factory|manufacturing|plant|karkhana)\b/.test(t)) return "industrial";
  // "at home" / "ghar par" is about where the documents are kept, and "home credit" is
  // the company name — neither says anything about the property type, so a residential
  // match is suppressed when the only evidence is one of those phrases.
  const residential = /\b(residential|house|flat|apartment|bungalow|villa|makaan|ghar)\b/.test(t);
  const falsePositive = /\bat home\b|\bhome credit\b|\bghar (par|pe|mein)\b/.test(t)
    && !/\b(residential|house|flat|apartment|bungalow|villa|makaan)\b/.test(t);
  if (residential && !falsePositive) return "residential";
  if (/\bmy home\b/.test(t) && !falsePositive) return "residential";
  return null;
}

function extractOwnership(t) {
  if (/\b(joint|jointly|co[\s-]?own\w*|shared with|sanyukt|milkar|mil kar)\b/.test(t)) return "joint";
  if (/\bwith my (wife|husband|brother|sister|father|mother|son|daughter|partner|family)\b/.test(t)) return "joint";
  if (/\b(patni|pati|bhai|behen|pita|mata)\s+(ke saath|ke naam)\b/.test(t)) return "joint";
  if (/\b(sole|solely|only mine|just mine|self[\s-]?owned|single owner|my own name|akela)\b/.test(t)) return "sole";
  if (/\bi am the (only|sole) owner\b/.test(t)) return "sole";
  // Hindi: "sirf mere naam par hai" — only in my name.
  if (/\b(sirf|kewal)?\s*mere naam\b/.test(t)) return "sole";
  if (/\bkhud ka\b/.test(t)) return "sole";
  return null;
}

function extractDocuments(t) {
  const mentionsDocs = /\b(document|documents|paper|papers|deed|deeds|kagaz|kaagaz|deal|title)\b/.test(t);

  // Photocopy-only is checked first: "I have the papers but only photocopies" must not
  // be read as "available" just because "have the papers" matches.
  if (/\b(photocop\w*|xerox|photo copy|scanned cop\w*|duplicate cop\w*)\b/.test(t)) {
    if (/\b(only|just|sirf|kewal)\b/.test(t) || !/\boriginal/.test(t)) return "photocopy_only";
  }
  if (/\boriginals?\b.*\b(lost|missing|gone|bank ke paas|with the bank|mortgaged)\b/.test(t)) return "unavailable";
  if (/\b(don'?t|do not|dont|nahi|no)\b.{0,24}\b(original|document|paper|kagaz)/.test(t)) return "unavailable";
  if (mentionsDocs && /\b(not available|unavailable|lost|missing)\b/.test(t)) return "unavailable";

  if (/\boriginal/.test(t) && /\b(have|available|ready|hai|with me|at home|yes)\b/.test(t)) return "available";
  if (mentionsDocs && /\b(available|ready|have them|have the|with me|at home)\b/.test(t)) return "available";
  return null;
}

function extractOccupation(t) {
  if (/\b(self[\s-]?employed|business|businessman|shop owner|freelanc\w*|own firm|my firm|entrepreneur|vyapar|dukaan chalata)\b/.test(t)) {
    return "self_employed";
  }
  if (/\b(salaried|salary|job|employee|employed at|work (at|for|in)|private company|government (job|service)|naukri)\b/.test(t)) {
    return "salaried";
  }
  return null;
}

function extractIncomeMode(t) {
  // Explicit negation first: "not in cash" means bank, and must not match the cash branch.
  if (/\b(not|no|never|nahi)\b.{0,16}\bcash\b/.test(t)) return "bank";
  if (/\b(cash|nagad|hand to hand|by hand)\b/.test(t)) return "cash";
  if (/\b(bank|account|neft|cheque|check|direct deposit|credited|transfer)\b/.test(t)) return "bank";
  return null;
}

function extractTenure(t) {
  const YEAR_UNIT = "(?:years?|yrs?|saal|varsh)";

  // A trailing correction wins outright: "ten years, actually make that twelve".
  const correction = t.match(
    new RegExp(`\\b(?:actually|make it|make that|change it to|instead|better|no)\\b[^.]{0,24}?(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\b`),
  );
  if (correction) {
    const raw = correction[1];
    const n = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : NUMBER_WORDS[raw];
    if (Number.isFinite(n) && n >= 1 && n <= 40) return n;
  }

  // Otherwise the last explicit "N years" in the utterance wins.
  let last = null;
  const numeric = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${YEAR_UNIT}\\b`, "g");
  let m;
  while ((m = numeric.exec(t)) !== null) last = Math.round(Number.parseFloat(m[1]));
  if (last != null) return last;

  for (const [word, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\s*${YEAR_UNIT}\\b`).test(t)) return n;
  }
  return null;
}

function extractCallbackTime(original) {
  const m = original.match(
    /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)|tomorrow(?:\s+(?:morning|afternoon|evening))?|(?:this|tonight|today)(?:\s+(?:morning|afternoon|evening))?|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|after\s+\d+\s*(?:hours?|minutes?)|(?:morning|afternoon|evening)|shaam|subah)\b/i,
  );
  return m ? m[0].trim() : null;
}

/**
 * Extracts every fact present in a single customer utterance.
 * Returns a raw fact object; callers must pass it through validateFacts.
 */
export function extractWithRules(utterance) {
  const original = utterance || "";
  const t = normalise(original);
  const facts = {};
  if (t.trim() === "") {
    facts.unclear = true;
    return facts;
  }

  // --- Call-control intents -------------------------------------------------
  if (/\b(who is (this|calling)|who are you|kaun bol raha|kaun hai|which company)\b/.test(t)) {
    facts.asks_who_is_calling = true;
  }
  if (/\b(wrong number|not (him|her|them)|he'?s not|she'?s not|galat number|i am not [a-z]+|this is not [a-z]+)\b/.test(t)) {
    facts.not_intended_customer = true;
  }
  if (/\b(busy|in a meeting|driving|can'?t talk|cannot talk|call (me )?(back )?later|not a good time|call tomorrow|abhi busy|baad mein)\b/.test(t)) {
    facts.busy = true;
    const when = extractCallbackTime(original);
    if (when) facts.callback_time = when;
  }
  if (/\b(not interested|don'?t call|do not call|stop calling|remove my number|no thanks)\b/.test(t)) {
    facts.refuses_to_continue = true;
  }
  if (/\b(yes[, ]*(this is|speaking|that'?s me|i am)|speaking|that'?s me|yes it'?s me|haan( ji)?,? ?(main|bol)|bol raha hoon)\b/.test(t)) {
    facts.confirms_identity = true;
  }

  // --- Transfer branch ------------------------------------------------------
  if (/\b(already have|existing|running|chal raha).{0,28}\b(loan|mortgage|emi)\b/.test(t)
    || /\bloan\b.{0,24}\b(on (this|the) property|already|existing)\b/.test(t)
    || /\b(transfer|balance transfer|shift).{0,16}\bloan\b/.test(t)) {
    facts.existing_property_loan = true;
  }
  if (/\b(reduce|lower|kam kar|bring down|cut).{0,20}\bemi\b/.test(t) || /\bemi\b.{0,20}\b(reduce|lower|kam|high|too much)\b/.test(t)) {
    facts.emi_reduction_request = true;
  }

  // --- Checklist fields -----------------------------------------------------
  const propertyType = extractPropertyType(t);
  if (propertyType) facts.property_type = propertyType;

  const ownership = extractOwnership(t);
  if (ownership) facts.ownership_status = ownership;

  const documents = extractDocuments(t);
  if (documents) facts.documents_available = documents;

  Object.assign(facts, attributeAmounts(t, extractMoney(t)));

  const occupation = extractOccupation(t);
  if (occupation) facts.occupation = occupation;

  const incomeMode = extractIncomeMode(t);
  if (incomeMode) facts.income_mode = incomeMode;

  const tenure = extractTenure(t);
  if (tenure != null) facts.tenure_years = tenure;

  // --- Diversions and corrections ------------------------------------------
  if (/\b(interest rate|rate of interest|roi|what rate|kitna byaj|byaj)\b/.test(t)) facts.asks_interest_rate = true;
  if (/\b(branch|processing fee|charges|prepayment|foreclosure|documents needed|how long|eligibility|tenure options)\b/.test(t)
    && /\?|\b(what|where|how|which|kya|kahan|kaise)\b/.test(t)) {
    facts.asks_product_question = true;
    facts.product_question = original.trim().slice(0, 120);
  }
  if (/\b(actually|make it|make that|change it to|instead|i meant|sorry)\b/.test(t)) facts.correction = true;
  if (/^\s*(huh|what|sorry|pardon|come again|didn'?t (hear|catch)|kya kaha)\s*\??\s*$/i.test(original.trim())) {
    facts.unclear = true;
  }

  return facts;
}
