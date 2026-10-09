// Emails the hire once their onboarding has been sent to Aflac.
//
// Called by the Aflac page right after aflac_mark_submitted() succeeds. The recipient is read from the
// submission ROW, never from the request body, so this cannot be used to mail an arbitrary address.
// Idempotent: a second call for the same submission sends nothing. The outcome (sent or the error) is
// written back to the row, so "was the hire told" is a fact in the database, not a toast.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { sendEmail } from "../_shared/email.ts";
import { requireSendAuth } from "../_shared/require-send-auth.ts";
import { buildAflacNotice } from "../_shared/aflac-notice.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const auth = await requireSendAuth(req);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  let submissionId = "";
  try {
    const body = await req.json();
    submissionId = String(body?.submission_id ?? "");
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(submissionId)) return json({ ok: false, error: "submission_id required" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: row, error: readErr } = await supabase
    .from("aflac_submissions")
    .select("id, first_name, email, agent_id, intake_id, hire_notified_at")
    .eq("id", submissionId)
    .maybeSingle();
  if (readErr) return json({ ok: false, error: readErr.message }, 500);
  if (!row) return json({ ok: false, error: "submission not found" }, 404);
  if (row.hire_notified_at) return json({ ok: true, already_notified: true });

  const notice = buildAflacNotice({ firstName: row.first_name, email: row.email });
  const result = await sendEmail({
    to: row.email,
    subject: notice.subject,
    html: notice.html,
    text: notice.text,
    unsubscribe_token: row.agent_id ?? row.intake_id,
    tagName: "aflac-submitted",
  });

  const patch = result.ok
    ? { hire_notified_at: new Date().toISOString(), hire_notify_error: null }
    : { hire_notify_error: (result.error ?? "send failed").slice(0, 300) };
  const { error: writeErr } = await supabase.from("aflac_submissions").update(patch).eq("id", row.id);
  if (writeErr) return json({ ok: result.ok, receipt_write_failed: writeErr.message }, 500);

  return json({ ok: result.ok, error: result.ok ? undefined : result.error }, result.ok ? 200 : 502);
});
