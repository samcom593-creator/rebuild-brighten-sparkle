// Hire alert email for apex-outbox-dispatcher (destination 'email', event agent.hired).
//
// Pure module on purpose: no Deno globals, no Supabase client, so the deno test
// beside it renders the SAME html the dispatcher sends. Reads ONLY the payload
// keys listed here: agentName, agentCode, managerName, licenseStatus,
// onboardingStage, hiredAt, openUrl, contractingUrl. A phone, email, date of
// birth or address smuggled into the payload cannot reach an inbox.
//
// Recipients are NOT part of this module. The dispatcher resolves the owner inbox
// and the recruiting manager at send time, so the outbox stays a redacted record.

export const HIRE_EMAIL_URL_PREFIX = "https://galaxyfinancial.org/";
export const HIRE_EMAIL_DEFAULT_OPEN_URL = "https://galaxyfinancial.org/dashboard/recruiting";
export const HIRE_EMAIL_DEFAULT_CONTRACTING_URL = "https://galaxyfinancial.org/dashboard/contracting/ops";

export type HireEmail = { subject: string; html: string; text: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clean(value: unknown, max = 120): string {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return normalized.slice(0, max);
}

export function safeHireUrl(value: unknown, fallback: string): string {
  return typeof value === "string" && value.startsWith(HIRE_EMAIL_URL_PREFIX) ? value : fallback;
}

function licenseLabel(value: unknown): "Licensed" | "Pre-license" {
  return String(value ?? "").toLowerCase() === "licensed" ? "Licensed" : "Pre-license";
}

function stageLabel(value: unknown): string {
  return clean(value, 40).replaceAll("_", " ");
}

function hiredOn(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

export function renderHireEmail(payload: Record<string, unknown> | null | undefined): HireEmail {
  const p = payload ?? {};
  const name = clean(p.agentName) || "A new producer";
  const first = name.split(" ")[0] || name;
  const code = clean(p.agentCode, 40);
  const manager = clean(p.managerName, 80);
  const license = licenseLabel(p.licenseStatus);
  const stage = stageLabel(p.onboardingStage);
  const date = hiredOn(p.hiredAt);
  const openUrl = safeHireUrl(p.openUrl, HIRE_EMAIL_DEFAULT_OPEN_URL);
  const contractingUrl = safeHireUrl(p.contractingUrl, HIRE_EMAIL_DEFAULT_CONTRACTING_URL);

  const subject = `New hire: ${name} (${license.toLowerCase()})`;

  const facts: Array<[string, string]> = [
    ["License", license],
    ...(code ? [["Agent code", code] as [string, string]] : []),
    ...(manager ? [["Recruited by", manager] as [string, string]] : []),
    ...(stage ? [["Stage", stage] as [string, string]] : []),
    ...(date ? [["Hired", date] as [string, string]] : []),
  ];

  const factRows = facts
    .map(([label, value]) =>
      `<tr><td style="padding:6px 14px 6px 0;color:#8e94a3;font-size:14px;white-space:nowrap">${escapeHtml(label)}</td>` +
      `<td style="padding:6px 0;color:#f5f6f8;font-size:15px;font-weight:600">${escapeHtml(value)}</td></tr>`)
    .join("");

  const html =
    `<div style="margin:0;padding:28px 16px;background:#0f1117;font-family:Arial,Helvetica,sans-serif;color:#f5f6f8">` +
    `<div style="max-width:560px;margin:0 auto;border:1px solid #2a3140;border-left:5px solid #f0c330;border-radius:10px;padding:26px 28px;background:#151926">` +
    `<p style="margin:0 0 8px;color:#f0c330;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">New hire</p>` +
    `<h1 style="margin:0 0 6px;font-size:28px;line-height:1.15;color:#ffffff">Welcome ${escapeHtml(first)} to Galaxy Financial</h1>` +
    `<p style="margin:0 0 18px;font-size:17px;color:#d8dbe2">${escapeHtml(name)} just joined the roster.</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 22px">${factRows}</table>` +
    `<p style="margin:0 0 10px"><a href="${escapeHtml(openUrl)}" style="display:inline-block;padding:11px 18px;border-radius:7px;background:#f0c330;color:#111318;font-weight:700;text-decoration:none">Open their profile</a>` +
    ` <a href="${escapeHtml(contractingUrl)}" style="display:inline-block;padding:11px 18px;border-radius:7px;border:1px solid #3a4356;color:#f5f6f8;font-weight:600;text-decoration:none">Start contracting</a></p>` +
    `<p style="margin:22px 0 0;font-size:12px;color:#8e94a3">Internal hire alert from the Galaxy Financial team dashboard. Sent to the owner inbox and the recruiting manager when a new agent is added.</p>` +
    `</div></div>`;

  const text = [
    `NEW HIRE: ${name}`,
    "",
    `Welcome ${first} to Galaxy Financial.`,
    ...facts.map(([label, value]) => `${label}: ${value}`),
    "",
    `Open their profile: ${openUrl}`,
    `Start contracting: ${contractingUrl}`,
    "",
    "Internal hire alert from the Galaxy Financial team dashboard.",
  ].join("\n");

  return { subject, html, text };
}
