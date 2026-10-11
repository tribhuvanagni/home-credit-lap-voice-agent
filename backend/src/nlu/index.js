// NLU orchestrator: picks an extraction strategy, validates the result, and merges.
//
// Strategy is explicit rather than implicit so that every turn records which path
// produced its facts. That record is what makes a transcript reviewable later.

import { config } from "../config.js";
import { logger } from "../logger.js";
import { extractWithRules } from "./rules.js";
import { extractWithLLM } from "./llm.js";
import { validateFacts } from "./schema.js";

/**
 * Merges rule facts beneath LLM facts.
 *
 * The model wins on fields it filled, because it reads context the regexes cannot.
 * The rule pass still runs and fills anything the model left null, which recovers the
 * common case of a model that returns a partial object. Neither extractor can produce a
 * value that validateFacts rejects.
 */
function merge(primary, secondary) {
  const merged = { ...secondary };
  for (const [key, value] of Object.entries(primary)) {
    if (value != null) merged[key] = value;
  }
  return merged;
}

/**
 * Extracts facts from one customer utterance.
 *
 * @param {object} params
 * @param {string} params.utterance            raw customer speech
 * @param {Array}  [params.conversationHistory] prior turns, oldest first
 * @param {string} [params.language]           configured call language
 * @param {boolean}[params.forceRules]         bypass the LLM (used by the test suite)
 * @returns {Promise<{ facts: object, source: string, degraded: boolean }>}
 */
export async function extractFacts({
  utterance,
  conversationHistory = [],
  language = "English",
  forceRules = false,
}) {
  const ruleResult = validateFacts(extractWithRules(utterance));
  if (ruleResult.rejected.length > 0) {
    // A rule extractor emitting invalid fields is a code defect, not bad input.
    logger.warn("rule extractor produced invalid fields", { rejected: ruleResult.rejected });
  }

  const useLLM = config.llm.enabled && !forceRules;
  if (!useLLM) {
    return { facts: ruleResult.facts, source: "rules", degraded: false };
  }

  const llmResult = await extractWithLLM({ utterance, conversationHistory, language });
  if (llmResult.facts == null) {
    // Degraded but still functional: the deterministic extractor carries the turn.
    return { facts: ruleResult.facts, source: `rules_fallback(${llmResult.source})`, degraded: true };
  }

  return {
    facts: merge(llmResult.facts, ruleResult.facts),
    source: "llm+rules",
    degraded: false,
  };
}

export { extractWithRules, validateFacts };
