// Product knowledge for the `additional_context_from_rag` variable.
//
// Deliberately a small keyword-scored corpus rather than a vector database: the source
// material is a handful of short product facts, so an embedding store would add
// infrastructure and latency without improving recall at this scale.
//
// Two properties matter more than retrieval sophistication:
//   1. Absence is reported as absence. A miss returns null so the agent can say it does
//      not know and defer to the senior expert, instead of inventing an answer.
//   2. Nothing in here can override a business rule. Retrieved text is injected as
//      information only; engine/eligibility.js is never consulted through this path.
//
// Interest rates, processing fees and approval timelines are intentionally ABSENT.
// The assignment states the senior loan expert provides exact rates, so there is no
// grounded value to serve and the agent must defer.

/** @typedef {{ id: string, keywords: string[], text: string }} KnowledgeEntry */

/** @type {KnowledgeEntry[]} */
export const DEFAULT_KNOWLEDGE_BASE = [
  {
    id: "lap_overview",
    keywords: ["loan against property", "lap", "mortgage loan", "what is a loan"],
    text: "A Loan Against Property lets you borrow against residential, commercial or industrial property you own, while you continue to use the property.",
  },
  {
    id: "max_amount",
    keywords: ["maximum amount", "maximum", "max", "how much can i", "how much", "limit", "highest", "upper limit", "borrow"],
    text: "This pre-approved offer is available for amounts up to ₹75,00,000.",
  },
  {
    id: "tenure_range",
    keywords: ["tenure", "repayment period", "how many years", "duration", "term"],
    text: "Repayment tenures from 3 to 15 years are available under this offer.",
  },
  {
    id: "property_types",
    keywords: ["property type", "which property", "eligible property", "agricultural", "commercial"],
    text: "Residential, commercial and industrial properties are eligible. Agricultural land is not eligible for this offer.",
  },
  {
    id: "documents",
    keywords: ["document", "documents", "papers", "paperwork", "what do i need"],
    text: "Original property documents must be available for verification. They do not need to be with you during this call.",
  },
  {
    id: "ownership",
    keywords: ["joint", "ownership", "co-owner", "sole owner", "wife", "husband"],
    text: "Both sole and joint ownership are accepted under this offer.",
  },
  {
    id: "process",
    keywords: ["process", "next step", "what happens", "after this", "how does it work"],
    text: "This call is a preliminary eligibility check. If the basic criteria are met, a senior loan expert contacts you to discuss next steps and exact terms.",
  },
  {
    id: "income_mode",
    keywords: ["income", "salary", "cash income", "bank account", "salaried", "self employed"],
    text: "Salaried and self-employed customers are both eligible, provided income is received in a bank account.",
  },
];

/**
 * Topics the agent must never answer from its own knowledge, even if a retrieved
 * document appears to mention them. Each maps to an explicit deferral.
 */
export const DEFERRED_TOPICS = [
  { id: "interest_rate", keywords: ["interest", "rate", "roi", "byaj", "percent", "%"] },
  { id: "fees", keywords: ["processing fee", "charges", "fee", "hidden cost", "penalty"] },
  { id: "approval", keywords: ["approved", "approval", "sanction", "guarantee", "confirm my loan"] },
  { id: "branch", keywords: ["branch", "office address", "nearest", "location", "where are you"] },
];

function tokenise(text) {
  return (text || "").toLowerCase().replace(/[^a-z0-9₹\s]/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Retrieves the single best-matching knowledge entry for a question.
 *
 * @param {string} question
 * @param {KnowledgeEntry[]} [corpus]
 * @returns {{ hit: boolean, text: string|null, id: string|null, deferred: string|null }}
 *   deferred names a topic that must be referred to the senior expert regardless of
 *   whether the corpus happens to contain matching text.
 */
export function retrieve(question, corpus = DEFAULT_KNOWLEDGE_BASE) {
  const words = tokenise(question);
  const asked = words.join(" ");

  for (const topic of DEFERRED_TOPICS) {
    if (topic.keywords.some((keyword) => asked.includes(keyword))) {
      return { hit: false, text: null, id: null, deferred: topic.id };
    }
  }

  let best = null;
  let bestScore = 0;
  for (const entry of corpus) {
    let score = 0;
    for (const keyword of entry.keywords) {
      if (asked.includes(keyword)) score += keyword.includes(" ") ? 3 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  // A single weak keyword is not enough to claim a grounded answer.
  if (best == null || bestScore < 2) return { hit: false, text: null, id: null, deferred: null };
  return { hit: true, text: best.text, id: best.id, deferred: null };
}

/**
 * Builds the `additional_context_from_rag` string for a call.
 * Operator-supplied context is appended and clearly separated so it is auditable.
 */
export function buildRagContext({ operatorContext = "", corpus = DEFAULT_KNOWLEDGE_BASE } = {}) {
  const base = corpus.map((entry) => `- ${entry.text}`).join("\n");
  if (!operatorContext.trim()) return base;
  return `${base}\n\nOperator-supplied context:\n${operatorContext.trim()}`;
}
