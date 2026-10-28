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
 *
 * Grow redesign (2026-10-28, council finding 28): under lg each invitation is a
 * card (name, email, status in words, one "More" menu); from lg up the same rows
 * are a table that fits a 1022px column with nothing clipped. Every action lives
 * in the one labelled menu per row; Revoke and Replace are two-step through
 * useConfirm. Status words come from INVITATION_STATUS_LABEL, so the server's
 * "superseded" reads as "Replaced" everywhere here (finding 39).
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronDown, ClipboardCopy, Copy, Loader2, Mail, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { resolveBrand } from "@/config/brand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/recruiting/StatusPill";
import type { StatusTone } from "@/components/pipeline/worklist/worklistStatus";
import { formatDay } from "@/components/pipeline/worklist/worklistFormat";
import { useConfirm } from "@/hooks/useConfirm";
import {
  INVITATION_STATUS_LABEL,
  agencyLabel,
  formatRole,
  invitationActions,
  invitationMailto,
  type InvitationStatus,
} from "@/lib/invitationState";
import { contractingInfoFor, decodeInviteNote } from "@/lib/inviteContractingInfo";
import { ContractingCopyCard } from "./ContractingCopyCard";
import { inviteUrlFromPath, shareInvitation, useInvitations, type InvitationRow } from "./invitationApi";

const BRAND = resolveBrand();

/** The tint behind each status word. The word carries the meaning; the colour only helps. */
const STATUS_TONE: Record<InvitationStatus, StatusTone> = {
  pending: "primary",
  accepted: "neutral",
  expired: "warning",
  revoked: "danger",
  superseded: "neutral",
};

/** The server's status in the words people read; a status this client does not know is shown as it came, never hidden. */
function statusWord(status: string | null | undefined): string {
  if (!status) return "no longer pending";
  return ((INVITATION_STATUS_LABEL as Record<string, string | undefined>)[status] ?? status).toLowerCase();
}

/** What happened and when: "Expires Nov 4, 2026", "Accepted Oct 30, 2026 · Pat Lee", "Replaced Oct 29, 2026". */
function whenLine(row: InvitationRow): string {
  const word = INVITATION_STATUS_LABEL[row.status];
  switch (row.status) {
    case "accepted":
      return `${word} ${formatDay(row.used_at)}${row.accepted_agent_name ? ` · ${row.accepted_agent_name}` : ""}`;
    case "superseded":
      return `${word} ${formatDay(row.superseded_at)}`;
    case "revoked":
      return `${word} ${formatDay(row.revoked_at)}`;
    case "expired":
      return `${word} ${formatDay(row.expires_at)}`;
    default:
      return `Expires ${formatDay(row.expires_at)}`;
  }
}

/** "Created Oct 28, 2026 by Sam James". */
function createdLine(row: InvitationRow): string {
  return `Created ${formatDay(row.created_at)}${row.created_by_name ? ` by ${row.created_by_name}` : ""}`;
}

/** "Shared 2 times", or nothing. Shares are copies and mail drafts, never deliveries. */
function sharedLine(row: InvitationRow): string | null {
  if (row.share_count <= 0) return null;
  return `Shared ${row.share_count} ${row.share_count === 1 ? "time" : "times"}`;
}

const offerText = (row: InvitationRow) => (row.offered_comp_pct != null ? `${Number(row.offered_comp_pct)}% comp` : "No comp offer");

const exceptionsText = (row: InvitationRow) =>
  (row.carrier_exceptions ?? []).map((e) => `${e.carrier_name} ${Number(e.pct)}%`).join(", ");

async function fetchLink(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("invitation_link" as never, { p_id: id } as never);
  if (error) throw error;
  const link = data as unknown as { ok: boolean; path?: string; status?: string };
  if (!link?.ok || !link.path) {
    toast.error(`This invitation is ${statusWord(link?.status)}; its link cannot be shared.`);
    return null;
  }
  return inviteUrlFromPath(link.path);
}

interface RowMenuProps {
  row: InvitationRow;
  busy: boolean;
  /** True while this row's contracting dialog is open, so closing the menu does not pull focus back out of it. */
  infoOpen: boolean;
  onInfo: () => void;
  onCopy: () => void;
  onEmail: () => void;
  onReplace: () => void;
  onRevoke: () => void;
}

/** The one control per row. Every item is a word, 44px tall; Revoke and Replace confirm before they act. */
function RowMenu({ row, busy, infoOpen, onInfo, onCopy, onEmail, onReplace, onRevoke }: RowMenuProps) {
  const actions = invitationActions(row.status);
  const who = row.recipient_name || row.recipient_email || "this invitation";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-11 px-3" disabled={busy} aria-label={`More actions for ${who}`}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          More <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onCloseAutoFocus={(e) => { if (infoOpen) e.preventDefault(); }}>
        <DropdownMenuItem className="min-h-11 gap-2 text-base" onSelect={onInfo}>
          <ClipboardCopy className="h-4 w-4" /> Contracting info
        </DropdownMenuItem>
        {actions.copy && (
          <DropdownMenuItem className="min-h-11 gap-2 text-base" onSelect={onCopy}>
            <Copy className="h-4 w-4" /> Copy link
          </DropdownMenuItem>
        )}
        {actions.share && row.recipient_email && (
          <DropdownMenuItem className="min-h-11 gap-2 text-base" onSelect={onEmail}>
            <Mail className="h-4 w-4" /> Email draft
          </DropdownMenuItem>
        )}
        {actions.regenerate && (
          <DropdownMenuItem className="min-h-11 gap-2 text-base" onSelect={onReplace}>
            <RefreshCw className="h-4 w-4" /> Replace link
          </DropdownMenuItem>
        )}
        {actions.revoke && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 gap-2 text-base text-destructive focus:text-destructive" onSelect={onRevoke}>
              <Ban className="h-4 w-4" /> Revoke link
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  const [infoRow, setInfoRow] = useState<InvitationRow | null>(null);
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
      title: "Revoke this link?",
      description: "The link stops working right away. You can make a new one with Replace link.",
      confirmText: "Revoke link",
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
      title: "Replace this link?",
      description: "The current link stops working and shows as Replaced. The new link carries the same terms.",
      confirmText: "Replace link",
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
      toast.success("New link created. Use Copy link on the new row.");
    }
    await refresh();
  });

  const counts = list.data?.counts;

  const menuFor = (row: InvitationRow) => (
    <RowMenu
      row={row}
      busy={busyId === row.id}
      infoOpen={infoRow?.id === row.id}
      onInfo={() => setInfoRow(row)}
      onCopy={() => void copy(row)}
      onEmail={() => void emailDraft(row)}
      onReplace={() => void regenerate(row)}
      onRevoke={() => void revoke(row)}
    />
  );

  const pillFor = (row: InvitationRow) => (
    <StatusPill status={{ label: INVITATION_STATUS_LABEL[row.status], tone: STATUS_TONE[row.status] }} className="shrink-0" />
  );

  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5" role="tablist" aria-label="Invitation view">
          <Button variant={history ? "ghost" : "secondary"} className="h-11 px-4 text-sm" role="tab" aria-selected={!history} onClick={() => setHistory(false)}>
            Active{counts ? ` · ${counts.pending}` : ""}
          </Button>
          <Button variant={history ? "secondary" : "ghost"} className="h-11 px-4 text-sm" role="tab" aria-selected={history} onClick={() => setHistory(true)}>
            History{counts ? ` · ${counts.total}` : ""}
          </Button>
        </div>
        {history && (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search invitations"
              className="h-11 pl-8 text-base"
              placeholder="Name, email or note"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      {history && counts && (
        <p className="text-sm text-muted-foreground" data-testid="invitation-counts">
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
        <>
          {/* Phones and tablets: one card per invitation. */}
          <ul className="space-y-3 lg:hidden" data-testid="invite-cards">
            {rows.map((row) => {
              const freeNote = decodeInviteNote(row.notes).note;
              const info = contractingInfoFor(row);
              const agency = row.agency_key ? agencyLabel(row.agency_key, BRAND.legalName) : null;
              const summary = [
                formatRole(row.target_role),
                row.upline_name ? `under ${row.upline_name}${agency ? ` (${agency})` : ""}` : "upline set on join",
                offerText(row),
              ].join(" · ");
              const exceptions = exceptionsText(row);
              return (
                <li key={row.id} className="rounded-xl border border-border bg-card p-4" data-testid={`invite-card-${row.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-foreground">{row.recipient_name || freeNote || "Open invitation"}</p>
                      <p className="break-words text-sm text-muted-foreground">{row.recipient_email ?? "Any email"}</p>
                      {info.npn && <p className="text-sm text-muted-foreground">NPN {info.npn}</p>}
                    </div>
                    {pillFor(row)}
                  </div>
                  <p className="mt-2 text-sm text-foreground">{summary}</p>
                  {exceptions && <p className="text-[13px] text-muted-foreground">{exceptions}</p>}
                  {row.recipient_name && freeNote && <p className="text-sm italic text-muted-foreground">{freeNote}</p>}
                  <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                    <div className="text-sm text-muted-foreground">
                      <p>{whenLine(row)}</p>
                      <p>{createdLine(row)}</p>
                      {sharedLine(row) && <p>{sharedLine(row)}</p>}
                    </div>
                    {menuFor(row)}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop: the same rows as a table. Text wraps; nothing is forced onto one line. */}
          <div className="hidden rounded-md border border-border lg:block" data-testid="invite-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Upline</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const freeNote = decodeInviteNote(row.notes).note;
                  const info = contractingInfoFor(row);
                  const exceptions = exceptionsText(row);
                  return (
                    <TableRow key={row.id} data-testid={`invite-row-${row.id}`}>
                      <TableCell className="min-w-[12rem]">
                        <p className="text-base font-medium text-foreground">{row.recipient_name || freeNote || "Open invitation"}</p>
                        {/* overflow-wrap:anywhere, not break-all: the address stays on one line wherever there is room, and at
                            the narrowest desktop width the column can still shrink instead of starving the Status column. */}
                        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{row.recipient_email ?? "Any email"}</p>
                        {info.npn && <p className="text-sm text-muted-foreground">NPN {info.npn}</p>}
                        {row.recipient_name && freeNote && <p className="text-[13px] italic text-muted-foreground">{freeNote}</p>}
                      </TableCell>
                      <TableCell className="text-sm">{formatRole(row.target_role)}</TableCell>
                      <TableCell className="text-sm">
                        <p>{row.upline_name ?? "Set on join"}</p>
                        <p className="text-[13px] text-muted-foreground">{row.agency_key ? agencyLabel(row.agency_key, BRAND.legalName) : "—"}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        <p>{offerText(row)}</p>
                        {exceptions && <p className="text-[13px] text-muted-foreground">{exceptions}</p>}
                      </TableCell>
                      <TableCell>
                        {pillFor(row)}
                        <p className="mt-1 text-[13px] text-muted-foreground">{whenLine(row)}</p>
                        <p className="text-[13px] text-muted-foreground">{createdLine(row)}</p>
                        {sharedLine(row) && <p className="text-[13px] text-muted-foreground">{sharedLine(row)}</p>}
                      </TableCell>
                      <TableCell className="text-right">{menuFor(row)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {list.data && list.data.rows.length >= list.data.limit && (
        <p className="text-sm text-muted-foreground">Showing the newest {list.data.limit}. Search history to find older invitations.</p>
      )}

      <Dialog open={infoRow !== null} onOpenChange={(open) => { if (!open) setInfoRow(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Contracting info</DialogTitle>
            <DialogDescription>
              {infoRow?.recipient_name ? `${infoRow.recipient_name} · copy each field into the carrier site.` : "Copy each field into the carrier site."}
            </DialogDescription>
          </DialogHeader>
          {infoRow && <ContractingCopyCard info={contractingInfoFor(infoRow)} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
