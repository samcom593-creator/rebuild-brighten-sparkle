// The IG desk's writes. Every one goes through a SECURITY DEFINER RPC or an edge function with the
// signed-in admin/manager JWT; the client holds no grant on inbox_messages.
//
// DELIVERY TRUTH: "delivered" is said only on a Meta mid (response.id). A 200 without an id is
// 'sent · no receipt'. That rule is the 465-row InsuraCloud lesson applied to DMs, and the test
// pins it (igRow.test.tsx).
import { supabase } from "@/integrations/supabase/client";
import { disposeInterview } from "@/components/calendar/calendarApi";
import { EMAIL, SEND_RESULT } from "./igCopy";
import type { IgRow, IgThread } from "./igTypes";

export type IgThreadActionName =
  | "handled" | "unhandled" | "snoozed" | "unsnoozed" | "dismissed" | "relabeled" | "mine" | "emailed" | "sam_sent" | "tag_refused" | "note";

export interface ThreadActionOpts {
  until?: string | null;
  note?: string | null;
  intent?: string | null;
  meta?: Record<string, unknown>;
}

export interface ThreadActionRow { id: string; action: string; inbox_message_id?: string | null; meta?: Record<string, unknown> }

export async function threadAction(externalId: string, action: IgThreadActionName, opts: ThreadActionOpts = {}): Promise<ThreadActionRow> {
  // fn_ig_thread_action is newer than the generated client types (types.ts regen needs the dead PAT).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("fn_ig_thread_action", {
    p_external_id: externalId,
    p_action: action,
    p_until: opts.until ?? null,
    p_note: opts.note ?? null,
    p_intent: opts.intent ?? null,
    p_meta: opts.meta ?? {},
  });
  if (error) throw new Error(error.message ?? "didn't save");
  return data as ThreadActionRow;
}

export async function fetchThread(externalId: string): Promise<IgThread> {
  // fn_ig_thread is newer than the generated client types (types.ts regen needs the dead PAT).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("fn_ig_thread", { p_external_id: externalId });
  if (error) throw new Error(error.message ?? "couldn't load the thread");
  return data as IgThread;
}

export { disposeInterview };

export type SendKind = "delivered" | "no_link" | "no_receipt" | "window_closed" | "link_blocked" | "token_dead" | "tag_not_permitted" | "error";
export interface SendResult { kind: SendKind; line: string; id: string | null; ok: boolean }

interface SenderBody {
  ok?: boolean;
  id?: string | null;
  link_stripped?: boolean;
  error?: string;
  kind?: string;
  queued?: boolean | string;
  held?: boolean;
}

/** The result line, from the sender's response only. Pure; the test pins every branch. */
export function classifySendResponse(body: SenderBody | null | undefined): SendResult {
  const b = body ?? {};
  if (b.ok) {
    if (b.id && b.link_stripped) return { kind: "delivered", line: SEND_RESULT.deliveredNoLink, id: b.id, ok: true };
    if (b.id) return { kind: "delivered", line: SEND_RESULT.delivered, id: b.id, ok: true };
    if (b.link_stripped) return { kind: "no_link", line: SEND_RESULT.noLink, id: null, ok: true };
    return { kind: "no_receipt", line: SEND_RESULT.noReceipt, id: null, ok: true };
  }
  const kind = String(b.kind ?? "");
  if (kind === "window_closed") return { kind: "window_closed", line: SEND_RESULT.windowClosed, id: null, ok: false };
  if (kind === "link_blocked") return { kind: "link_blocked", line: SEND_RESULT.linkBlocked, id: null, ok: false };
  if (kind === "token_dead" || b.held) return { kind: "token_dead", line: SEND_RESULT.tokenDead, id: null, ok: false };
  if (kind === "tag_not_permitted") return { kind: "tag_not_permitted", line: SEND_RESULT.tagNotPermitted, id: null, ok: false };
  const err = String(b.error ?? "meta said no").slice(0, 140);
  return { kind: "error", line: err, id: null, ok: false };
}

async function readInvokeErrorBody(error: unknown): Promise<SenderBody | null> {
  const ctx = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } } | null)?.context;
  if (!ctx || typeof ctx.clone !== "function") return null;
  try {
    const parsed = (await ctx.clone().json()) as SenderBody;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    console.warn("[ig-desk] sender error body unreadable", e);
    return null;
  }
}

/**
 * Sam's send. (1) his outbound row goes in FIRST (fn_ig_thread_action 'sam_sent': intent sam_manual,
 * auto_replied false, raw_payload.path 'desk') so the sender's stampOutcome lands the mid on HIS
 * row instead of inserting an auto_replied:true row that grades his words as bot lines; (2) the
 * sender runs with the signed-in JWT; (3) the result line is read off the response, never the status.
 */
export async function sendDm(row: IgRow, message: string, humanAgent = false): Promise<SendResult> {
  await threadAction(row.external_id, "sam_sent", { note: message, meta: humanAgent ? { human_agent: true } : {} });
  const { data, error } = await supabase.functions.invoke("send-instagram-dm", {
    body: {
      recipient_id: row.external_id,
      external_id: row.external_id,
      message,
      tag: "desk",
      ...(humanAgent ? { human_agent: true } : {}),
    },
  });
  if (error) {
    const body = await readInvokeErrorBody(error);
    return classifySendResponse(body ?? { ok: false, error: (error as Error).message });
  }
  return classifySendResponse(data as SenderBody);
}

export interface EmailLinkResult { ok: boolean; resendId: string | null; suppressed: boolean; error?: string }

/** Only when a Resend id comes back is the 'emailed' action written. */
export async function emailLink(row: IgRow): Promise<EmailLinkResult> {
  const to = (row.email ?? "").trim().toLowerCase();
  if (!to) return { ok: false, resendId: null, suppressed: false, error: "no email" };
  // Best-effort suppression read. A read refused by RLS is unknown, not "not suppressed"; the send
  // response still decides, so this only short-circuits the obvious case.
  // email_suppressions is newer than the generated client types (types.ts regen needs the dead PAT).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sup = await (supabase as any).from("email_suppressions").select("email").eq("email", to).limit(1);
  if (!sup.error && Array.isArray(sup.data) && sup.data.length > 0) return { ok: false, resendId: null, suppressed: true };

  const handle = (row.handle ?? "").replace(/^@/, "") || null;
  const url = row.licensed ? EMAIL.licensedUrl : EMAIL.applyUrl(handle);
  const first = (row.name ?? "").trim().split(/\s+/)[0] || handle || "there";
  const { data, error } = await supabase.functions.invoke("send-email", {
    body: { to, subject: EMAIL.subject, text: EMAIL.body(first.toLowerCase(), url), from: EMAIL.from, reply_to: EMAIL.replyTo, tagName: EMAIL.tag },
  });
  if (error) {
    const body = (await readInvokeErrorBody(error)) as { error?: string } | null;
    const msg = String(body?.error ?? (error as Error).message ?? "send failed");
    return { ok: false, resendId: null, suppressed: /suppress/i.test(msg), error: msg };
  }
  const resendId = (data as { id?: string | null } | null)?.id ?? null;
  if (!resendId) return { ok: false, resendId: null, suppressed: false, error: "no resend id" };
  await threadAction(row.external_id, "emailed", { meta: { resend_id: resendId, to, url } });
  return { ok: true, resendId, suppressed: false };
}
