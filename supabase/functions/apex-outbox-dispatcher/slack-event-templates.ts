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
  "production.personal_record",
  "recruiting.bounty_qualified",
  "recruiting.bounty_reversed",
  "agent.hired",
  "recruiting.milestone",
  // WP7 (2026-11-10): the momentum moments that used to exist only on Discord.
  "production.first_deal",
  "production.mtd_milestone",
  "leaderboard.weekly",
] as const;

export type SlackTemplatedEventType = (typeof SLACK_TEMPLATED_EVENT_TYPES)[number];

// Event types queued by edge functions rather than database triggers. The
// health probe's trigger introspection (slack_outbox_emitters()) cannot see
// these, so they are declared here to keep route coverage honest.
export const SLACK_EDGE_EMITTERS: Readonly<Record<string, string>> = {
  "free_leads.weekly_summary": "edge:free-leads-weekly-alerts",
  // pg_cron evaluators (migration 20260826070000), not triggers, so the
  // trigger introspection cannot see them either.
  "production.personal_record": "cron:apex-personal-records-15min",
  "recruiting.bounty_qualified": "cron:apex-recruiter-bounties-15min",
  "recruiting.bounty_reversed": "rpc:set_recruiter_bounty_status",
  // WP7: queued by pg_cron SQL enqueuers (migration 20261111100610).
  "production.first_deal": "cron:apex-production-celebrations-slack",
  "production.mtd_milestone": "cron:apex-production-celebrations-slack",
  "leaderboard.weekly": "cron:apex-weekly-leaderboard-slack",
};

export const SLACK_DEFAULT_URLS = {
  recruitingPipeline: "https://apex-financial.org/dashboard/recruiting",
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

// First name only, even if a caller passes a full name: team channels carry a
// producer's first name and dollars, never more (WP7 / 2026-09-26 rule).
function firstNameOnly(value: unknown, fallback: string): string {
  const first = (typeof value === "string" ? value.trim() : "").split(/\s+/)[0] ?? "";
  return slackText(first, 40) || slackText(fallback, 40);
}

const MTD_TIER_LABEL: Readonly<Record<number, string>> = {
  25_000: "$25K Club",
  40_000: "$40K Club",
  75_000: "$75K Elite",
  100_000: "$100K Legend",
};

const LEADERBOARD_MEDALS = [":first_place_medal:", ":second_place_medal:", ":third_place_medal:"];

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
    return `New Galaxy application: *${candidate}* — ${licenseTrack}${stateSuffix(p.state)}\n<${url}|Open recruiting pipeline>`;
  }

  if (eventType === "candidate.licensing_milestone") {
    // reads: candidateName, milestoneType, state, examDate, openUrl
    const milestone = text(p.milestoneType, "licensing milestone", 80).replaceAll("_", " ");
    const candidate = text(p.candidateName, "Galaxy candidate");
    const examDate = typeof p.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.examDate)
      ? ` · ${p.examDate}`
      : "";
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.recruitingPipeline);
    return `Galaxy licensing milestone: *${candidate}* — ${milestone}${stateSuffix(p.state)}${examDate}\n<${url}|Open recruiting pipeline>`;
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
    const agent = text(p.agentName, "Galaxy producer");
    const carrierText = slackText(p.carrierName, 80);
    const productText = slackText(p.productCategory, 80);
    const carrier = carrierText ? ` · ${carrierText}` : "";
    const product = productText ? ` · ${productText}` : "";
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.productionDashboard);
    // MP-341: the first sale of the day sets the tone in a sales room, and it
    // read exactly like the fifth. The flag is decided at ENQUEUE time (see
    // fn_is_first_slack_deal_today) because this template is stateless and a
    // dispatcher retry hours later would otherwise crown the wrong deal.
    // Still the producer only — no policyholder field is ever read here.
    if (p.firstOfDay === true) {
      return `:trophy: *FIRST DEAL ON THE BOARD TODAY* — *${agent}* — ${usd(p.annualPremium)}${carrier}${product}\n<${url}|Open production dashboard>`;
    }
    return `Galaxy sale posted: *${agent}* — ${usd(p.annualPremium)}${carrier}${product}\n<${url}|Open production dashboard>`;
  }

  if (eventType === "production.personal_record") {
    // reads: agentName (the PRODUCER), recordType, value, previousBest, periodKey, openUrl.
    const agent = text(p.agentName, "Galaxy producer");
    const kind = String(p.recordType ?? "");
    const value = Number(p.value ?? 0) || 0;
    const prev = p.previousBest == null ? null : Number(p.previousBest) || 0;
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.productionDashboard);
    const label =
      kind === "daily_alp" ? `best day: ${usd(value)} ALP` :
      kind === "weekly_alp" ? `best week: ${usd(value)} ALP` :
      kind === "daily_policies" ? `most policies in a day: ${value}` :
      kind === "selling_streak" ? `longest selling streak: ${value} business days` :
      `new record: ${value}`;
    const was = prev == null ? "" : kind.endsWith("_alp") ? ` (was ${usd(prev)})` : ` (was ${prev})`;
    return `Personal record — *${agent}* — ${label}${was}\n<${url}|Open production dashboard>`;
  }

  if (eventType === "recruiting.bounty_qualified") {
    // reads: recruiterName, recruitName (both AGENTS), amountCents, policies, openUrl.
    const recruiter = text(p.recruiterName, "Galaxy producer");
    const recruit = text(p.recruitName, "a new agent");
    const cents = Math.max(0, Number(p.amountCents ?? 50000) || 50000);
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.teamDashboard);
    return `Recruiter bounty qualified — *${recruiter}* earns ${usd(cents / 100)}: ${recruit} posted their first ${Math.max(2, Number(p.policies ?? 2) || 2)} policies\n<${url}|Review in Team>`;
  }

  if (eventType === "recruiting.bounty_reversed") {
    // reads: recruiterName, recruitName (both AGENTS), reason, openUrl.
    const recruiter = text(p.recruiterName, "Galaxy producer");
    const recruit = text(p.recruitName, "a new agent");
    const reason = slackText(p.reason, 160);
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.teamDashboard);
    return `Recruiter bounty REVERSED — *${recruiter}* (recruit: ${recruit})${reason ? ` — ${reason}` : ""}\n<${url}|Review in Team>`;
  }

  if (eventType === "recruiting.milestone") {
    // reads: agentName, badge, hires, period, openUrl. No candidate PII — a
    // milestone is about the RECRUITER, and naming the people they hired would
    // publish a roster into a chat channel.
    const who = text(p.agentName, "An agent");
    const badge = slackText(p.badge, 40) || "MILESTONE";
    const hires = Math.max(0, Number(p.hires ?? 0) || 0);
    const period = String(p.period ?? "month") === "day" ? "today" : "this month";
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.teamDashboard);
    return `:trophy: ${badge} — *${who}* ${hires === 1 ? "hired 1 agent" : `hired ${hires} agents`} ${period}\n<${url}|See the board>`;
  }

  if (eventType === "agent.hired") {
    // reads: agentName (the PRODUCER), agentCode, managerName, licenseStatus,
    // contractingUrl, openUrl. No client PII.
    const agent = text(p.agentName, "A new producer");
    const code = slackText(p.agentCode, 40);
    const mgr = slackText(p.managerName, 80);
    const lic = String(p.licenseStatus ?? "").toLowerCase() === "licensed" ? "licensed" : "unlicensed";
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.recruitingPipeline);
    const contracting = safeSlackUrl(p.contractingUrl, SLACK_DEFAULT_URLS.contractingOps);
    const bits = [code ? `code ${code}` : "", mgr ? `manager ${mgr}` : "", lic].filter(Boolean).join(" · ");
    return `:dart: NEW HIRE — *${agent}*${bits ? ` (${bits})` : ""}\nContracting: <${contracting}|start contracting> · <${url}|open profile>`;
  }

  if (eventType === "production.first_deal") {
    // reads: agentFirstName, productCategory, annualPremium, openUrl. The
    // policyholder is never read.
    const agent = firstNameOnly(p.agentFirstName, "A new Galaxy producer");
    const productText = slackText(p.productCategory, 60);
    const product = productText ? ` · ${productText}` : "";
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.productionDashboard);
    return `:tada: *FIRST DEAL* — *${agent}* just opened their book: ${usd(p.annualPremium)} ALP${product}. Rally around them.\n<${url}|Open production dashboard>`;
  }

  if (eventType === "production.mtd_milestone") {
    // reads: agentFirstName, tier, monthLabel, openUrl. Tier only, by design.
    const agent = firstNameOnly(p.agentFirstName, "A Galaxy producer");
    const tier = Number(p.tier ?? 0);
    const label = MTD_TIER_LABEL[tier]
      ?? (Number.isFinite(tier) && tier > 0 ? `${usd(tier)} month` : "a monthly milestone");
    const month = slackText(p.monthLabel, 20);
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.productionDashboard);
    return `:gem: *${agent}* just joined the *${label}*${month ? ` for ${month}` : " this month"}.\n<${url}|Open production dashboard>`;
  }

  if (eventType === "leaderboard.weekly") {
    // reads: weekLabel, entries[{ firstName, alp }] (top 5), openUrl.
    const week = slackText(p.weekLabel, 40);
    const entries = Array.isArray(p.entries) ? p.entries.slice(0, 5) : [];
    const lines = entries.map((raw, i) => {
      const e = (raw ?? {}) as Record<string, unknown>;
      const medal = LEADERBOARD_MEDALS[i] ?? `${i + 1}.`;
      return `${medal} ${firstNameOnly(e.firstName, "Galaxy producer")} — ${usd(e.alp)}`;
    });
    const body = lines.length ? lines.join("\n") : "No posted production this week.";
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.productionDashboard);
    return `:trophy: *Weekly leaderboard${week ? ` — ${week}` : ""}*\n${body}\n<${url}|Open production dashboard>`;
  }

  if (eventType === "free_leads.weekly_summary") {
    // reads: eligibleCount, nearCount, threshold, openUrl
    const eligible = Math.max(0, Number(p.eligibleCount ?? 0) || 0);
    const near = Math.max(0, Number(p.nearCount ?? 0) || 0);
    const threshold = Math.max(0, Number(p.threshold ?? 20_000) || 20_000);
    const url = safeSlackUrl(p.openUrl, SLACK_DEFAULT_URLS.teamDashboard);
    return `Galaxy Free Leads weekly pulse: *${eligible} active* · *${near} within $5K* of the $${threshold.toLocaleString("en-US")} tier\n<${url}|Open team dashboard>`;
  }

  return null;
}
