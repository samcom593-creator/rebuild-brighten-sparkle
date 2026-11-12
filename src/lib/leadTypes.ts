// The lead types an agent picks when posting a deal (MP-PERF-BOT, 2026-11-12). The stored value is the label,
// which public.fn_lead_type_of() maps to its canonical key, so close rate and income by lead type can be
// computed. It was an optional free-text box and was blank on 2,008 of 2,012 deals.
export type LeadTypeKey = "pos" | "veteran" | "fex" | "mortgage" | "aged" | "referral" | "other";

export const LEAD_TYPES: { key: LeadTypeKey; label: string; hint: string }[] = [
  { key: "pos", label: "POS", hint: "Point-of-sale lead" },
  { key: "veteran", label: "Veteran", hint: "Veteran or VA lead" },
  { key: "fex", label: "FEX", hint: "Final expense lead" },
  { key: "mortgage", label: "Mortgage", hint: "Mortgage protection lead" },
  { key: "aged", label: "Aged", hint: "Older or recycled lead" },
  { key: "referral", label: "Referral", hint: "From a client, friend or family" },
  { key: "other", label: "Other", hint: "None of these" },
];

export const LEAD_TYPE_LABEL: Record<string, string> = Object.fromEntries(LEAD_TYPES.map((t) => [t.key, t.label]));
