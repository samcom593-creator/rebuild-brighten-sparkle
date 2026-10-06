/**
 * Personal invitations — active list by default, full history on demand.
 *
 * Reads list_invitations() (SECURITY DEFINER, scoped server-side: admin all,
 * a manager their own + downline uplines, an agent only what they created).
 * The raw token is never in this payload; Copy asks invitation_link() for the
 * one pending row the caller may manage. Status comes from the server
 * (fn_invitation_status) — this table never recomputes it.
 *
 * Copy and Email draft are recorded as SHARES (record_invitation_share), never
 * as deliveries: nothing on this surface sends an email.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Copy, Mail, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { resolveBrand } from "@/config/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConfirm } from "@/hooks/useConfirm";
import {
  INVITATION_STATUS_LABEL,
  agencyLabel,
  formatRole,
  invitationActions,
  invitationMailto,
  type InvitationStatus,
} from "@/lib/invitationState";
import { inviteUrlFromPath, shareInvitation, useInvitations, type InvitationRow } from "./invitationApi";

const BRAND = resolveBrand();

const STATUS_CLASS: Record<InvitationStatus, string> = {
  pending: "border-primary/30 bg-primary/10 text-primary",
  accepted: "border-border bg-muted text-foreground",
  expired: "border-border bg-muted text-muted-foreground",
  revoked: "border-destructive/30 bg-destructive/10 text-destructive",
  superseded: "border-border bg-muted text-muted-foreground",
};

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : "—");

async function fetchLink(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("invitation_link" as never, { p_id: id } as never);
  if (error) throw error;
  const link = data as unknown as { ok: boolean; path?: string; status?: string };
  if (!link?.ok || !link.path) {
    toast.error(`This invitation is ${link?.status ?? "no longer pending"}; its link cannot be shared.`);
    return null;
  }
  return inviteUrlFromPath(link.path);
}

export function InvitationsTable({
  roleFilter,
  title = "Invitations",
}: {
  /** Only show invitations for these target roles (e.g. manager invites). */
  roleFilter?: string[];
  title?: string;
}) {
  const queryClient = useQueryClient();
  const askConfirm = useConfirm();
  const [history, setHistory] = useState(false);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const list = useInvitations(history, history ? search : "");

  const rows = useMemo(() => {
    const all = list.data?.rows ?? [];
    return roleFilter ? all.filter((r) => r.target_role && roleFilter.includes(r.target_role)) : all;
  }, [list.data, roleFilter]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["invitations"] });

  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That action did not complete.");
    } finally {
      setBusyId(null);
    }
  }

  const copy = (row: InvitationRow) => run(row.id, async () => {
    const url = await fetchLink(row.id);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    await shareInvitation(row.id, "copy");
    toast.success("Link copied.");
    await refresh();
  });

  const emailDraft = (row: InvitationRow) => run(row.id, async () => {
    if (!row.recipient_email) {
      toast.error("This invitation has no recipient email. Copy the link instead.");
      return;
    }
    const url = await fetchLink(row.id);
    if (!url) return;
    await shareInvitation(row.id, "email_draft");
    window.location.href = invitationMailto({
      recipientEmail: row.recipient_email,
      recipientName: row.recipient_name,
      url,
      expiresAt: row.expires_at,
      orgName: BRAND.legalName,
    });
    await refresh();
  });

  const revoke = (row: InvitationRow) => run(row.id, async () => {
    const ok = await askConfirm({
      title: "Revoke this invitation?",
      description: "The link stops working immediately. You can issue a new one with Regenerate.",
      confirmText: "Revoke",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.rpc("revoke_invitation" as never, { p_id: row.id } as never);
    if (error) throw error;
    toast.success("Invitation revoked.");
    await refresh();
  });

  const regenerate = (row: InvitationRow) => run(row.id, async () => {
    const ok = await askConfirm({
      title: "Issue a new link?",
      description: "The current link is marked superseded and stops working. The new link carries the same terms.",
      confirmText: "Regenerate",
      tone: "primary",
    });
    if (!ok) return;
    const { data, error } = await supabase.rpc("regenerate_invitation" as never, { p_id: row.id } as never);
    if (error) throw error;
    const fresh = data as unknown as { id?: string; path?: string };
    if (!fresh?.id || !fresh.path) throw new Error("The new link was not returned.");
    const url = inviteUrlFromPath(fresh.path);
    try {
      await navigator.clipboard.writeText(url);
      await shareInvitation(fresh.id, "copy");
      toast.success("New link created and copied.");
    } catch (err) {
      console.warn("clipboard blocked", err);
      toast.success("New link created. Use Copy on the new row.");
    }
    await refresh();
  });

  const counts = list.data?.counts;

  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5" role="tablist" aria-label="Invitation view">
          <Button size="sm" variant={history ? "ghost" : "secondary"} className="h-7" role="tab" aria-selected={!history} onClick={() => setHistory(false)}>
            Active{counts ? ` · ${counts.pending}` : ""}
          </Button>
          <Button size="sm" variant={history ? "secondary" : "ghost"} className="h-7" role="tab" aria-selected={history} onClick={() => setHistory(true)}>
            History{counts ? ` · ${counts.total}` : ""}
          </Button>
        </div>
        {history && (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search invitations"
              className="h-9 pl-8"
              placeholder="Name, email or note"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      {history && counts && (
        <p className="text-xs text-muted-foreground" data-testid="invitation-counts">
          {(["pending", "accepted", "expired", "revoked", "superseded"] as InvitationStatus[])
            .map((s) => `${counts[s]} ${INVITATION_STATUS_LABEL[s].toLowerCase()}`)
            .join(" · ")}
        </p>
      )}

      {list.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {["inv-sk-a", "inv-sk-b", "inv-sk-c"].map((k) => (
            <div key={k} className="h-12 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : list.error ? (
        <p className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
          Invitations could not be loaded{list.error instanceof Error ? `: ${list.error.message}` : "."}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          {history ? "No invitations match." : "No pending invitations."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Upline · agency</TableHead>
                <TableHead>Offer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const actions = invitationActions(row.status);
                const busy = busyId === row.id;
                const exceptions = row.carrier_exceptions ?? [];
                return (
                  <TableRow key={row.id} data-testid={`invite-row-${row.id}`}>
                    <TableCell className="min-w-[10rem]">
                      <p className="text-sm font-medium text-foreground">{row.recipient_name || row.notes || "Open invitation"}</p>
                      <p className="text-xs text-muted-foreground">{row.recipient_email ?? "Any email (legacy link)"}</p>
                    </TableCell>
                    <TableCell className="text-sm">{formatRole(row.target_role)}</TableCell>
                    <TableCell className="text-sm">
                      <p>{row.upline_name ?? "Set on join"}</p>
                      <p className="text-xs text-muted-foreground">{row.agency_key ? agencyLabel(row.agency_key, BRAND.legalName) : "—"}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      <p>{row.offered_comp_pct != null ? `${Number(row.offered_comp_pct)}%` : "No offer"}</p>
                      {exceptions.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {exceptions.map((e) => `${e.carrier_name} ${Number(e.pct)}%`).join(", ")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_CLASS[row.status]}>{INVITATION_STATUS_LABEL[row.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <p>Sent {fmtDate(row.created_at)}{row.created_by_name ? ` by ${row.created_by_name}` : ""}</p>
                      <p>
                        {row.status === "accepted"
                          ? `Accepted ${fmtDate(row.used_at)}${row.accepted_agent_name ? ` · ${row.accepted_agent_name}` : ""}`
                          : row.status === "superseded"
                            ? `Replaced ${fmtDate(row.superseded_at)}`
                            : row.status === "revoked"
                              ? `Revoked ${fmtDate(row.revoked_at)}`
                              : `Expires ${fmtDate(row.expires_at)}`}
                      </p>
                      {row.share_count > 0 && <p>Shared {row.share_count}× · last {fmtDate(row.last_shared_at)}</p>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {actions.copy && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => copy(row)} aria-label="Copy invitation link">
                            <Copy className="h-4 w-4" />
                          </Button>
                        )}
                        {actions.share && row.recipient_email && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => emailDraft(row)} aria-label="Open email draft with invitation link">
                            <Mail className="h-4 w-4" />
                          </Button>
                        )}
                        {actions.regenerate && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => regenerate(row)} aria-label="Regenerate invitation link">
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        {actions.revoke && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => revoke(row)}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label="Revoke invitation"
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {list.data && list.data.rows.length >= list.data.limit && (
        <p className="text-xs text-muted-foreground">Showing the newest {list.data.limit}. Search history to find older invitations.</p>
      )}
    </section>
  );
}
