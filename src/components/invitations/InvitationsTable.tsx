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
 *
 * OVERHAUL-1 (2026-10-29): each page lists one kind (Invite an agent: hire invitations; Refer a
 * recruit: prospect join links, as cards, appearing with the first one). The server filters and
 * counts by kind, so a tab's number is its rows. A permanent link reads "Never expires", only
 * when the server's permanent flag says so.
 *
 * Colour layer (2026-10-28, docs/DESIGN_SYSTEM.md "Colour, motion and sound"): the status
 * pill wears the tone INVITATION_STATUS_TONE gives its word (pending warm, accepted good,
 * closed links quiet), the cards and rows rise in once, a copied link pops after the
 * clipboard took it, a revoked link whooshes away, and a replaced link chimes from the menu
 * item that was pressed. Nothing plays on load or on an error; every error toast is as before.
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
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { RevealList } from "@/components/ui/delight/Reveal";
import { formatDay } from "@/components/pipeline/worklist/worklistFormat";
import { useConfirm } from "@/hooks/useConfirm";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { celebrate, type CelebrationOrigin } from "@/lib/celebrate";
import {
  INVITATION_STATUS_LABEL,
  agencyLabel,
  formatRole,
  invitationActions,
  invitationMailto,
  invitationStatusTone,
  type InvitationStatus,
} from "@/lib/invitationState";
import { contractingInfoFor, decodeInviteNote } from "@/lib/inviteContractingInfo";
import { LICENSE_CHOICE_LABEL, type InviteLinkKind } from "@/lib/recruitLinks";
import { cn } from "@/lib/utils";
import { ContractingCopyCard } from "./ContractingCopyCard";
import { inviteUrlFromPath, shareInvitation, useInvitations, type InvitationRow } from "./invitationApi";

const BRAND = resolveBrand();

/**
 * Where the finger was, as a point, read the moment a menu item is picked: the menu closes
 * and the item unmounts before the write resolves, and a point read now still puts the
 * bubbles where it was. The control itself while it has no size (hidden, or under test).
 */
function pressOrigin(control: EventTarget | null): CelebrationOrigin {
  if (!(control instanceof Element) || typeof window === "undefined") return null;
  const r = control.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return control;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp((r.left + r.width / 2) / window.innerWidth), y: clamp((r.top + r.height / 2) / window.innerHeight) };
}

/** The server's status in the words people read; a status this client does not know is shown as it came, never hidden. */
function statusWord(status: string | null | undefined): string {
  if (!status) return "no longer pending";
  return ((INVITATION_STATUS_LABEL as Record<string, string | undefined>)[status] ?? status).toLowerCase();
}

/**
 * What happened and when: "Expires Nov 4, 2026", "Never expires", "Accepted Oct 30, 2026 · Pat Lee",
 * "Replaced Oct 29, 2026". A permanent link (OVERHAUL-1) says so; only the server's permanent flag
 * makes it so, never a missing date.
 */
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
      return row.permanent === true ? "Never expires" : `Expires ${formatDay(row.expires_at)}`;
  }
}

/** A prospect join link's line: "Prospect · Not licensed yet · credited to Ady Thomas". */
function prospectSummary(row: InvitationRow): string {
  return [
    "Prospect",
    row.license_status ? LICENSE_CHOICE_LABEL[row.license_status] : "license not picked",
    row.upline_name ? `credited to ${row.upline_name}` : null,
  ].filter(Boolean).join(" · ");
}

/** "Created Oct 28, 2026 by Sam James". */
function createdLine(row: InvitationRow): string {
  return `Created ${formatDay(row.created_at)}${row.created_by_name ? ` by ${row.created_by_name}` : ""}`;
}

/** "Shared 2 times", or nothing. Shares are copies, share sheets, text and mail drafts, never deliveries. */
function sharedLine(row: InvitationRow): string | null {
  if (row.share_count <= 0) return null;
  return `Shared ${row.share_count.toLocaleString("en-US")} ${row.share_count === 1 ? "time" : "times"}`;
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
  /** "Contracting info" on a hire invitation, "Their details" on a prospect join link. */
  infoLabel: string;
  busy: boolean;
  /** True while this row's contracting dialog is open, so closing the menu does not pull focus back out of it. */
  infoOpen: boolean;
  onInfo: () => void;
  onCopy: () => void;
  onEmail: () => void;
  /** Receives where the menu item was pressed, so the new link's chime rises from there. */
  onReplace: (origin: CelebrationOrigin) => void;
  onRevoke: () => void;
}

/** The one control per row. Every item is a word, 44px tall; Revoke and Replace confirm before they act. */
function RowMenu({ row, infoLabel, busy, infoOpen, onInfo, onCopy, onEmail, onReplace, onRevoke }: RowMenuProps) {
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
          <ClipboardCopy className="h-4 w-4" /> {infoLabel}
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
          <DropdownMenuItem className="min-h-11 gap-2 text-base" onSelect={(e) => onReplace(pressOrigin(e.currentTarget))}>
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
  kind,
  hideWhenEmpty = false,
  heading,
  cardsOnly = false,
}: {
  /** Only show invitations for these target roles (e.g. manager invites). */
  roleFilter?: string[];
  title?: string;
  /** One kind per page (OVERHAUL-1): the server filters and counts by it. Omitted lists both. */
  kind?: InviteLinkKind;
  /** Render nothing until this kind has at least one link, ever (counts are over the full scoped set). */
  hideWhenEmpty?: boolean;
  /** A visible heading that comes and goes with the list (with hideWhenEmpty, nothing is left behind). */
  heading?: string;
  /** Cards at every width, for a page whose column is too narrow for the six-column table (Refer a recruit). */
  cardsOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const askConfirm = useConfirm();
  const [history, setHistory] = useState(false);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [infoRow, setInfoRow] = useState<InvitationRow | null>(null);
  const list = useInvitations(history, history ? search : "", kind);
  const isJoin = kind === "join";
  const noun = isJoin ? "links" : "invitations";
  const infoLabel = isJoin ? "Their details" : "Contracting info";

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
    // The clipboard has it: the pop marks that, so a blocked clipboard stays silent.
    playSoundEffect("pop");
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
    // The link is gone: a quiet whoosh, only once the server said so.
    playSoundEffect("whoosh");
    await refresh();
  });

  const regenerate = (row: InvitationRow, origin: CelebrationOrigin) => run(row.id, async () => {
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
    // A new invitation exists (src/lib/celebrate.ts: "booked"), whether or not the clipboard takes it below.
    void celebrate("booked", origin);
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
      infoLabel={infoLabel}
      busy={busyId === row.id}
      infoOpen={infoRow?.id === row.id}
      onInfo={() => setInfoRow(row)}
      onCopy={() => void copy(row)}
      onEmail={() => void emailDraft(row)}
      onReplace={(origin) => void regenerate(row, origin)}
      onRevoke={() => void revoke(row)}
    />
  );

  /** The status word in its tone (INVITATION_STATUS_TONE). The word is the content; the dot and tint only help. */
  const pillFor = (row: InvitationRow) => (
    <TonePill tone={invitationStatusTone(row.status)} dot className="shrink-0">
      {INVITATION_STATUS_LABEL[row.status]}
    </TonePill>
  );

  /** A tab press is a view moved: one tick, and only when the view changes. */
  const showHistory = (next: boolean) => {
    if (next === history) return;
    setHistory(next);
    playSoundEffect("tick");
  };

  // Nothing of this kind exists yet: no empty section on the page (it appears with the first link).
  if (hideWhenEmpty && counts && counts.total === 0) return null;

  return (
    <section className="space-y-3" aria-label={title}>
      {heading && <h2 className="text-lg font-semibold text-foreground">{heading}</h2>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5" role="tablist" aria-label="Invitation view">
          <Button variant={history ? "ghost" : "secondary"} className="h-11 px-4 text-sm" role="tab" aria-selected={!history} onClick={() => showHistory(false)}>
            Active{counts ? ` · ${counts.pending}` : ""}
          </Button>
          <Button variant={history ? "secondary" : "ghost"} className="h-11 px-4 text-sm" role="tab" aria-selected={history} onClick={() => showHistory(true)}>
            History{counts ? ` · ${counts.total}` : ""}
          </Button>
        </div>
        {history && (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label={`Search ${noun}`}
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
          {isJoin ? "Your links" : "Invitations"} could not be loaded{list.error instanceof Error ? `: ${list.error.message}` : "."}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          {history ? `No ${noun} match.` : isJoin ? "No open links." : "No pending invitations."}
        </p>
      ) : (
        <>
          {/* Phones and tablets: one card per invitation, rising in once, 40ms apart. */}
          <RevealList as="ul" className={cn("space-y-3", !cardsOnly && "lg:hidden")} data-testid="invite-cards">
            {rows.map((row) => {
              const freeNote = decodeInviteNote(row.notes).note;
              const info = contractingInfoFor(row);
              const agency = row.agency_key ? agencyLabel(row.agency_key, BRAND.legalName) : null;
              const summary = row.kind === "join" ? prospectSummary(row) : [
                formatRole(row.target_role),
                row.upline_name ? `under ${row.upline_name}${agency ? ` (${agency})` : ""}` : "upline set on join",
                offerText(row),
              ].join(" · ");
              const exceptions = exceptionsText(row);
              return (
                <li key={row.id} className="rounded-xl border border-border bg-card p-4" data-testid={`invite-card-${row.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-foreground">{row.recipient_name || freeNote || (row.kind === "join" ? "Open link" : "Open invitation")}</p>
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
          </RevealList>

          {/* Desktop: the same rows as a table. Text wraps; nothing is forced onto one line. */}
          {!cardsOnly && <div className="hidden rounded-md border border-border lg:block" data-testid="invite-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  {isJoin ? (
                    <TableHead>Link</TableHead>
                  ) : (
                    <>
                      <TableHead>Role</TableHead>
                      <TableHead>Upline</TableHead>
                      <TableHead>Offer</TableHead>
                    </>
                  )}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="apex-rise-list">
                {rows.map((row) => {
                  const freeNote = decodeInviteNote(row.notes).note;
                  const info = contractingInfoFor(row);
                  const exceptions = exceptionsText(row);
                  return (
                    <TableRow key={row.id} data-testid={`invite-row-${row.id}`}>
                      <TableCell className="min-w-[12rem]">
                        <p className="text-base font-medium text-foreground">{row.recipient_name || freeNote || (row.kind === "join" ? "Open link" : "Open invitation")}</p>
                        {/* overflow-wrap:anywhere, not break-all: the address stays on one line wherever there is room, and at
                            the narrowest desktop width the column can still shrink instead of starving the Status column. */}
                        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{row.recipient_email ?? "Any email"}</p>
                        {info.npn && <p className="text-sm text-muted-foreground">NPN {info.npn}</p>}
                        {row.recipient_name && freeNote && <p className="text-[13px] italic text-muted-foreground">{freeNote}</p>}
                      </TableCell>
                      {isJoin ? (
                        <TableCell className="text-sm">{prospectSummary(row)}</TableCell>
                      ) : (
                        <>
                          <TableCell className="text-sm">{formatRole(row.target_role)}</TableCell>
                          <TableCell className="text-sm">
                            <p>{row.upline_name ?? "Set on join"}</p>
                            <p className="text-[13px] text-muted-foreground">{row.agency_key ? agencyLabel(row.agency_key, BRAND.legalName) : "—"}</p>
                          </TableCell>
                          <TableCell className="text-sm">
                            <p>{offerText(row)}</p>
                            {exceptions && <p className="text-[13px] text-muted-foreground">{exceptions}</p>}
                          </TableCell>
                        </>
                      )}
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
          </div>}
        </>
      )}
      {list.data && list.data.rows.length >= list.data.limit && (
        <p className="text-sm text-muted-foreground">Showing the newest {list.data.limit}. Search history to find older invitations.</p>
      )}

      <Dialog open={infoRow !== null} onOpenChange={(open) => { if (!open) setInfoRow(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{infoLabel}</DialogTitle>
            <DialogDescription>
              {isJoin
                ? (infoRow?.recipient_name ? `${infoRow.recipient_name} · copy any value you need.` : "Copy any value you need.")
                : (infoRow?.recipient_name ? `${infoRow.recipient_name} · copy each field into the carrier site.` : "Copy each field into the carrier site.")}
            </DialogDescription>
            {/* The same status word and tone as the row it came from. */}
            {infoRow && <div className="flex pt-1">{pillFor(infoRow)}</div>}
          </DialogHeader>
          {infoRow && <ContractingCopyCard info={contractingInfoFor(infoRow)} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
