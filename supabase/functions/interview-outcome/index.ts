// interview-outcome — the one-tap outcome link behind the "Did X show?" push (MP-309, 2026-10-28).
//
// 113 Calendly bookings in 90 days, outcome recorded on 1. fn_interview_outcome_ask pushes Sam four signed links
// 20 minutes after each call ends; tapping one lands here. The link is the credential: ?id=<interview_events.id>
// &o=<completed|no_show|hired|no_answer>&k=HMAC-SHA256(APEX_BOT_TOKEN, "<id>:<o>") in hex, verified in constant time
// before the service-role client does anything. The write goes through cc_dispose_interview, the same RPC the
// Interview Recovery page uses, so the application status moves exactly as it would from the page. A no-show is
// also recorded on Calendly (so its own no-show stats stay true) and the prospect is emailed their reschedule link
// through the suppression-gated sender. Idempotent: a second tap on an already-recorded outcome just says so.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { sendEmail } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("APEX_BOT_TOKEN") ?? "";
const CALENDLY_TOKEN = Deno.env.get("CALENDLY_API_TOKEN") ?? "";
const OUTCOMES: Record<string, string> = { completed: "showed", no_show: "a no-show", hired: "hired", no_answer: "no answer" };
const encoder = new TextEncoder();

function page(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,system-ui;padding:32px;max-width:520px;margin:auto;line-height:1.5"><h2>${title}</h2><p>${body}</p></body>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
function toHex(buf: ArrayBuffer): string { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(hex: string): ArrayBuffer | null { if (!/^[0-9a-f]{64}$/.test(hex)) return null; const out = new Uint8Array(32); for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return out.buffer; }
async function verify(secret: string, message: string, providedHex: string): Promise<boolean> {
  const digest = hexToBytes(providedHex); if (!digest) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return await crypto.subtle.verify("HMAC", key, digest, encoder.encode(message));
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return page("Not here", "This link only answers GET.", 405);
  if (!BOT_TOKEN) return page("Not configured", "APEX_BOT_TOKEN is not set, so outcome links cannot be verified.", 503);
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  const o = (url.searchParams.get("o") ?? "").trim();
  const k = (url.searchParams.get("k") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(id) || !(o in OUTCOMES)) return page("Bad link", "That outcome link is incomplete.", 400);
  if (!(await verify(BOT_TOKEN, `${id}:${o}`, k))) return page("Not your link", "That outcome link is not signed for this call.", 401);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: ev, error: evErr } = await sb.from("interview_events").select("id, invitee_name, invitee_email, outcome, calendly_invitee_uri, reschedule_url, event_type_name, scheduled_at").eq("id", id).maybeSingle();
  if (evErr) return page("Could not read the call", evErr.message, 500);
  if (!ev) return page("No such call", "That booking is not in the book any more.", 404);
  const first = (ev.invitee_name ?? "they").split(" ")[0];
  if (ev.outcome) return page(`Already recorded: ${first} ${OUTCOMES[ev.outcome] ?? ev.outcome}`, `This call was logged as <b>${ev.outcome}</b> earlier. Change it on the Interview Recovery page if that was wrong.`);

  const { error: rpcErr } = await sb.rpc("cc_dispose_interview", { p_id: id, p_outcome: o, p_notes: `via one-tap link ${new Date().toISOString().slice(0, 16)}Z` });
  if (rpcErr) return page("Could not record it", rpcErr.message, 500);

  const receipts: string[] = [];
  if (o === "no_show") {
    // Calendly's own no-show mark, so its reports agree with ours. Failure here is reported, never hidden.
    if (CALENDLY_TOKEN && ev.calendly_invitee_uri) {
      try {
        const r = await fetch("https://api.calendly.com/invitee_no_shows", { method: "POST", headers: { Authorization: `Bearer ${CALENDLY_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ invitee: ev.calendly_invitee_uri }) });
        receipts.push(r.ok || r.status === 409 ? "marked no-show on Calendly" : `Calendly no-show mark failed (${r.status})`);
      } catch (e) { receipts.push(`Calendly no-show mark threw: ${String((e as Error).message).slice(0, 80)}`); }
    } else receipts.push("no Calendly invitee on file, Calendly not marked");
    if (ev.invitee_email && ev.reschedule_url) {
      const res = await sendEmail({
        to: ev.invitee_email,
        subject: "missed you, grab another time",
        text: `yo ${first}, it's sam. tried calling for our ${ev.event_type_name ?? "call"} and didn't get you. no stress, grab another time here and i'll call you then:\n${ev.reschedule_url}\n\nsam`,
        tagName: "interview_no_show_rebook",
      });
      receipts.push(res.ok ? `rebook email sent to ${ev.invitee_email}` : `rebook email not sent (${res.refused ?? res.error ?? "unknown"})`);
    } else receipts.push("no email on file, no rebook email");
  }
  return page(`Got it: ${first} ${OUTCOMES[o]}`, `Recorded on the book${ev.scheduled_at ? ` for the ${new Date(ev.scheduled_at).toLocaleString("en-US", { timeZone: "America/Phoenix", weekday: "short", hour: "numeric", minute: "2-digit" })} call` : ""}.${receipts.length ? " " + receipts.join("; ") + "." : ""}`);
});
