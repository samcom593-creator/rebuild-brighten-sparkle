/**
 * Make a link — the one form for minting a personal invitation.
 *
 * Mounted by /admin/invite-links (hire links), /dashboard/referrals/new (prospect join links,
 * kind="join"), the Command Center "Invite Team" dialog and the Manager Invites card. Every
 * choice is re-validated on the server by create_invitation -> fn_invite_authorize (who may
 * invite whom, into which role, under which upline, at which comp). The options come from
 * invitation_mint_options(), which already scopes uplines to the caller's downline and comp
 * levels to approved values at or below the caller's own level, so the form cannot even offer
 * what the server would refuse.
 *
 * OVERHAUL-1 (2026-10-29), Sam: "Give them an option: either put their first name, last name,
 * email, NPN, phone number... Or an option, just click attach a link, and they just tap it. And
 * it should be at the box of just licensed, not licensed yet, either or. And there should be an
 * option to make permanent link or make a temporary link." So the steps are:
 *   1. Who: Quick link (no details) or With details (first, last, email, phone, NPN, all
 *      optional). A Quick link sends no details, even ones typed before switching.
 *   2. License: Licensed or Not licensed yet. Required, no default; "They choose" is gone.
 *   3. Link type: Permanent (never expires, still one person) or Temporary (1 to 30 days, with
 *      the moment it stops working shown before and after it is made).
 *   4. Hire links only: their team and offer (role for admins, agency, upline, comp, carrier
 *      exceptions, team note), folded into one line that says the current values.
 * Once a link exists: Copy, Share, Text, Email in one row (LinkShareRow).
 *
 * Agency is not a free choice: it is derived from the upline (the same hierarchy
 * fn_agent_subagency reads), so picking an agency narrows the upline list and the server stamps
 * the agency from the upline it validated. A join link always sits under the person making it.
 *
 * First and last go to the server as recipient_name; the four non-email fields also ride in the
 * internal note (src/lib/inviteContractingInfo.ts) for the copy-ready contracting card.
 *
 * One gold button per screen (council finding 27): Make link is gold until a link exists, then
 * that link's Copy is gold and Make link steps back to outline; as soon as the form changes (the
 * next person is being typed) gold returns to Make link. The made link stays until the next
 * one, so a stray keystroke never loses it. A page that holds its gold elsewhere passes quiet.
 *
 * Colour layer (docs/DESIGN_SYSTEM.md "Colour, motion and sound"): the step numbers sit in 44px
 * bubbles, royal for paperwork ahead, gold for the step in hand and green with a check for a
 * step left in good order. A made link chimes from the Make link button and its card pops in;
 * a copied link pops once the clipboard has it. Nothing plays on load or on an error.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ExternalLink, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { ContractingCopyCard } from "./ContractingCopyCard";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { inviteUrlFromPath, shareInvitation, useInviteMintOptions } from "./invitationApi";
import { ChoiceGroup } from "./ChoiceGroup";
import { LinkShareRow } from "./LinkShareRow";
import { WrappableUrl } from "./WrappableUrl";
import { resolveBrand } from "@/config/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailTypoHint } from "@/components/ui/email-typo-hint";
import { ToneBubble, TonePill } from "@/components/ui/delight/ToneBubble";
import { celebrate, prefersReducedMotion } from "@/lib/celebrate";
import { licensePathTone, linkLifetimeTone, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { isPlausibleEmail, normalizeEmailInput } from "@/lib/emailValidation";
import { npnProblem } from "@/lib/contractReview";
import { encodeInviteNote, freeNoteRoom, type ContractingInfo } from "@/lib/inviteContractingInfo";
import {
  agencyLabel,
  formatRole,
  validateOfferTerms,
  type CarrierExceptionDraft,
  type OfferAuthority,
} from "@/lib/invitationState";
import {
  DEFAULT_TEMPORARY_HOURS,
  LICENSE_CHOICE_LABEL,
  LINK_LIFETIME_LABEL,
  LINK_MODE_LABEL,
  TEMPORARY_SPANS,
  detailsToSend,
  expiryFrom,
  formatExpiry,
  hireTargetRole,
  lifetimeLine,
  type InviteLinkKind,
  type LicenseChoice,
  type LinkLifetime,
  type LinkMode,
} from "@/lib/recruitLinks";

const BRAND = resolveBrand();

export interface CreatedInvitation {
  id: string;
  kind: InviteLinkKind;
  path: string;
  /** Null for a permanent link. */
  expires_at: string | null;
  permanent: boolean;
  license: LicenseChoice | null;
  recipient_email: string | null;
  recipient_name: string | null;
  /** What the inviter typed, for the copy-ready contracting card. */
  contracting?: ContractingInfo;
}

type InviteAs = "agent" | "hired_manager" | "agency_owner" | "staff";
const INVITE_AS_LABEL: Record<InviteAs, string> = {
  agent: "Agent",
  hired_manager: "Manager",
  agency_owner: "Agency owner",
  staff: "Staff",
};

type ExceptionRow = CarrierExceptionDraft & { rowKey: string };

/** The fields Make link clears once a link exists; mode, license, link type, role and upline carry over. */
const CLEARED = {
  firstName: "",
  lastName: "",
  npn: "",
  recipientEmail: "",
  recipientPhone: "",
  compChoice: "none",
  customComp: "",
  exceptions: [] as ExceptionRow[],
  note: "",
};

type FormValues = typeof CLEARED & {
  mode: LinkMode;
  license: LicenseChoice | null;
  lifetime: LinkLifetime;
  expiresHours: number;
  inviteAs: InviteAs;
  agencyKey: string;
  uplineId: string;
};

/** One string for everything the person can change, so "the form changed since this link was made" is one comparison. */
function fingerprint(v: FormValues): string {
  return JSON.stringify([
    v.mode, v.firstName, v.lastName, v.npn, v.recipientEmail, v.recipientPhone,
    v.license, v.lifetime, v.expiresHours,
    v.inviteAs, v.agencyKey, v.uplineId,
    v.compChoice, v.customComp, v.exceptions.map((e) => [e.carrier_id, e.pct, e.note ?? null]),
    v.note,
  ]);
}

const SELECT_CLASS =
  "h-12 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50";
const INPUT_CLASS = "h-12 border-border bg-card text-base";

type StepState = "todo" | "current" | "done";

/** Paperwork ahead is royal, the step in hand gold, a step left behind in good order green (src/lib/tones.ts). */
const STEP_TONE: Record<StepState, Tone> = { todo: "royal", current: "gold", done: "good" };

function Step({ n, title, hint, state, onEnter, children }: {
  n: number;
  title: string;
  hint?: string;
  state: StepState;
  /** Called when a control inside the step takes focus or a finger lands on it: this is now the step in hand. */
  onEnter: () => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4" aria-label={title} onFocus={onEnter} onPointerDown={onEnter}>
      <div className="flex items-start gap-3">
        {/* The number, or the check once the step is done, is decoration: the title beside it is the
            step's name and its accessible text (ToneBubble is aria-hidden). */}
        <ToneBubble tone={STEP_TONE[state]} size="md" className={cn("h-11 w-11 text-base font-bold", state === "done" && "apex-pop")}>
          {state === "done" ? <Check /> : n}
        </ToneBubble>
        <div className="min-w-0 pt-2.5">
          <h3 className="text-lg font-semibold leading-6 text-foreground">{title}</h3>
          {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <div className="sm:pl-14">{children}</div>
    </section>
  );
}

// The mode is paperwork (how much you fill in), so it wears the form's royal tone and never
// competes with the gold Make link button.
const MODE_OPTIONS = [
  { value: "quick" as const, label: LINK_MODE_LABEL.quick, tone: "royal" as const },
  { value: "details" as const, label: LINK_MODE_LABEL.details, tone: "royal" as const },
];
const LICENSE_OPTIONS = [
  { value: "licensed" as const, label: LICENSE_CHOICE_LABEL.licensed, tone: licensePathTone("licensed") },
  { value: "unlicensed" as const, label: LICENSE_CHOICE_LABEL.unlicensed, tone: licensePathTone("unlicensed") },
];
const LIFETIME_OPTIONS = [
  { value: "permanent" as const, label: LINK_LIFETIME_LABEL.permanent, tone: linkLifetimeTone("permanent") },
  { value: "temporary" as const, label: LINK_LIFETIME_LABEL.temporary, tone: linkLifetimeTone("temporary") },
];

/** What each License choice starts, in the words of each kind of link. */
const LICENSE_RESULT: Record<InviteLinkKind, Record<LicenseChoice, string>> = {
  hire: {
    licensed: "Licensed starts contracting when they accept.",
    unlicensed: "Not licensed yet starts the licensing roadmap when they accept.",
  },
  join: {
    licensed: "Licensed alerts their manager the moment they apply.",
    unlicensed: "Not licensed yet starts them on the licensing steps after they apply.",
  },
};

export function InviteAgentForm({
  defaultInviteAs = "agent",
  licenseHint,
  onCreated,
  kind = "hire",
  framed = false,
  quiet = false,
}: {
  defaultInviteAs?: InviteAs;
  /** One line under the License step's title, e.g. the page's rule that license status is always required. */
  licenseHint?: string;
  onCreated?: (created: CreatedInvitation) => void;
  /** hire: /hire/<token>, the recruit joins as an agent. join: /join/<token>, a prospect applies, credited to you. */
  kind?: InviteLinkKind;
  /** On a page: the form sits in its own card and the made link in a card of its own beside it (never nested). */
  framed?: boolean;
  /** Another part of the page holds the one gold button right now; nothing here is gold. */
  quiet?: boolean;
}) {
  const queryClient = useQueryClient();
  const options = useInviteMintOptions();
  const opts = options.data;
  const isJoin = kind === "join";

  const [mode, setMode] = useState<LinkMode>("quick");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [npn, setNpn] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [license, setLicense] = useState<LicenseChoice | null>(null);
  const [lifetime, setLifetime] = useState<LinkLifetime>("temporary");
  const [expiresHours, setExpiresHours] = useState(DEFAULT_TEMPORARY_HOURS);
  const [inviteAs, setInviteAs] = useState<InviteAs>(defaultInviteAs);
  const [agencyKey, setAgencyKey] = useState<string>("");
  const [uplineId, setUplineId] = useState<string>("");
  const [compChoice, setCompChoice] = useState<string>("none");
  const [customComp, setCustomComp] = useState("");
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [note, setNote] = useState("");
  const [teamOpen, setTeamOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [createdFingerprint, setCreatedFingerprint] = useState<string | null>(null);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  // The step in hand (gold) and the steps the person has been in. A step they left turns green
  // once it is valid; one they never touched stays royal. Both start over with each link.
  const [currentStep, setCurrentStep] = useState(1);
  const [visitedSteps, setVisitedSteps] = useState<number[]>([1]);
  const enterStep = (n: number) => {
    setCurrentStep(n);
    setVisitedSteps((seen) => (seen.includes(n) ? seen : [...seen, n]));
  };

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

  // Staff accounts do not carry a license path; everyone else must be one or the other.
  const licenseApplies = isJoin || inviteAs !== "staff";
  const targetRole = isJoin ? "referral_prospect" : hireTargetRole(inviteAs, license);

  const offeredComp: number | null = isJoin || compChoice === "none"
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

  const sent = detailsToSend(mode, { firstName, lastName, email: recipientEmail, phone: recipientPhone, npn });

  const issues = authority && !isJoin
    ? validateOfferTerms(
        {
          kind: "hire",
          target_role: targetRole,
          target_manager_id: uplineId || null,
          recipient_email: sent.email,
          offered_comp_pct: offeredComp,
          carrier_exceptions: exceptions.map(({ carrier_id, pct, note: n }) => ({ carrier_id, pct, note: n })),
        },
        authority,
      )
    : [];
  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message ?? null;

  // Every detail is optional (Sam, 2026-10-14): a link can go out bare and the person fills in their
  // own details on landing. An email, when given, must be plausible, because it locks the link to that address.
  const emailGiven = sent.email !== "";
  const emailOk = !emailGiven || isPlausibleEmail(sent.email);
  const npnIssue = npnProblem(sent.npn);
  const recipientName = `${sent.firstName} ${sent.lastName}`.trim();
  const contractingFields = { firstName: sent.firstName, lastName: sent.lastName, phone: sent.phone, npn: sent.npn };
  const noteRoom = freeNoteRoom(contractingFields);
  // Typing a name, phone or NPN after the note shrinks the room the server leaves for it. The
  // note is never cut behind the person's back: it is flagged and the link waits until it fits.
  const freeNote = isJoin ? "" : note;
  const noteOver = Math.max(0, freeNote.trim().length - noteRoom);
  const licenseMissing = licenseApplies && license === null;
  const canSubmit = !!opts && emailOk && !npnIssue && !licenseMissing && noteOver === 0 && issues.length === 0 && !submitting;

  const chosenUpline = opts?.uplines.find((u) => u.id === uplineId) ?? null;
  const teamStep = isJoin ? null : 4;

  // Step 1 is all optional, so blank is in good order (an open link); License is in good order once
  // picked; the others when the same pre-flight checks that gate Make link find nothing wrong.
  const stepValid: Record<number, boolean> = {
    1: emailOk && !npnIssue,
    2: !licenseMissing,
    3: true,
    4: !issueFor("target_role") && !issueFor("target_manager_id") && !issueFor("offered_comp_pct") && !issueFor("carrier_exceptions") && noteOver === 0,
  };
  const stepState = (n: number): StepState =>
    n === currentStep ? "current" : visitedSteps.includes(n) && stepValid[n] ? "done" : "todo";

  // A problem inside the folded team step opens it, so the message is never hidden.
  const teamHasProblem = !isJoin && !stepValid[4];
  useEffect(() => {
    if (teamHasProblem && (triedSubmit || noteOver > 0)) setTeamOpen(true);
  }, [teamHasProblem, triedSubmit, noteOver]);

  const values: FormValues = {
    mode, firstName, lastName, npn, recipientEmail, recipientPhone, license, lifetime, expiresHours,
    inviteAs, agencyKey, uplineId, compChoice, customComp, exceptions, note,
  };
  // The made link is "current" until the person changes anything; then the next link is the job,
  // Make link is gold again and the link's Copy steps back.
  const createdIsCurrent = created !== null && createdFingerprint === fingerprint(values);
  const goldOnMake = !quiet && !createdIsCurrent;
  const goldOnCopy = !quiet && createdIsCurrent;

  function reset() {
    setFirstName(CLEARED.firstName);
    setLastName(CLEARED.lastName);
    setNpn(CLEARED.npn);
    setRecipientEmail(CLEARED.recipientEmail);
    setRecipientPhone(CLEARED.recipientPhone);
    setCompChoice(CLEARED.compChoice);
    setCustomComp(CLEARED.customComp);
    setExceptions([]);
    setNote(CLEARED.note);
    setTriedSubmit(false);
    setCurrentStep(1);
    setVisitedSteps([1]);
  }

  /** `button` is the Make link button the person pressed, read before the round trip so the chime rises from it. */
  async function submit(button: HTMLButtonElement | null) {
    setTriedSubmit(true);
    if (!canSubmit) return;
    setSubmitting(true);
    const permanent = lifetime === "permanent";
    try {
      const { data, error } = await supabase.rpc("create_invitation" as never, {
        p_kind: kind,
        p_target_role: targetRole,
        // A join link always sits under the person making it: the server resolves null to the caller.
        p_target_manager_id: isJoin ? null : uplineId,
        p_recipient_email: emailGiven ? normalizeEmailInput(sent.email) : null,
        p_recipient_name: recipientName || null,
        p_recipient_phone: sent.phone || null,
        p_license_status: licenseApplies ? license : null,
        p_offered_comp_pct: offeredComp,
        p_carrier_exceptions: isJoin ? [] : exceptions.map((ex) => ({ carrier_id: ex.carrier_id, pct: ex.pct, note: ex.note ?? null })),
        p_expires_hours: expiresHours,
        p_notes: encodeInviteNote(contractingFields, freeNote),
        // Sent only when asked for, so a temporary link is the exact call it always was.
        ...(permanent ? { p_permanent: true } : {}),
      } as never);
      if (error) {
        toast.error(error.message || "The link was not made.");
        return;
      }
      const row = data as unknown as {
        id?: string; kind?: InviteLinkKind; path?: string; expires_at?: string | null; permanent?: boolean;
      } | null;
      if (!row?.id || !row.path) {
        toast.error("The link was not returned. Nothing was shared.");
        return;
      }
      if (permanent && row.permanent !== true) {
        // The server made a link but not the one on screen: say so instead of calling it permanent.
        toast.error("The link was made, but the server did not make it permanent. Replace it from the list below.");
      }
      const result: CreatedInvitation = {
        id: row.id,
        kind: row.kind ?? kind,
        path: row.path,
        expires_at: row.expires_at ?? null,
        permanent: row.permanent === true,
        license: licenseApplies ? license : null,
        recipient_email: emailGiven ? normalizeEmailInput(sent.email) : null,
        recipient_name: recipientName || null,
        contracting: {
          firstName: sent.firstName,
          lastName: sent.lastName,
          email: emailGiven ? normalizeEmailInput(sent.email) : "",
          phone: sent.phone.replace(/\D/g, ""),
          npn: sent.npn.replace(/\D/g, ""),
        },
      };
      setCreated(result);
      // What the form looks like right after reset(), so any later change is detected.
      setCreatedFingerprint(fingerprint({ ...values, ...CLEARED }));
      toast.success(
        result.recipient_name
          ? `Link made for ${result.recipient_name}.`
          : isJoin
            ? "Link made. They fill in their own details when they open it."
            : "Open invitation created. Anyone with the link can fill in their own details.",
      );
      reset();
      // The link exists (the returns above never reach here): bubbles and a chime from the button.
      void celebrate("booked", button);
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
      onCreated?.(result);
      // On a phone the made link lands below the fold: bring it into view.
      window.setTimeout(() => {
        resultRef.current?.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
      }, 0);
    } finally {
      setSubmitting(false);
    }
  }

  // Loading and failure sit where the form will be (inside its card on a page), never loose on the page.
  const frame = (children: ReactNode) => (framed
    ? <section aria-label={isJoin ? "Make a link" : "New invitation"} className="rounded-xl border border-border bg-card p-5 sm:p-8">{children}</section>
    : <>{children}</>);
  if (options.isLoading) {
    return frame(
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your link options…
      </div>,
    );
  }
  if (options.error || !opts) {
    const message = typeof (options.error as { message?: unknown } | null)?.message === "string"
      ? (options.error as { message: string }).message
      : "";
    const noAgent = /no active agent/i.test(message);
    return frame(
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm text-destructive">
          {noAgent
            ? "Links come with an active agent account, and this login does not have one."
            : `Link options could not be loaded${message ? `: ${message}` : "."}`}
        </p>
        {!noAgent && (
          <Button variant="outline" className="h-11" onClick={() => void options.refetch()}>Try again</Button>
        )}
      </div>,
    );
  }

  const previewExpiry = lifetime === "temporary" ? formatExpiry(expiryFrom(expiresHours)) : null;
  const teamSummary = [
    roleOptions.length > 1 ? INVITE_AS_LABEL[inviteAs] : null,
    `Under ${chosenUpline?.name ?? "—"}${chosenUpline?.is_self ? " (me)" : ""}`,
    chosenUpline ? agencyLabel(chosenUpline.agency_key, BRAND.legalName) : null,
    offeredComp != null && Number.isFinite(offeredComp) ? `offered ${offeredComp}%` : "no comp offer",
    exceptions.length ? `${exceptions.length} carrier exception${exceptions.length === 1 ? "" : "s"}` : null,
    note.trim() ? "team note" : null,
  ].filter(Boolean).join(" · ");

  const formBody = (
    <div className="space-y-8">
      <Step
        n={1}
        title={isJoin ? "Who is it for?" : "Who are you inviting?"}
        hint={mode === "quick" ? "They fill in their own details when they open it." : "All optional. Fill in what you know."}
        state={stepState(1)}
        onEnter={() => enterStep(1)}
      >
        <div className="space-y-4">
          <ChoiceGroup<LinkMode> label="What you know about them" value={mode} options={MODE_OPTIONS} onChange={setMode} />
          {mode === "details" && (
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
                  inputMode="email"
                  className={INPUT_CLASS}
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="name@example.com"
                  autoComplete="off"
                />
                <EmailTypoHint value={recipientEmail} onAccept={setRecipientEmail} />
                {emailGiven && !emailOk && (
                  <p role="alert" className="text-sm text-destructive">Enter a valid email address, or leave it blank.</p>
                )}
                <p className="text-[13px] text-muted-foreground">{emailGiven ? "Only this address can use the link." : "Blank means anyone with the link can use it."}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-recipient-phone" className="text-sm">Phone</Label>
                <Input id="invite-recipient-phone" type="tel" inputMode="tel" className={INPUT_CLASS} value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="(555) 123-4567" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-npn" className="text-sm">NPN <span className="font-normal text-muted-foreground">(licensed agents)</span></Label>
                <Input id="invite-npn" inputMode="numeric" className={INPUT_CLASS} value={npn} onChange={(e) => setNpn(e.target.value)} placeholder="5 to 10 digits" autoComplete="off" />
                {npnIssue && <p role="alert" className="text-sm text-destructive">{npnIssue}</p>}
              </div>
            </div>
          )}
        </div>
      </Step>

      <Step
        n={2}
        title="License"
        hint={licenseApplies ? (licenseHint ?? "Required. It decides the path they start on.") : undefined}
        state={stepState(2)}
        onEnter={() => enterStep(2)}
      >
        {licenseApplies ? (
          <div className="space-y-1.5">
            <ChoiceGroup<LicenseChoice>
              label="License"
              value={license}
              options={LICENSE_OPTIONS}
              onChange={setLicense}
              invalid={triedSubmit && licenseMissing}
              describedBy={(triedSubmit && licenseMissing) || license ? "invite-license-help" : undefined}
              stackOnPhone
            />
            {triedSubmit && licenseMissing ? (
              <p id="invite-license-help" role="alert" className="text-sm text-destructive">Pick Licensed or Not licensed yet.</p>
            ) : license ? (
              <p id="invite-license-help" className="text-[13px] text-muted-foreground">{LICENSE_RESULT[kind][license]}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Staff accounts do not need a license, so there is nothing to pick.</p>
        )}
      </Step>

      <Step n={3} title="Link type" state={stepState(3)} onEnter={() => enterStep(3)}>
        <div className="space-y-3">
          <ChoiceGroup<LinkLifetime> label="Link type" value={lifetime} options={LIFETIME_OPTIONS} onChange={setLifetime} describedBy="invite-lifetime-help" />
          {lifetime === "temporary" ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Label htmlFor="invite-expiry" className="text-sm sm:shrink-0">Works for</Label>
              <select id="invite-expiry" className={cn(SELECT_CLASS, "sm:w-44")} value={expiresHours} onChange={(e) => setExpiresHours(Number(e.target.value))}>
                {TEMPORARY_SPANS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
              </select>
              <p id="invite-lifetime-help" className="text-sm text-muted-foreground" data-testid="invite-expiry-preview">
                {previewExpiry ? `Stops working ${previewExpiry}.` : "—"}
              </p>
            </div>
          ) : (
            <p id="invite-lifetime-help" className="text-sm text-muted-foreground">Never expires. It still works for one person.</p>
          )}
        </div>
      </Step>

      {teamStep && (
        <Step n={teamStep} title="Their team and offer" state={stepState(teamStep)} onEnter={() => enterStep(teamStep)}>
          <div className="space-y-4">
            {/* The whole row is the control: the current values, and Change to open them. */}
            <button
              type="button"
              aria-expanded={teamOpen}
              aria-controls="invite-team-fields"
              onClick={() => setTeamOpen((open) => !open)}
              className="flex min-h-12 w-full select-none items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
            >
              <span className="min-w-0 text-sm text-foreground" data-testid="invite-team-summary">{teamSummary}</span>
              <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-foreground">
                {teamOpen ? "Done" : "Change"}
                <ChevronDown className={cn("h-4 w-4 transition-transform", teamOpen && "rotate-180")} aria-hidden="true" />
              </span>
            </button>

            {teamOpen && (
              <div id="invite-team-fields" className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {roleOptions.length > 1 && (
                    <div className="space-y-1.5">
                      <Label htmlFor="invite-as" className="text-sm">Invite as</Label>
                      <select id="invite-as" className={SELECT_CLASS} value={inviteAs} onChange={(e) => setInviteAs(e.target.value as InviteAs)}>
                        {roleOptions.map((r) => <option key={r} value={r}>{INVITE_AS_LABEL[r]}</option>)}
                      </select>
                      {issueFor("target_role") && <p role="alert" className="text-sm text-destructive">{issueFor("target_role")}</p>}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-agency" className="text-sm">Agency</Label>
                    <select id="invite-agency" className={SELECT_CLASS} value={agencyKey} onChange={(e) => setAgencyKey(e.target.value)} disabled={agencies.length < 2}>
                      {agencies.length > 1 && <option value="">All agencies</option>}
                      {agencies.map((key) => <option key={key} value={key}>{agencyLabel(key, BRAND.legalName)}</option>)}
                    </select>
                  </div>
                  <div className={cn("space-y-1.5", roleOptions.length > 1 ? "" : "sm:col-span-2")}>
                    <Label htmlFor="invite-upline" className="text-sm">Upline</Label>
                    <select id="invite-upline" className={SELECT_CLASS} value={uplineId} onChange={(e) => setUplineId(e.target.value)}>
                      {visibleUplines.length === 0 && <option value="">No eligible upline</option>}
                      {visibleUplines.map((u) => (
                        <option key={u.id} value={u.id}>{u.is_self ? `${u.name} (me)` : u.name}</option>
                      ))}
                    </select>
                    {issueFor("target_manager_id") && <p role="alert" className="text-sm text-destructive">{issueFor("target_manager_id")}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    {issueFor("offered_comp_pct") && <p role="alert" className="text-sm text-destructive">{issueFor("offered_comp_pct")}</p>}
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
                        The note is {noteOver} character{noteOver === 1 ? "" : "s"} too long now that the contracting details take part of its space. Shorten it to make the link.
                      </p>
                    ) : note.length > noteRoom - 20 ? (
                      <p className="text-[13px] text-muted-foreground">{noteRoom - note.length} characters left</p>
                    ) : null}
                  </div>
                </div>

                {opts.can_offer_comp && (
                  <div className="space-y-3 rounded-lg border border-border p-4">
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
                    {issueFor("carrier_exceptions") && <p role="alert" className="text-sm text-destructive">{issueFor("carrier_exceptions")}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        </Step>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground" data-testid="invite-summary">
          {[
            recipientName || (mode === "quick" ? "Quick link" : "No details yet"),
            // The role in words without the license, which has its own word next to it.
            isJoin ? "Prospect" : inviteAs === "agent" ? "Agent" : formatRole(targetRole),
            licenseApplies ? (license ? LICENSE_CHOICE_LABEL[license] : "license not picked") : null,
            lifetime === "permanent" ? "Permanent" : `Temporary, ${TEMPORARY_SPANS.find((s) => s.hours === expiresHours)?.label ?? `${expiresHours} hours`}`,
            !isJoin && chosenUpline ? `under ${chosenUpline.name}` : null,
          ].filter(Boolean).join(" · ")}
        </p>
        <Button
          onClick={(e) => void submit(e.currentTarget)}
          variant={goldOnMake ? "default" : "outline"}
          className="h-12 px-6 text-base"
          disabled={submitting || (triedSubmit && !canSubmit)}
          data-testid="create-invitation"
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Link2 className="h-5 w-5" />}
          Make link
        </Button>
      </div>
    </div>
  );

  const createdCard = created && (
    // Keyed by the invitation so each new one pops in; the previous card is replaced, never animated twice.
    <div
      key={created.id}
      ref={resultRef}
      className={cn("apex-pop space-y-4 rounded-xl border border-primary/40 bg-primary/5 p-5", framed && "sm:p-6")}
      data-testid="invitation-created"
    >
      <div className="flex items-start gap-3">
        <ToneBubble tone="gold" size="md" className="mt-0.5">
          <Check />
        </ToneBubble>
        <div className="min-w-0 space-y-2">
          <p className="text-lg font-semibold leading-6">{created.recipient_name ? `Link ready for ${created.recipient_name}` : "Quick link ready"}</p>
          <p className="select-all font-mono text-[15px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
            <WrappableUrl url={inviteUrlFromPath(created.path)} />
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {created.license && <TonePill tone={licensePathTone(created.license)}>{LICENSE_CHOICE_LABEL[created.license]}</TonePill>}
            <TonePill tone={linkLifetimeTone(created.permanent ? "permanent" : "temporary")}>
              {created.permanent ? LINK_LIFETIME_LABEL.permanent : LINK_LIFETIME_LABEL.temporary}
            </TonePill>
            <span className="text-sm text-muted-foreground" data-testid="invitation-lifetime">
              {lifetimeLine({ permanent: created.permanent, expiresAt: created.expires_at })}
            </span>
          </div>
        </div>
      </div>
      <LinkShareRow
        url={inviteUrlFromPath(created.path)}
        kind={created.kind}
        firstName={created.contracting?.firstName || null}
        phone={created.contracting?.phone || null}
        email={created.recipient_email}
        permanent={created.permanent}
        expiresAt={created.expires_at}
        recipientLocked={!!created.recipient_email}
        goldCopy={goldOnCopy}
        onShared={async (channel) => {
          try {
            await shareInvitation(created.id, channel);
          } catch (err) {
            console.warn("record_invitation_share failed", err);
          }
        }}
      />
      <p className="text-sm text-muted-foreground">
        Nothing has been sent. Share it yourself with the buttons above.
        {created.recipient_email ? ` It works once, only for ${created.recipient_email}.` : " Anyone with the link can use it once."}{" "}
        <a
          href={inviteUrlFromPath(created.path)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 align-middle text-foreground underline underline-offset-4 hover:text-primary"
        >
          See what they see <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </p>
      {created.kind === "hire" && created.contracting && (created.contracting.firstName || created.contracting.lastName || created.contracting.npn || created.contracting.phone) && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">For contracting — copy each field into the carrier site</p>
          <ContractingCopyCard info={created.contracting} />
        </div>
      )}
    </div>
  );

  if (framed) {
    return (
      <div className="space-y-4" data-testid="invite-agent-form">
        <section aria-label={isJoin ? "Make a link" : "New invitation"} className="rounded-xl border border-border bg-card p-5 sm:p-8">
          {formBody}
        </section>
        {createdCard}
      </div>
    );
  }
  return (
    <div className="space-y-8" data-testid="invite-agent-form">
      {formBody}
      {createdCard}
    </div>
  );
}
