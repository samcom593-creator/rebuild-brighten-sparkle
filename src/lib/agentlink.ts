// AgentLink canonical surface.
//
// As of 2026-05-15 ApexLink treats AgentLink (agentlink.insuracloud.ai) as
// the source of truth for deal entry. Agents submit deals THERE; ApexLink
// reads them every minute via `insuracloud-sync` and renders the operating
// experience (dashboards, leaderboards, referrals, seminars).
//
// This file centralises the URL + the canonical deep links so the team
// stops sprinkling raw `https://agentlink.insuracloud.ai/...` strings
// across components. Update once, propagate everywhere.

export const AGENTLINK_BASE = "https://agentlink.insuracloud.ai";

export const AGENTLINK_LINKS = {
  /** The home of AgentLink — drops you on the dashboard. */
  home: AGENTLINK_BASE,
  /** Direct path to the "submit a deal" form. */
  newDeal: `${AGENTLINK_BASE}/deals/new`,
  /** Agent's own book of business at the source. */
  bookOfBusiness: `${AGENTLINK_BASE}/book-of-business`,
  /** Where to grab a fresh session cookie when the cookie-pull transport dies. */
  cookieGrab: AGENTLINK_BASE,
} as const;

/**
 * Display copy used on every dashboard banner so agents see the same words
 * everywhere: deal entry happens in AgentLink, ApexLink follows.
 */
export const AGENTLINK_TAGLINE = "Submit deals in AgentLink — they sync into ApexLink in under a minute.";
