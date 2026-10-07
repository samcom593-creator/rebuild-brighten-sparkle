// Sunday reminders for people starting Monday (Sam 2026-10-06, reworked 2026-10-07).
// Starters come from Recruit Pipeline's "Expected start" (agent_start_plans via
// monday_starters()). Order matters: each starter gets a reminder email and a text
// FIRST, then the digest to Sam, OB and the active managers reports what actually
// went out. Sam also gets a phone push with the totals, so a run that sends nothing
// is never silent.
// Every real send is claimed in monday_starter_notifications first, so a double fire
// can never double-send; a claim that ended "failed" may be retried by a later run.
// {"dry_run":true} sends the emails to test_to only and sends no texts or pushes.
const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const SAM_EMAIL = "info@kingofsales.net"; // same inbox onboarding email replies go to
const SAM_NTFY = "https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb";

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const rpc = (fn: string, args: unknown = {}) => rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const first = (n: string) => (n || "there").trim().split(/\s+/)[0];

function nextMonday(): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" }));
  const dow = now.getDay() || 7; // Mon=1 .. Sun=7
  now.setDate(now.getDate() + ((8 - dow) % 7 || 7));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
const pretty = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

async function setting(key: string): Promise<string> {
  const rows = await rest(`system_settings?select=value&key=eq.${key}`);
  return (rows?.[0]?.value ?? "").replace(/^"|"$/g, "");
}

type Starter = { name: string; email: string | null; phone: string | null; manager: string | null; source: string; application_id: string | null };

Deno.serve(async (req) => {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer !== KEY && !(await rpc("check_monday_reminder_secret", { p: bearer }).catch(() => false))) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const dry = body.dry_run === true;
  const testTo: string = body.test_to ?? SAM_EMAIL;
  const monday: string = body.monday ?? nextMonday();
  const when = pretty(monday);
  const resendKey = await setting("resend_api_key");
  const from = (await setting("onboarding_email_from_address")) || "Sam James <sam@apex-financial.org>";
  const out: Record<string, unknown>[] = [];

  // Claim a send. Returns the claim id, -1 for a dry run, or null when this Monday's
  // send already happened (or is in flight). A claim that ended "failed" is retaken.
  async function claim(kind: string, recipient: string): Promise<number | null> {
    if (dry) return -1;
    const rows = await rest("monday_starter_notifications?on_conflict=monday,kind,recipient", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ monday, kind, recipient }),
    });
    if (rows?.[0]?.id) return rows[0].id;
    const q = `monday=eq.${monday}&kind=eq.${kind}&recipient=eq.${encodeURIComponent(recipient)}&status=eq.failed`;
    const retaken = await rest(`monday_starter_notifications?${q}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "retrying" }),
    });
    return retaken?.[0]?.id ?? null;
  }
  async function finish(id: number, status: string, detail: string) {
    if (id > 0) await rest(`monday_starter_notifications?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status, detail: detail.slice(0, 500) }) });
  }
  async function email(kind: string, to: string, subject: string, html: string): Promise<string> {
    const id = await claim(kind, to);
    if (id === null) { out.push({ kind, to, status: "already_sent" }); return "already_sent"; }
    const realTo = dry ? testTo : to;
    // One failed send must not stop the rest of the list, and the claimed row must
    // say what happened instead of sitting at its default forever.
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [realTo], reply_to: SAM_EMAIL, subject: dry ? `[TEST for ${to}] ${subject}` : subject, html }),
      });
      const j = await r.json().catch(() => ({}));
      const status = r.ok && j.id ? "sent" : "failed";
      await finish(id, status, r.ok ? `resend:${j.id}` : `${r.status} ${JSON.stringify(j)}`);
      out.push({ kind, to: realTo, status, id: j.id ?? null, error: r.ok ? undefined : j });
      return status;
    } catch (e) {
      await finish(id, "failed", `exception: ${String(e)}`).catch((err) => console.error("finish failed", err));
      out.push({ kind, to: realTo, status: "failed", error: String(e) });
      return "failed";
    }
  }
  async function text(s: Starter): Promise<string> {
    if (!s.phone) return "no phone";
    if (dry) return "not sent (dry run)";
    const id = await claim("starter_sms", s.phone);
    if (id === null) { out.push({ kind: "starter_sms", to: s.phone, status: "already_sent" }); return "already_sent"; }
    try {
      const r = await fetch(`${SB}/functions/v1/send-sms-auto-detect`, {
        method: "POST", headers: H,
        body: JSON.stringify({
          to: s.phone,
          // With the application id the sender uses the carrier on file for this person.
          ...(s.application_id ? { applicationId: s.application_id } : {}),
          message: `Hi ${first(s.name)}, it's Sam from APEX Financial. Reminder: you start tomorrow, ${when}. ${s.manager ?? "Your manager"} will check in with you today.`,
        }),
      });
      const j = await r.json().catch(() => ({}));
      // send-sms-auto-detect reports outcome: sent | skipped (no carrier on file) | failed.
      const status = j.outcome === "sent" ? "sent" : j.outcome === "skipped" ? "skipped" : "failed";
      await finish(id, status, JSON.stringify(j));
      out.push({ kind: "starter_sms", to: s.phone, status });
      return status;
    } catch (e) {
      await finish(id, "failed", `exception: ${String(e)}`).catch((err) => console.error("finish failed", err));
      out.push({ kind: "starter_sms", to: s.phone, status: "failed", error: String(e) });
      return "failed";
    }
  }

  const starters: Starter[] = await rpc("monday_starters", { p_monday: monday });
  const managers: { name: string; email: string }[] = await rpc("active_manager_emails");

  // 1) Each starter: reminder email, then a text.
  const results: { s: Starter; emailed: string; texted: string }[] = [];
  for (const s of starters) {
    const mgr = s.manager ? `${esc(s.manager)} will` : "Your manager will";
    const emailed = s.email
      ? await email("starter_email", s.email, "Reminder: you start with APEX Financial tomorrow",
          `<p>Hi ${esc(first(s.name))},</p><p>Quick reminder that you start with APEX Financial tomorrow, ${esc(when)}. ${mgr} check in with you today to make sure you're set.</p><p>If anything comes up, just reply to this email.</p><p>See you tomorrow,<br>Sam James</p>`)
      : "no email";
    const texted = await text(s);
    results.push({ s, emailed, texted });
  }

  // 2) Digest. With starters it goes to Sam and every active manager; with none, to Sam only.
  const label = (v: string) => (v === "sent" ? "sent" : v === "already_sent" ? "sent earlier" : v === "skipped" ? "not sent (no carrier on file)" : v);
  const rows = results.map(({ s, emailed, texted }) =>
    `<tr><td>${esc(s.name)}</td><td>${s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : "no phone on file"}</td><td>${esc(s.email ?? "no email")}</td><td>${esc(s.manager ?? "")}</td><td>${esc(label(emailed))}</td><td>${esc(label(texted))}</td></tr>`).join("");
  const subject = starters.length
    ? `Starting ${when}: ${starters.length} new ${starters.length === 1 ? "person" : "people"} to check in with today`
    : `Starting ${when}: nobody scheduled`;
  const html = starters.length
    ? `<p>These people are set to start tomorrow, ${esc(when)}. Call or text each one today so they show up ready.</p>
       <table cellpadding="6" style="border-collapse:collapse" border="1"><tr><th>Name</th><th>Phone</th><th>Email</th><th>Manager</th><th>Reminder email</th><th>Reminder text</th></tr>${rows}</table>`
    : `<p>Nobody has an Expected start of ${esc(when)}. To schedule someone, open Recruit Pipeline and set their Expected start.</p>`;
  const recipients = new Map<string, string>();
  recipients.set(SAM_EMAIL, SAM_EMAIL);
  if (starters.length) for (const m of managers) recipients.set(m.email.trim().toLowerCase(), m.email.trim());
  let digests = 0;
  for (const to of recipients.values()) {
    if (dry && digests) break; // dry run: one sample digest
    await email("digest", to, subject, html);
    digests++;
  }

  // 3) Phone push to Sam with the totals (ASCII title: Deno rejects non-Latin-1 header bytes).
  const count = (k: "emailed" | "texted", v: string) => results.filter((r) => r[k] === v).length;
  const summary = starters.length
    ? `${starters.length} starting ${when}. Emails sent ${count("emailed", "sent")}, texts sent ${count("texted", "sent")}, texts skipped (no carrier) ${count("texted", "skipped")}, failed ${count("emailed", "failed") + count("texted", "failed")}. Digest to ${recipients.size} inbox(es).`
    : `Nobody has an Expected start of ${when}. Set it in Recruit Pipeline.`;
  if (!dry) {
    await fetch(SAM_NTFY, { method: "POST", headers: { Title: "Sunday starter reminders", Tags: "calendar" }, body: summary })
      .catch((e) => console.error("ntfy push failed", e));
  }
  return new Response(JSON.stringify({ ok: true, monday, dry_run: dry, starters: starters.length, managers: managers.length, summary, results: out }), {
    headers: { "Content-Type": "application/json" },
  });
});
