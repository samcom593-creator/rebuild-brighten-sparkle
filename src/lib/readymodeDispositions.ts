// readymodeDispositions — the dialer's disposition names as a person reads them (MP-310, 2026-10-28).
// ReadyMode stores "&rArr; Appointments" and "&rArr; Spanish Speaker" with the HTML arrow in the name.
const DISPOSITION_LABEL: Record<string, string> = {
  "Completed Sale": "Sold",
  "Bank Objection": "Bank objection",
  "No Bank Account": "No bank account",
  "Social Objection": "SSN objection",
  "I Give Up": "Gave up",
  "Do Not Call": "Do not call",
  "&rArr; Appointments": "Appointment",
  "&rArr; Spanish Speaker": "Spanish speaker",
  "Not Available": "No answer",
};

export function dispositionLabel(d: string | null | undefined): string {
  return d ? DISPOSITION_LABEL[d] ?? d.replace("&rArr; ", "") : "Unknown";
}
