// intentionally-orphan: Canonical public facts consumed by scripts/check-hero-path-claims.mjs and scripts/check-hero-carrier-count-live.mjs.
/** Public recruiting facts shared by the visible carrier metric and claim guards. */
export const carriers = [
  "National Life Group", "American Amicable", "Aflac", "Ethos Life",
  "Mutual of Omaha", "American Home Life", "Transamerica", "Athene",
  "Foresters", "Americo", "F&G", "Prosperity", "American Equity",
  "North American", "Nationwide", "American National", "AIG",
  "Principal", "Lincoln Financial", "Prudential", "John Hancock", "Protective",
] as const;

// Contract eligibility governs the range stated on retained public pages.
// The focused homepage no longer renders a contract-range panel.
export const stats = [
  { label: "Contract range", value: "70%–145%" },
  { label: "Carrier partners", value: "22 carriers" },
] as const;
