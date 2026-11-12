// The daily owner overview, rendered (MP-302). Pure: no network, no clock.
//
// Rules: a section with nothing in it is left out; every line that asks for something links
// to where it is done; production is called production (annual premium posted), never income.

export interface OverviewData {
  day: string;
  today: string;
  applicants: { licensed: Person[]; unlicensed: Person[] };
  interviews: { booked: number; today: Array<{ name: string; at: string; track: string | null; application_id: string | null; needs_prep: boolean }> };
  followups: { late: number; untouched_new: number };
  hires: { new: Array<string | null>; not_onboarded: Array<{ name: string | null; days: number }> };
  production: { deals: number; ap: number };
  content: { awaiting_approval: number; failed: number };
  system: { critical_24h: Array<{ subject: string | null; at: string }> };
}
interface Person { id: string; name: string | null; state: string | null }

const SITE = "https://apex-financial.org";

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function dayWords(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

function clock(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "time not set";
  return t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" }) + " AZ";
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const link = (path: string, text: string) => `<a href="${SITE}${path}" style="color:#b8860b;font-weight:600;text-decoration:none">${esc(text)}</a>`;
const personLink = (p: Person) => link(`/dashboard/recruiting?person=${encodeURIComponent(p.id)}`, `${p.name ?? "Name not on file"}${p.state ? ` (${p.state})` : ""}`);

export interface Section { title: string; lines: string[] }

/** The sections that have something to say, in order. Empty ones are absent. */
export function buildSections(d: OverviewData): Section[] {
  const out: Section[] = [];
  const day = dayWords(d.day);

  const lic = d.applicants.licensed, unlic = d.applicants.unlicensed;
  if (lic.length + unlic.length > 0) {
    const lines: string[] = [];
    if (lic.length) lines.push(`<strong>${plural(lic.length, "licensed applicant", "licensed applicants")}</strong>, call first: ${lic.map(personLink).join(", ")}`);
    if (unlic.length) lines.push(`${plural(unlic.length, "unlicensed applicant", "unlicensed applicants")}, course first: ${unlic.map(personLink).join(", ")}`);
    out.push({ title: `New applicants, ${day}`, lines });
  }

  if (d.interviews.booked > 0 || d.interviews.today.length > 0) {
    const lines: string[] = [];
    if (d.interviews.booked > 0) lines.push(`${plural(d.interviews.booked, "interview", "interviews")} booked ${day}.`);
    for (const i of d.interviews.today) {
      const who = i.application_id ? link(`/dashboard/recruiting?person=${encodeURIComponent(i.application_id)}`, i.name) : esc(i.name);
      lines.push(`Today ${clock(i.at)}: ${who}${i.track ? `, ${esc(i.track)} call` : ""}${i.needs_prep ? " · no prep notes yet" : ""}`);
    }
    lines.push(link("/dashboard/recruiting/interviews", "Open interviews"));
    out.push({ title: "Interviews", lines });
  }

  if (d.followups.late > 0 || d.followups.untouched_new > 0) {
    const lines: string[] = [];
    if (d.followups.late > 0) lines.push(`${plural(d.followups.late, "follow-up a person set is", "follow-ups people set are")} now late. ${link("/dashboard/recruiting?queue=overdue", "Open overdue")}`);
    if (d.followups.untouched_new > 0) lines.push(`${plural(d.followups.untouched_new, "applicant from the last 7 days has", "applicants from the last 7 days have")} not been worked. ${link("/dashboard/recruiting?queue=new", "Open new")}`);
    out.push({ title: "Follow-ups outstanding", lines });
  }

  const newHires = d.hires.new.filter(Boolean) as string[];
  if (newHires.length > 0 || d.hires.not_onboarded.length > 0) {
    const lines: string[] = [];
    if (newHires.length) lines.push(`${plural(newHires.length, "new hire", "new hires")} ${day}: ${newHires.map(esc).join(", ")}`);
    if (d.hires.not_onboarded.length) {
      const shown = d.hires.not_onboarded.slice(0, 6).map((h) => `${esc(h.name ?? "Name not on file")} (${h.days}d)`).join(", ");
      const more = d.hires.not_onboarded.length > 6 ? ` and ${d.hires.not_onboarded.length - 6} more` : "";
      lines.push(`Hired in the last 30 days, onboarding not finished: ${shown}${more}. ${link("/dashboard/recruiting/hires", "Open new hires")}`);
    }
    out.push({ title: "New hires", lines });
  }

  if (d.production.deals > 0) {
    out.push({
      title: `Production, ${day}`,
      lines: [`${money(d.production.ap)} annual premium posted on ${plural(d.production.deals, "deal", "deals")}. Production, not income. ${link("/dashboard/production", "Open the book")}`],
    });
  }

  if (d.content.awaiting_approval > 0 || d.content.failed > 0) {
    const lines: string[] = [];
    if (d.content.awaiting_approval > 0) lines.push(`${plural(d.content.awaiting_approval, "post is", "posts are")} waiting for your approval.`);
    if (d.content.failed > 0) lines.push(`${plural(d.content.failed, "post", "posts")} failed and need recovery.`);
    lines.push(link("/dashboard/admin/social-media-bot", "Open the Social Media Center"));
    out.push({ title: "Content", lines });
  }

  if (d.system.critical_24h.length > 0) {
    out.push({
      title: "System issues, last 24 hours",
      lines: [...d.system.critical_24h.map((a) => esc(a.subject ?? "Critical alert")), link("/dashboard/system-health", "Open System")],
    });
  }
  return out;
}

export function overviewSubject(d: OverviewData, sections: Section[]): string {
  const apps = d.applicants.licensed.length + d.applicants.unlicensed.length;
  const bits = [
    apps > 0 ? plural(apps, "applicant", "applicants") : null,
    d.interviews.today.length > 0 ? `${d.interviews.today.length} on today's calendar` : null,
    d.production.deals > 0 ? `${money(d.production.ap)} production` : null,
  ].filter(Boolean);
  if (sections.length === 0) return "Galaxy daily overview: nothing needs you";
  return `Galaxy daily overview: ${bits.length ? bits.join(", ") : `${sections.length} to look at`}`;
}

export function renderOverview(d: OverviewData): { subject: string; html: string; text: string; sections: Section[] } {
  const sections = buildSections(d);
  const body = sections.length === 0
    ? `<p style="margin:0;font-size:16px;line-height:24px;color:#222">Nothing needs you today. No new applicants, no interviews on the calendar, no late follow-ups, no system issues.</p>`
    : sections.map((s) => `
      <div style="margin:0 0 22px">
        <h2 style="margin:0 0 8px;font-size:15px;line-height:20px;color:#111;text-transform:uppercase;letter-spacing:.06em">${esc(s.title)}</h2>
        ${s.lines.map((l) => `<p style="margin:0 0 6px;font-size:16px;line-height:24px;color:#222">${l}</p>`).join("")}
      </div>`).join("");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:20px 16px">
    <p style="margin:0 0 18px;font-size:13px;line-height:18px;color:#666">Galaxy OS · owner overview · ${esc(dayWords(d.today))} · Arizona time</p>
    ${body}
    <p style="margin:24px 0 0;padding-top:14px;border-top:1px solid #e5e5e5;font-size:13px;line-height:19px;color:#666">
      One message a day, in place of the per-person notices. Change the time or turn it off under ${link("/dashboard/system-health", "System")}.
    </p>
  </div>`;
  const text = sections.length === 0
    ? "Nothing needs you today."
    : sections.map((s) => `${s.title}\n${s.lines.map((l) => "- " + l.replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, "$2 ($1)").replace(/<[^>]+>/g, "")).join("\n")}`).join("\n\n");
  return { subject: overviewSubject(d, sections), html, text, sections };
}

/** "07:00" + a Phoenix clock reading -> is this the hour to send? Phoenix has no DST. */
export function isSendHour(timeAz: string, now: Date): boolean {
  const m = /^([01]\d|2[0-3]):[0-5]\d$/.exec(timeAz.trim());
  if (!m) return false;
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Phoenix" }).format(now));
  return hour === Number(m[1]);
}

export function phoenixDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(now);
}
