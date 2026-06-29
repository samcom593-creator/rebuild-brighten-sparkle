import { useState } from "react";
import {
  PhoneCall,
  PhoneOff,
  Voicemail,
  MessageSquare,
  Mail,
  Ban,
  XCircle,
  Send,
  Calendar,
  Pencil,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { safeInvoke } from "@/shared/api/safeInvoke";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * ApplicationDispositionCluster — call-center style per-row disposition buttons
 * + Email popover for the Applications page.
 *
 * Pattern source: InterviewCommandCenter.DispositionButton — 44px tap targets,
 * e.stopPropagation, aria-pressed, data-cc-action.
 *
 * Each disposition tap writes a row to application_contact_log so we have a
 * real outreach audit trail per applicant (call/sms/email/note + outcome).
 *
 * Email popover wraps three real send paths + a free-text note:
 *   - Send Welcome           → send-licensing-instructions edge fn
 *   - Send Calendly Invite   → send-calendly-invite edge fn
 *   - Mark as Emailed        → log-only (no send)
 *   - Free-text note + Save  → log-only with notes
 *
 * Sam directive: 7 disposition buttons total in a single horizontal cluster
 * — Called · No Answer · Voicemail · Texted · Emailed · Bad Number · Pass.
 */

type Tone = "sky" | "slate" | "amber" | "violet" | "emerald" | "rose" | "slate-dim";

interface Props {
  applicationId: string;
  applicantEmail?: string | null;
  applicantFirstName?: string | null;
  applicantPhone?: string | null;
  licenseStatus?: "licensed" | "unlicensed" | "pending" | null;
  agentId?: string | null;
}

export function ApplicationDispositionCluster({
  applicationId,
  applicantEmail,
  applicantFirstName,
  applicantPhone,
  licenseStatus,
  agentId,
}: Props) {
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  async function logContact(
    channel: "call" | "sms" | "email" | "note",
    outcome: string,
    notes?: string,
  ) {
    const { error } = await supabase
      .from("application_contact_log" as never)
      .insert({
        application_id: applicationId,
        channel,
        outcome,
        notes: notes ?? null,
        logged_by: user?.id ?? null,
      } as never);
    if (error) {
      console.error("[application_contact_log] insert failed:", error);
      toast.error(`Failed to log ${outcome}: ${error.message}`);
      return false;
    }
    return true;
  }

  async function disposition(
    key: string,
    channel: "call" | "sms" | "email" | "note",
    label: string,
  ) {
    setBusy(key);
    const ok = await logContact(channel, key);
    setBusy(null);
    if (ok) toast.success(label);
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <DispositionButton
        active={busy === "called"}
        label="Called"
        tone="sky"
        icon={PhoneCall}
        onClick={() => disposition("called", "call", "Logged: Called")}
      />
      <DispositionButton
        active={busy === "no_answer"}
        label="No Ans"
        tone="slate"
        icon={PhoneOff}
        onClick={() =>
          disposition("no_answer", "call", "Logged: No Answer")
        }
      />
      <DispositionButton
        active={busy === "voicemail"}
        label="VM"
        tone="amber"
        icon={Voicemail}
        onClick={() => disposition("voicemail", "call", "Logged: Voicemail")}
      />
      <DispositionButton
        active={busy === "texted"}
        label="Texted"
        tone="violet"
        icon={MessageSquare}
        onClick={() => disposition("texted", "sms", "Logged: Texted")}
      />
      <EmailPopover
        applicationId={applicationId}
        applicantEmail={applicantEmail}
        applicantFirstName={applicantFirstName}
        applicantPhone={applicantPhone}
        licenseStatus={licenseStatus}
        agentId={agentId}
        onLogged={(outcome) => logContact("email", outcome)}
        externalBusy={busy === "emailed"}
      />
      <DispositionButton
        active={busy === "bad_number"}
        label="Bad #"
        tone="rose"
        icon={Ban}
        onClick={() =>
          disposition("bad_number", "call", "Logged: Bad Number")
        }
      />
      <DispositionButton
        active={busy === "pass"}
        label="Pass"
        tone="slate-dim"
        icon={XCircle}
        onClick={() => disposition("pass", "note", "Logged: Pass")}
      />
    </div>
  );
}

function DispositionButton({
  active,
  disabled,
  icon: Icon,
  label,
  tone,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: React.ElementType;
  label: string;
  tone: Tone;
  onClick: () => void;
}) {
  const activeTone: Record<Tone, string> = {
    sky: "border-sky-500/50 bg-sky-500/15 text-sky-200",
    slate: "border-slate-400/40 bg-slate-500/15 text-slate-200",
    amber: "border-amber-500/50 bg-amber-500/15 text-amber-200",
    violet: "border-violet-500/50 bg-violet-500/15 text-violet-200",
    emerald: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
    rose: "border-rose-500/50 bg-rose-500/15 text-rose-200",
    "slate-dim": "border-slate-500/30 bg-slate-500/10 text-slate-400",
  };

  const slug = label.toLowerCase().replace(/[^a-z0-9]/g, "-");

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      aria-pressed={!!active}
      aria-label={label}
      data-cc-action={slug}
      className={cn(
        "min-h-[44px] h-11 gap-1 px-2 text-[11px] sm:text-xs",
        active && activeTone[tone],
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </Button>
  );
}

function EmailPopover({
  applicationId,
  applicantEmail,
  applicantFirstName,
  applicantPhone,
  licenseStatus,
  agentId,
  onLogged,
  externalBusy,
}: {
  applicationId: string;
  applicantEmail?: string | null;
  applicantFirstName?: string | null;
  applicantPhone?: string | null;
  licenseStatus?: "licensed" | "unlicensed" | "pending" | null;
  agentId?: string | null;
  onLogged: (outcome: string) => Promise<boolean>;
  externalBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function sendWelcome() {
    if (!applicantEmail) {
      toast.error("No email on this applicant");
      return;
    }
    setBusy("welcome");
    const idempotencyKey = `licensing:${agentId ?? applicantEmail}:${Math.floor(Date.now() / 60_000)}`;
    const { error, requestId } = await safeInvoke(
      "send-licensing-instructions",
      {
        email: applicantEmail,
        firstName: applicantFirstName ?? "",
        licenseStatus: licenseStatus ?? "unlicensed",
        phone: applicantPhone ?? undefined,
        agentId: agentId ?? undefined,
      },
      { idempotencyKey },
    );
    setBusy(null);
    if (error) {
      console.error(`[send-welcome] failed (req=${requestId}):`, error);
      toast.error(`Send Welcome failed: ${error.message}`);
      return;
    }
    await onLogged("send_welcome");
    toast.success(`Welcome email queued to ${applicantEmail}`);
    setOpen(false);
  }

  async function sendCalendlyInvite() {
    if (!applicantEmail) {
      toast.error("No email on this applicant");
      return;
    }
    setBusy("calendly");
    const { error, requestId } = await safeInvoke("send-calendly-invite", {
      applicant_id: applicationId,
      applicant_email: applicantEmail,
      applicant_first_name: applicantFirstName ?? "",
    });
    setBusy(null);
    if (error) {
      console.error(`[send-calendly-invite] failed (req=${requestId}):`, error);
      toast.error(`Calendly invite failed: ${error.message}`);
      return;
    }
    await onLogged("send_calendly_invite");
    toast.success(`Calendly invite queued to ${applicantEmail}`);
    setOpen(false);
  }

  async function markEmailed() {
    setBusy("mark");
    const ok = await onLogged(note.trim() ? "emailed_with_note" : "emailed");
    if (ok && note.trim()) {
      // Re-log with notes payload by writing a second row would be redundant;
      // overwrite-style: insert a "note" row carrying the free-text body so
      // searches surface it next to the email row.
      await supabase
        .from("application_contact_log" as never)
        .insert({
          application_id: applicationId,
          channel: "email",
          outcome: "emailed_note",
          notes: note.trim(),
        } as never);
    }
    setBusy(null);
    if (ok) {
      toast.success("Marked as emailed");
      setNote("");
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Emailed"
          aria-pressed={!!externalBusy}
          data-cc-action="emailed"
          className="min-h-[44px] h-11 gap-1 px-2 text-[11px] sm:text-xs border-emerald-500/30 hover:bg-emerald-500/10"
          onClick={(e) => e.stopPropagation()}
        >
          <Mail className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Emailed</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Send email · {applicantEmail || "no email"}
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 min-h-[40px]"
          disabled={!applicantEmail || busy === "welcome"}
          onClick={sendWelcome}
        >
          {busy === "welcome" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Send Welcome
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 min-h-[40px]"
          disabled={!applicantEmail || busy === "calendly"}
          onClick={sendCalendlyInvite}
        >
          {busy === "calendly" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Calendar className="h-3.5 w-3.5" />
          )}
          Send Calendly Invite
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 min-h-[40px]"
          disabled={busy === "mark"}
          onClick={markEmailed}
        >
          {busy === "mark" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Pencil className="h-3.5 w-3.5" />
          )}
          Mark as Emailed
        </Button>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note saved with this log entry"
          className="min-h-[64px] text-xs"
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setNote("");
              setOpen(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
