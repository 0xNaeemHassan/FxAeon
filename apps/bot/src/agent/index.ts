/**
 * Agent module — Phase 5 (Masterplan).
 *
 * Exports the NL intent parser and its wire-up into the bot's message handler.
 */
export {
  parseIntent,
  looksLikeNaturalIntent,
  intentToTradeParams,
  type ParsedIntent,
  type IntentAction,
} from "./intentParser.js";
