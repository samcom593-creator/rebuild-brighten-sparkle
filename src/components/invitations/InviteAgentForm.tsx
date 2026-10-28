/**
 * Invite Agent — the one form for minting a personal invitation.
 *
 * Mounted by /admin/invite-links, the Command Center "Invite Team" dialog and
 * the Manager Invites card. Every choice here is re-validated on the server by
 * create_invitation → fn_invite_authorize (who may invite whom, into which
 * role, under which upline, at which comp). The options come from
 * invitation_mint_options(), which already scopes uplines to the caller's
 * downline and comp levels to approved values at or below the caller's own
 * level, so the form cannot even offer what the server would refuse.
 *
 * Agency is not a free choice: it is derived from the upline (the same
 * hierarchy fn_agent_subagency reads), so picking an agency narrows the upline
 * list and the server stamps the agency from the upline it validated.
 *
 * Grow redesign (2026-10-28): four plain steps (who, role and license, upline,
 * offer) at 16px, and the five contracting fields Sam asked for — first name,
 * last name, email, phone, NPN — with a copy-ready card on the created invite.
 * First and last go to the server as recipient_name; the four non-email fields
 * also ride in the internal note (src/lib/inviteContractingInfo.ts).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Link2, Loader2, Mail, Plus, Trash2 } from "lucide-react";
import { ContractingCopyCard } from "./ContractingCopyCard";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { inviteUrlFromPath, shareInvitation, useInviteMintOptions } from "./invitationApi";
import { resolveBrand } from "@/config/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailTypoHint } from "@/components/ui/email-typo-hint";
import { isPlausibleEmail, normalizeEmailInput } from "@/lib/emailValidation";
import { npnProblem } from "@/lib/contractReview";
import { encodeInviteNote, freeNoteRoom, type ContractingInfo } from "@/lib/inviteContractingInfo";
import {
  agencyLabel,
  formatRole,
  invitationMailto,
  validateOfferTerms,
  type CarrierExceptionDraft,
  type OfferAuthority,
} from "@/lib/invitationState";

const BRAND = resolveBrand();

export interface CreatedInvitation {
  id: string;
  kind: "hire" | "join";
  path: string;
  expires_at: string;
  recipient_email: string | null;
  recipient_name: string | null;
  /** What the inviter typed, for the copy-ready contracting card. */
  contracting?: ContractingInfo;
}

const EXPIRY_OPTIONS: Array<{ hours: number; label: string }> = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 336, label: "14 days" },
  { hours: 720, label: "30 days" },
];

type InviteAs = "agent" | "hired_manager" | "agency_owner" | "staff";
const INVITE_AS_LABEL: Record<InviteAs, string> = {
  agent: "Agent",
  hired_manager: "Manager",
  agency_owner: "Agency owner",
  staff: "Staff",
};

type LicensePath = "recruit_chooses" | "licensed" | "unlicensed";

const SELECT_CLASS =
  "h-12 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50";
const INPUT_CLASS = "h-12 border-border bg-card text-base";

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4" aria-label={title}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{n}</span>
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <div className="sm:pl-10">{children}</div>
    </section>
  );
}

export function InviteAgentForm({
  defaultInviteAs = "agent",
  onCreated,
}: {
  defaultInviteAs?: InviteAs;
  onCreated?: (created: CreatedInvitation) => void;
}) {
  const queryClient = useQueryClient();
  const options = useInviteMintOptions();
  const opts = options.data;

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [npn, setNpn] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [inviteAs, setInviteAs] = useState<InviteAs>(defaultInviteAs);
  const [licensePath, setLicensePath] = useState<LicensePath>("recruit_chooses");
  const [agencyKey, setAgencyKey] = useState<string>("");
  const [uplineId, setUplineId] = useState<string>("");
  const [compChoice, setCompChoice] = useState<string>("none");
  const [customComp, setCustomComp] = useState("");
  const [exceptions, setExceptions] = useState<Array<CarrierExceptionDraft & { rowKey: string }>>([]);
  const [expiresHours, setExpiresHours] = useState(168);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);

  const agencies = useMemo(() => {
    const keys = new Set((opts?.uplines ?? []).map((u) => u.agency_key));
    return Array.from(keys).sort();
  }, [opts]);

  const visibleUplines = useMemo(
    () => (opts?.uplines ?? []).filter((u) => !agencyKey || u.agency_key === agencyKey),
    [opts, agencyKey],
  );

  // Default the upline to the caller, then keep it inside the agency filter.
  useEffect(() => {
    if (!opts) return;
    if (uplineId && visibleUplines.some((u) => u.id === uplineId)) return;
    const self = visibleUplines.find((u) => u.is_self);
    setUplineId(self?.id ?? visibleUplines[0]?.id ?? "");
  }, [opts, visibleUplines, uplineId]);

  const roleOptions = useMemo<InviteAs[]>(() => {
    const roles = new Set(opts?.roles ?? []);
    const out: InviteAs[] = ["agent"];
    if (roles.has("hired_manager")) out.push("hired_manager");
    if (roles.has("agency_owner")) out.push("agency_owner");
    if (roles.has("staff")) out.push("staff");
    return out;
  }, [opts]);

  useEffect(() => {
    if (opts && !roleOptions.includes(inviteAs)) setInviteAs("agent");
  }, [opts, roleOptions, inviteAs]);

  const targetRole = inviteAs === "agent"
    ? (licensePath === "licensed" ? "hired_licensed" : "hired_unlicensed")
    : inviteAs;

  const offeredComp: number | null = compChoice === "none"
    ? null
    : compChoice === "custom"
      ? (customComp.trim() === "" ? Number.NaN : Number(customComp))
      : Number(compChoice);

  const authority: OfferAuthority | null = opts
    ? {
        is_admin: opts.is_admin,
        is_manager: opts.is_manager,
        cap_pct: opts.cap_pct,
        comp_levels: opts.comp_levels,
        upline_ids: opts.uplines.map((u) => u.id),
        carrier_ids: opts.carriers.map((c) => c.id),
      }
    : null;

  const issues = authority
    ? validateOfferTerms(
        {
          kind: "hire",
          target_role: targetRole,
          target_manager_id: uplineId || null,
          recipient_email: recipientEmail,
          offered_comp_pct: offeredComp,
          carrier_exceptions: exceptions.map(({ carrier_id, pct, note: n }) => ({ carrier_id, pct, note: n })),
        },
        authority,
      )
    : [];
  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message ?? null;

  // Name and email are optional (Sam, 2026-10-14): a link can go out bare and the person fills in their own
  // details on landing. An email, when given, must be plausible, because it locks the invitation to that address.
  const emailGiven = recipientEmail.trim() !== "";
  const emailOk = !emailGiven || isPlausibleEmail(recipientEmail);
  const npnIssue = npnProblem(npn);
  const recipientName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const contractingFields = { firstName, lastName, phone: recipientPhone, npn };
  const noteRoom = freeNoteRoom(contractingFields);
  // Typing a name, phone or NPN after the note shrinks the room the server leaves for it. The
  // note is never cut behind the person's back: it is flagged and the invitation waits until it fits.
  const noteOver = Math.max(0, note.trim().length - noteRoom);
  const canSubmit = !!opts && emailOk && !npnIssue && noteOver === 0 && issues.length === 0 && !submitting;

  const chosenUpline = opts?.uplines.find((u) => u.id === uplineId) ?? null;

  function reset() {
    setFirstName("");
    setLastName("");
    setNpn("");
    setRecipientEmail("");
    setRecipientPhone("");
    setCompChoice("none");
    setCustomComp("");
    setExceptions([]);
    setNote("");
    setTriedSubmit(false);
  }

  async function submit() {
    setTriedSubmit(true);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("create_invitation" as never, {
        p_kind: "hire",
        p_target_role: targetRole,
        p_target_manager_id: uplineId,
        p_recipient_email: emailGiven ? normalizeEmailInput(recipientEmail) : null,
        p_recipient_name: recipientName || null,
        p_recipient_phone: recipientPhone.trim() || null,
        p_license_status: licensePath === "recruit_chooses" ? null : licensePath,
        p_offered_comp_pct: offeredComp,
        p_carrier_exceptions: exceptions.map((ex) => ({ carrier_id: ex.carrier_id, pct: ex.pct, note: ex.note ?? null })),
        p_expires_hours: expiresHours,
        p_notes: encodeInviteNote(contractingFields, note),
      } as never);
      if (error) {
        toast.error(error.message || "The invitation was not created.");
        return;
      }
      const row = data as unknown as { id?: string; kind?: "hire" | "join"; path?: string; expires_at?: string } | null;
      if (!row?.id || !row.path) {
        toast.error("The invitation was not returned. Nothing was shared.");
        return;
      }
      const result: CreatedInvitation = {
        id: row.id,
        kind: row.kind ?? "hire",
        path: row.path,
        expires_at: row.expires_at ?? "",
        recipient_email: emailGiven ? normalizeEmailInput(recipientEmail) : null,
        recipient_name: recipientName || null,
        contracting: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: emailGiven ? normalizeEmailInput(recipientEmail) : "",
          phone: recipientPhone.replace(/\D/g, ""),
          npn: npn.replace(/\D/g, ""),
        },
      };
      setCreated(result);
      setCopied(false);
      toast.success(result.recipient_name ? `Invitation created for ${result.recipient_name}.` : "Open invitation created. Anyone with the link can fill in their own details.");
      reset();
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
      onCreated?.(result);
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCreated() {
    if (!created) return;
    const url = inviteUrlFromPath(created.path);
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.warn("clipboard blocked", err);
      toast.error("Clipboard blocked. Select the link and copy it manually.");
      return;
    }
    setCopied(true);
    toast.success("Link copied.");
    try {
      await shareInvitation(created.id, "copy");
    } catch (err) {
      console.warn("record_invitation_share failed", err);
    }
  }

  async function emailCreated() {
    if (!created?.recipient_email) return;
    window.location.href = invitationMailto({
      recipientEmail: created.recipient_email,
      recipientName: created.recipient_name,
      url: inviteUrlFromPath(created.path),
      expiresAt: created.expires_at,
      orgName: BRAND.legalName,
    });
    try {
      await shareInvitation(created.id, "email_draft");
    } catch (err) {
      console.warn("record_invitation_share failed", err);
    }
  }

  if (options.isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your invite options…
      </div>
    );
  }
  if (options.error || !opts) {
    return (
      <p className="p-4 text-sm text-destructive">
        Invite options could not be loaded{options.error instanceof Error ? `: ${options.error.message}` : "."}
      </p>
    );
  }

  return (
    <div className="space-y-8" data-testid="invite-agent-form">
      <Step n={1} title="Who are you inviting?" hint="All optional. Leave it blank for an open link they fill in themselves.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="invite-first-name" className="text-sm">First name</Label>
            <Input id="invite-first-name" className={INPUT_CLASS} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-last-name" className="text-sm">Last name</Label>
            <Input id="invite-last-name" className={INPUT_CLASS} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-recipient-email" className="text-sm">Email</Label>
            <Input
              id="invite-recipient-email"
              type="email"
              className={INPUT_CLASS}
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="name@example.com"
              autoComplete="off"
            />
            <EmailTypoHint value={recipientEmail} onAccept={setRecipientEmail} />
            {emailGiven && !emailOk && (
              <p className="text-sm text-destructive">Enter a valid email address, or leave it blank.</p>
            )}
            <p className="text-[13px] text-muted-foreground">{emailGiven ? "Only this address can accept the invitation." : "Blank means anyone with the link can accept."}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-recipient-phone" className="text-sm">Phone</Label>
            <Input id="invite-recipient-phone" type="tel" className={INPUT_CLASS} value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="(555) 123-4567" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-npn" className="text-sm">NPN <span className="font-normal text-muted-foreground">(licensed agents)</span></Label>
            <Input id="invite-npn" inputMode="numeric" className={INPUT_CLASS} value={npn} onChange={(e) => setNpn(e.target.value)} placeholder="5 to 10 digits" autoComplete="off" />
            {npnIssue && <p className="text-sm text-destructive">{npnIssue}</p>}
          </div>
        </div>
      </Step>

      <Step n={2} title="Their role and license">
        <div className="space-y-4">
          <div className="space-y-1.5 sm:max-w-xs">
            <Label htmlFor="invite-as" className="text-sm">Invite as</Label>
            <select id="invite-as" className={SELECT_CLASS} value={inviteAs} onChange={(e) => setInviteAs(e.target.value as InviteAs)}>
              {roleOptions.map((r) => <option key={r} value={r}>{INVITE_AS_LABEL[r]}</option>)}
            </select>
            {issueFor("target_role") && <p className="text-sm text-destructive">{issueFor("target_role")}</p>}
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">License</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="License path">
              {([
                ["recruit_chooses", "They choose"],
                ["licensed", "Licensed"],
                ["unlicensed", "Not licensed yet"],
              ] as Array<[LicensePath, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={licensePath === value}
                  onClick={() => setLicensePath(value)}
                  className={`h-12 rounded-lg border px-3 text-base font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] ${licensePath === value ? "border-primary/60 bg-primary/15 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[13px] text-muted-foreground">Licensed starts contracting when they accept. Not licensed starts the licensing roadmap.</p>
          </div>
        </div>
      </Step>

      <Step n={3} title="Who they'll work under">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-agency" className="text-sm">Agency</Label>
            <select id="invite-agency" className={SELECT_CLASS} value={agencyKey} onChange={(e) => setAgencyKey(e.target.value)} disabled={agencies.length < 2}>
              {agencies.length > 1 && <option value="">All agencies</option>}
              {agencies.map((key) => <option key={key} value={key}>{agencyLabel(key, BRAND.legalName)}</option>)}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="invite-upline" className="text-sm">Upline</Label>
            <select id="invite-upline" className={SELECT_CLASS} value={uplineId} onChange={(e) => setUplineId(e.target.value)}>
              {visibleUplines.length === 0 && <option value="">No eligible upline</option>}
              {visibleUplines.map((u) => (
                <option key={u.id} value={u.id}>{u.is_self ? `${u.name} (me)` : u.name}</option>
              ))}
            </select>
            {issueFor("target_manager_id") && <p className="text-sm text-destructive">{issueFor("target_manager_id")}</p>}
          </div>
        </div>
      </Step>

      <Step n={4} title="The offer">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-comp" className="text-sm">Offered comp</Label>
              {opts.can_offer_comp ? (
                <select id="invite-comp" className={SELECT_CLASS} value={compChoice} onChange={(e) => setCompChoice(e.target.value)}>
                  <option value="none">No offer (set later)</option>
                  {opts.comp_levels.map((level) => <option key={level} value={String(level)}>{level}%</option>)}
                  {opts.is_admin && <option value="custom">Custom level (admin)…</option>}
                </select>
              ) : (
                <p className="flex h-12 items-center rounded-lg border border-border bg-muted px-3 text-base text-muted-foreground">Set by a manager or admin</p>
              )}
              {compChoice === "custom" && (
                <Input
                  id="invite-comp-custom"
                  aria-label="Custom offered comp percent"
                  inputMode="decimal"
                  className={INPUT_CLASS}
                  value={customComp}
                  onChange={(e) => setCustomComp(e.target.value)}
                  placeholder="50–200"
                />
              )}
              {issueFor("offered_comp_pct") && <p className="text-sm text-destructive">{issueFor("offered_comp_pct")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-expiry" className="text-sm">Link works for</Label>
              <select id="invite-expiry" className={SELECT_CLASS} value={expiresHours} onChange={(e) => setExpiresHours(Number(e.target.value))}>
                {EXPIRY_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-note" className="text-sm">Team note <span className="font-normal text-muted-foreground">(only your team sees it)</span></Label>
              <Input
                id="invite-note"
                className={INPUT_CLASS}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={noteRoom}
                aria-invalid={noteOver > 0 || undefined}
                aria-describedby={noteOver > 0 ? "invite-note-over" : undefined}
              />
              {noteOver > 0 ? (
                <p id="invite-note-over" role="alert" className="text-sm text-destructive">
                  The note is {noteOver} character{noteOver === 1 ? "" : "s"} too long now that the contracting details take part of its space. Shorten it to create the invitation.
                </p>
              ) : note.length > noteRoom - 20 ? (
                <p className="text-[13px] text-muted-foreground">{noteRoom - note.length} characters left</p>
              ) : null}
            </div>
          </div>

          {opts.can_offer_comp && (
            <div className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-medium">Carrier exceptions</p>
                  <p className="text-sm text-muted-foreground">Only when a carrier is offered at a different level than the base offer.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => setExceptions((rows) => [...rows, { rowKey: crypto.randomUUID(), carrier_id: "", pct: null, note: null }])}
                  disabled={exceptions.length >= 10}
                >
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>
              {exceptions.map((ex) => (
                <div key={ex.rowKey} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
                  <select
                    aria-label="Carrier"
                    className={SELECT_CLASS}
                    value={ex.carrier_id}
                    onChange={(e) => setExceptions((rows) => rows.map((r) => r.rowKey === ex.rowKey ? { ...r, carrier_id: e.target.value } : r))}
                  >
                    <option value="">Choose carrier</option>
                    {opts.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select
                    aria-label="Carrier exception percent"
                    className={SELECT_CLASS}
                    value={ex.pct == null ? "" : String(ex.pct)}
                    onChange={(e) => setExceptions((rows) => rows.map((r) => r.rowKey === ex.rowKey ? { ...r, pct: e.target.value === "" ? null : Number(e.target.value) } : r))}
                  >
                    <option value="">%</option>
                    {opts.comp_levels.map((level) => <option key={level} value={String(level)}>{level}%</option>)}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 w-11 px-0"
                    aria-label="Remove carrier exception"
                    onClick={() => setExceptions((rows) => rows.filter((r) => r.rowKey !== ex.rowKey))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {issueFor("carrier_exceptions") && <p className="text-sm text-destructive">{issueFor("carrier_exceptions")}</p>}
            </div>
          )}
        </div>
      </Step>

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground" data-testid="invite-summary">
          {recipientName ? `${recipientName} · ` : ""}
          {formatRole(targetRole)} under {chosenUpline?.name ?? "—"}
          {chosenUpline ? ` · ${agencyLabel(chosenUpline.agency_key, BRAND.legalName)}` : ""}
          {offeredComp != null && Number.isFinite(offeredComp) ? ` · offered ${offeredComp}%` : " · no comp offer"}
          {exceptions.length ? ` · ${exceptions.length} carrier exception${exceptions.length === 1 ? "" : "s"}` : ""}
        </p>
        <Button onClick={submit} className="h-12 px-6 text-base" disabled={submitting || (triedSubmit && !canSubmit)} data-testid="create-invitation">
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Link2 className="h-5 w-5" />}
          Create invitation
        </Button>
      </div>

      {created && (
        <div className="space-y-4 rounded-xl border border-primary/40 bg-primary/5 p-5" data-testid="invitation-created">
          <div>
            <p className="text-base font-semibold">Invitation ready{created.recipient_name ? ` for ${created.recipient_name}` : ""}</p>
            <p className="mt-1 break-all font-mono text-sm text-muted-foreground">{inviteUrlFromPath(created.path)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="h-11" onClick={copyCreated}>
              {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy link</>}
            </Button>
            {created.recipient_email && (
              <Button variant="outline" className="h-11" onClick={emailCreated}>
                <Mail className="h-4 w-4" /> Email draft
              </Button>
            )}
            <Button asChild variant="outline" className="h-11">
              <a href={inviteUrlFromPath(created.path)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" /> Preview
              </a>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Nothing has been sent. Copy the link or open a draft in your own mail app.
            {created.recipient_email ? ` It works once, only for ${created.recipient_email}.` : " Anyone with the link can accept it once."}
          </p>
          {created.contracting && (created.contracting.firstName || created.contracting.lastName || created.contracting.npn || created.contracting.phone) && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">For contracting — copy each field into the carrier site</p>
              <ContractingCopyCard info={created.contracting} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
