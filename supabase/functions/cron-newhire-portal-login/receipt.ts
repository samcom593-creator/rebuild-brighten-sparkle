// WP6 (2026-11-10): magic-link send receipts.
//
// cron-newhire-portal-login minted both tokens, then sent, and kept the outcome
// only in the HTTP response. v_newhire_needs_portal_login's 72h dedupe counted
// any minted token, so a failed send suppressed the next attempt exactly like a
// delivered one. Tokens are now minted as 'pending' and resolved here from the
// provider reply: 'sent' only with a message id, never on an error or a
// missing id (no fake success).

export type SendStatus = "pending" | "sent" | "failed" | "refused";

export interface ProviderReply {
  ok: boolean;
  id: string | null;
  error?: string;
  refused?: string;
}

export interface TokenReceipt {
  send_status: Exclude<SendStatus, "pending">;
  send_message_id: string | null;
  sent_at: string | null;
}

export function receiptFor(reply: ProviderReply, now: Date = new Date()): TokenReceipt {
  if (reply.ok && typeof reply.id === "string" && reply.id.trim().length > 0) {
    return { send_status: "sent", send_message_id: reply.id, sent_at: now.toISOString() };
  }
  if (reply.refused) {
    // Suppressed or non-routable: never attempted. The view backs off 30 days
    // and the hire lands on the staged call list instead.
    return { send_status: "refused", send_message_id: null, sent_at: null };
  }
  return { send_status: "failed", send_message_id: null, sent_at: null };
}

/** "jordan@example.com" -> "jor***@example.com". Dry-run output never carries a full address. */
export function maskEmail(addr: string | null | undefined): string {
  const s = String(addr ?? "").trim();
  const at = s.indexOf("@");
  if (at <= 0) return s ? `${s.slice(0, 1)}***` : "";
  return `${s.slice(0, Math.min(3, at))}***${s.slice(at)}`;
}
