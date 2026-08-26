// Slack message templates for outbox events with destination = 'slack'.
//
// Pure module on purpose: no Deno globals, no Supabase client, so the SAME
// renderer is imported by apex-outbox-dispatcher (to post), by
// slack-integration-health (to prove every enabled route has a template), and
// by the vitest suite (to assert the rendered text never carries client PII).
//
// Contract:
//   - renderSlackEventText() returns null for an event type it does not know.
//     The dispatcher turns null into manual_action_required, never into a
//     guessed message. The previous renderer fell through to the licensing
//     milestone template for ANY unknown type, which would have announced an
//     unrelated event as "APEX licensing milestone".
//   - Every template reads ONLY the payload keys listed beside it. Client
//     (policyholder) names, phones, emails and dates of birth are never read,
//     so even a payload that smuggles them cannot reach a channel.

export const SLACK_TEMPLATED_EVENT_TYPES = [
  "candidate.application_submitted",
  "candidate.licensing_milestone",
  "candidate.interview_noshow",
  "contracting.intake_submitted",
  "deal.posted",
  "free_leads.weekly_summary",
] as const;

export type SlackTemplatedEventType = (typeof SLACK_TEMPLATED_EVENT_TYPES)[number];

// Event types queued by edge functions rather than database triggers. The
// health probe's trigger introspection (slack_outbox_emitters()) cannot see
// these, so they are declared here to keep route coverage honest.
export const SLACK_EDGE_EMITTERS: Readonly<Record<string, string>> = {
  "free_leads.weekly_summary": "edge:free-leads-weekly-alerts",
};

export const SLACK_DEFAULT_URLS = {
  recruitingPipeline: "https://apex-financial.org/dashboard/recruiting/pipeline",
  interviewRecovery: "https://apex-financial.org/dashboard/recruiting/follow-ups",
  contractingOps: "https://apex-financial.org/dashboard/contracting/ops",
  productionDashboard: "https://apex-financial.org/dashboard",
  teamDashboard: "https://apex-financial.org/dashboard/team",
} as const;

export function safeSlackUrl(value: unknown, fallback: string): string {
  return typeof value === "string" && value.startsWith("https://apex-financial.org/")
    ? value
    : fallback;
}

function slackText(value: unknown, max = 200): string {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return normalized.slice(0, max).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function text(value: unknown, fallback: string, max = 200): string {
  return slackText(value, max) || slackText(fallback, max);
}

function stateSuffix(value: unknown): string {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value) ? ` · ${value}` : "";
}

function usd(value: unknown): string {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
      .format(Math.max(0, amount))
    : "$0";
}

export function isSlackTemplatedEventType(eventType: string): eventType is SlackTemplatedEventType {
  return (SLACK_TEMPLATED_EVENT_TYPES as readonly string[]).includes(eventType);
}

export function renderSlackEventText(
  eventType: string,
  payload: Record<string, unknown> | null | undefined,
): string | null {
  const p = payload ?? {};

  if (eventType === "candidate.application_submitted") {
    // reads: candidateName, isLicensed, state, openUrl
    const candidate = text(p.candidateName, "New candidate");
    const licenseTrack = p.isLicensed === true ? "licensed" : "unlicensed";
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.recruitingPipeline);
    return `New APEX application: *${candidate}* — ${licenseTrack}${stateSuffix(p.state)}\n<${url}|Open recruiting pipeline>`;
  }

  if (eventType === "candidate.licensing_milestone") {
    // reads: candidateName, milestoneType, state, examDate, openUrl
    const milestone = text(p.milestoneType, "licensing milestone", 80).replaceAll("_", " ");
    const candidate = text(p.candidateName, "APEX candidate");
    const examDate = typeof p.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.examDate)
      ? ` · ${p.examDate}`
      : "";
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.recruitingPipeline);
    return `APEX licensing milestone: *${candidate}* — ${milestone}${stateSuffix(p.state)}${examDate}\n<${url}|Open recruiting pipeline>`;
  }

  if (eventType === "candidate.interview_noshow") {
    // reads: candidateName, openUrl. Never phone, never email.
    const candidate = text(p.candidateName, "A candidate");
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.interviewRecovery);
    return `:rotating_light: No-show — *${candidate}* missed their interview. Urgent follow-up: <${url}|Open interview recovery>`;
  }

  if (eventType === "contracting.intake_submitted") {
    // reads: agentName, npnLast4, openUrl
    const agent = text(p.agentName, "New agent");
    const npnSuffix = typeof p.npnLast4 === "string" && /^\d{4}$/.test(p.npnLast4)
      ? ` · NPN ending ${p.npnLast4}`
      : "";
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.contractingOps);
    return `Contracting intake received: *${agent}*${npnSuffix}\n<${url}|Open contracting operations>`;
  }

  if (eventType === "deal.posted") {
    // reads: agentName (the PRODUCER), annualPremium, carrierName, productCategory, openUrl.
    // The policyholder is never read: no clientName / clientFirstName / phone / dob.
    const agent = text(p.agentName, "APEX producer");
    const carrierText = slackText(p.carrierName, 80);
    const productText = slackText(p.productCategory, 80);
    const carrier = carrierText ? ` · ${carrierText}` : "";
    const product = productText ? ` · ${productText}` : "";
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.productionDashboard);
    return `APEX sale posted: *${agent}* — ${usd(p.annualPremium)}${carrier}${product}\n<${url}|Open production dashboard>`;
  }

  if (eventType === "free_leads.weekly_summary") {
    // reads: eligibleCount, nearCount, threshold, openUrl
    const eligible = Math.max(0, Number(p.eligibleCount ?? 0) || 0);
    const near = Math.max(0, Number(p.nearCount ?? 0) || 0);
    const threshold = Math.max(0, Number(p.threshold ?? 20_000) || 20_000);
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.teamDashboard);
    return `APEX Free Leads weekly pulse: *${eligible} active* · *${near} within $5K* of the $${threshold.toLocaleString("en-US")} tier\n<${url}|Open team dashboard>`;
  }

  return null;
}
