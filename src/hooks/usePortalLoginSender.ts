import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "sonner";

type DryRunRecipient = { agent_id: string; name: string; email: string; status: string | null };
type DryRunResponse = { success: boolean; dry_run: true; count: number; recipients: DryRunRecipient[] };
type SendResponse = {
  success: boolean;
  message?: string;
  results?: { total: number; sent: number; skipped: number; failed: number; details?: unknown[] };
};

/**
 * One path for "send portal login(s)" from any admin surface.
 *
 * Always dry-runs first so the confirm dialog shows the REAL recipient count
 * the function will mail (eligible = not deactivated, not terminated, has a
 * login + a real email, deduped by address) instead of the number of rows the
 * caller happened to select. Before this, AgentManagement toasted
 * "sent to N" for N = selected ids while the function ignored agent_ids and
 * mailed everyone — a 3-selected/100-sent lie on both ends.
 *
 * The success toast reads the function's own results, never the caller's
 * count, so it cannot claim a send that did not happen.
 */
export function usePortalLoginSender() {
  const askConfirm = useConfirm();
  const [sending, setSending] = useState(false);

  const send = useCallback(async (agentIds?: string[]): Promise<SendResponse["results"] | null> => {
    setSending(true);
    try {
      const body = agentIds && agentIds.length > 0 ? { agent_ids: agentIds } : {};
      const dry = await supabase.functions.invoke<DryRunResponse>("send-bulk-portal-logins", {
        body: { ...body, dry_run: true },
      });
      if (dry.error) { toast.error(dry.error.message || "Could not count recipients"); return null; }
      const count = dry.data?.count ?? 0;
      const recipients = dry.data?.recipients ?? [];
      if (count === 0) {
        toast.error("No eligible agents (need an active login + a real email)");
        return null;
      }
      const preview = recipients.slice(0, 6).map((r) => r.name).join(", ");
      const more = count > 6 ? ` +${count - 6} more` : "";
      const ok = await askConfirm({
        title: `Send portal logins to ${count} agent${count === 1 ? "" : "s"}?`,
        description: `${preview}${more}. Each gets a one-tap magic login link at their email (managers CC'd).`,
        confirmText: `Send ${count}`,
      });
      if (!ok) return null;

      const res = await supabase.functions.invoke<SendResponse>("send-bulk-portal-logins", { body });
      if (res.error) { toast.error(res.error.message || "Send failed"); return null; }
      const r = res.data?.results;
      if (!r) { toast.error("Send returned no receipt"); return null; }
      if (r.failed > 0) {
        toast.warning(`Sent ${r.sent}, failed ${r.failed}, skipped ${r.skipped}`);
      } else {
        toast.success(`Sent ${r.sent} portal login${r.sent === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} skipped)` : ""}`);
      }
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
      return null;
    } finally {
      setSending(false);
    }
  }, [askConfirm]);

  return { send, sending };
}
