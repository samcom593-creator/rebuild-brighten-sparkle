// Sunday reminders for people starting Monday (Sam 2026-10-06).
// 1) Digest with name/phone/email/manager to Sam, OB and every active manager.
// 2) Reminder email to each starter.  3) Reminder text via send-sms-auto-detect
//    (records an honest "skipped" when no carrier is on file).
// Every real send is claimed in monday_starter_notifications first, so a double
// fire can never double-send. {"dry_run":true} sends everything to test_to only.
const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

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

Deno.serve(async (req) => {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer !== KEY && !(await rpc("check_monday_reminder_secret", { p: bearer }).catch(() => false))) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const dry = body.dry_run === true;
  const testTo: string = body.test_to ?? "info@kingofsales.net";
  const monday: string = body.monday ?? nextMonday();
  const when = pretty(monday);
  const resendKey = await setting("resend_api_key");
  const from = (await setting("onboarding_email_from_address")) || "Sam James <sam@apex-financial.org>";
  const out: Record<string, unknown>[] = [];

  async function claim(kind: string, recipient: string): Promise<number | null> {
    if (dry) return -1;
    const rows = await rest("monday_starter_notifications?on_conflict=monday,kind,recipient", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ monday, kind, recipient }),
    });
    return rows?.[0]?.id ?? null; // null = already sent for this Monday
  }
  async function finish(id: number, status: string, detail: string) {
    if (id > 0) await rest(`monday_starter_notifications?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status, detail: detail.slice(0, 500) }) });
  }
  async function email(kind: string, to: string, subject: string, html: string) {
    const id = await claim(kind, to);
    if (id === null) return out.push({ kind, to, status: "already_sent" });
    const realTo = dry ? testTo : to;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [realTo], subject: dry ? `[TEST for ${to}] ${subject}` : subject, html }),
    });
    const j = await r.json().catch(() => ({}));
    const status = r.ok && j.id ? "sent" : "failed";
    await finish(id, status, r.ok ? `resend:${j.id}` : `${r.status} ${JSON.stringify(j)}`);
    out.push({ kind, to: realTo, status, id: j.id ?? null, error: r.ok ? undefined : j });
  }

  const starters: { name: string; email: string | null; phone: string | null; manager: string | null }[] = await rpc("monday_starters", { p_monday: monday });
  const managers: { name: string; email: string }[] = await rpc("active_manager_emails");

  // 1) Digest
  const rows = starters.map((s) =>
    `<tr><td>${esc(s.name)}</td><td>${s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : "no phone on file"}</td><td>${esc(s.email ?? "no email")}</td><td>${esc(s.manager ?? "")}</td></tr>`).join("");
  const subject = starters.length ? `Starting ${when}: ${starters.length} new ${starters.length === 1 ? "person" : "people"} to check in with today` : `Starting ${when}: nobody scheduled`;
  const html = starters.length
    ? `<p>These people are set to start tomorrow, ${esc(when)}. Call or text each one today so they show up ready.</p>
       <table cellpadding="6" style="border-collapse:collapse" border="1"><tr><th>Name</th><th>Phone</th><th>Email</th><th>Manager</th></tr>${rows}</table>
       <p>Each of them also got a reminder email${starters.some((s) => s.phone) ? " and a text where we have their carrier" : ""}.</p>`
    : `<p>Nobody has a start date of ${esc(when)} in the system. If someone is starting, set their start date on their agent profile.</p>`;
  const sentTo = new Set<string>();
  for (const m of managers) {
    const e = m.email.trim().toLowerCase();
    if (sentTo.has(e) || (dry && sentTo.size)) continue; // dry run: one sample digest
    sentTo.add(e);
    await email("digest", m.email, subject, html);
  }

  // 2) + 3) Starter reminders
  for (const s of starters) {
    const msgName = first(s.name);
    const mgr = s.manager ? `${esc(s.manager)} will` : "Your manager will";
    if (s.email) {
      await email("starter_email", s.email, "Reminder: you start with APEX Financial tomorrow",
        `<p>Hi ${esc(msgName)},</p><p>Quick reminder that you start with APEX Financial tomorrow, ${esc(when)}. ${mgr} check in with you today to make sure you're set.</p><p>If anything comes up, just reply to this email.</p><p>See you tomorrow,<br>Sam James</p>`);
    }
    if (s.phone && !dry) {
      const id = await claim("starter_sms", s.phone);
      if (id === null) { out.push({ kind: "starter_sms", to: s.phone, status: "already_sent" }); continue; }
      const r = await fetch(`${SB}/functions/v1/send-sms-auto-detect`, {
        method: "POST", headers: H,
        body: JSON.stringify({ to: s.phone, message: `Hi ${msgName}, it's Sam from APEX Financial. Reminder: you start tomorrow, ${when}. ${s.manager ?? "Your manager"} will check in with you today.` }),
      });
      const j = await r.json().catch(() => ({}));
      const status = j.success === true && j.status !== "skipped" ? "sent" : (j.status === "skipped" ? "skipped" : "failed");
      await finish(id, status, JSON.stringify(j));
      out.push({ kind: "starter_sms", to: s.phone, status });
    }
  }
  return new Response(JSON.stringify({ ok: true, monday, dry_run: dry, starters: starters.length, managers: managers.length, results: out }), {
    headers: { "Content-Type": "application/json" },
  });
});
