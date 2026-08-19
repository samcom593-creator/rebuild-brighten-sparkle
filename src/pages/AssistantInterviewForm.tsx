// AssistantInterviewForm
//
// Sam directive 2026-06-15:
// Public, token-gated form Sam's assistant fills out per scheduled interview.
// On submit the assistant-add-interview edge fn writes a row to
// manual_interview_entries (provenance tagged) and returns a Google Calendar
// TEMPLATE URL the assistant taps once to drop the event onto Sam's calendar.
//
// Route: /assistant/interviews?t=<token>  (NO ProtectedRoute wrapper)

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Calendar, CheckCircle2, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/usePageTitle";

type RecentEntry = {
  id: string;
  candidate_name: string;
  scheduled_at: string;
  calendar_template_url: string;
};

const INTERVIEW_TYPES: Array<{ value: string; label: string }> = [
  { value: "general", label: "General" },
  { value: "licensed_prospect", label: "Licensed prospect" },
  { value: "licensed_call", label: "Licensed call" },
  { value: "leader_call", label: "Leader call" },
  { value: "unlicensed_lead", label: "Unlicensed lead" },
  { value: "final_expense_review", label: "Final-expense review" },
  { value: "callback", label: "Callback" },
];

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ??
  "https://xrzweoneiieddzxogewk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env
  .VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const FN_URL = `${SUPABASE_URL}/functions/v1/assistant-add-interview`;

const dash = (s: string | null | undefined) =>
  s && s.trim().length > 0 ? s : "—";

function formatScheduled(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AssistantInterviewForm() {
  usePageTitle("APEX Interview Intake");
  const [searchParams] = useSearchParams();
  const token = searchParams.get("t") ?? "";
  const { toast } = useToast();

  const [checking, setChecking] = useState(true);
  const [tokenOk, setTokenOk] = useState(false);
  const [tokenLabel, setTokenLabel] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [candidateName, setCandidateName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [igHandle, setIgHandle] = useState("");
  const [scheduledAt, setScheduledAt] = useState(""); // datetime-local
  const [durationMinutes, setDurationMinutes] = useState<number>(15);
  const [interviewType, setInterviewType] = useState("general");
  const [notes, setNotes] = useState("");

  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [lastCalendarUrl, setLastCalendarUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Headers reused for every call. Edge fn is no-verify-jwt but Supabase still
  // wants an apikey header for the gateway.
  const baseHeaders = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (SUPABASE_PUBLISHABLE_KEY) {
      h["apikey"] = SUPABASE_PUBLISHABLE_KEY;
      h["Authorization"] = `Bearer ${SUPABASE_PUBLISHABLE_KEY}`;
    }
    return h;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkToken() {
      if (!token) {
        setChecking(false);
        setTokenOk(false);
        return;
      }
      try {
        const res = await fetch(
          `${FN_URL}?t=${encodeURIComponent(token)}`,
          { method: "GET", headers: baseHeaders },
        );
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          label?: string;
        };
        if (cancelled) return;
        if (res.ok && body.ok) {
          setTokenOk(true);
          setTokenLabel(body.label ?? "Assistant interview share link");
        } else {
          setTokenOk(false);
        }
      } catch (_e) {
        if (cancelled) return;
        setTokenOk(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    checkToken();
    return () => {
      cancelled = true;
    };
  }, [token, baseHeaders]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!candidateName.trim()) {
      setErrorMsg("Candidate name is required.");
      return;
    }
    if (!scheduledAt) {
      setErrorMsg("Pick a date and time.");
      return;
    }

    setSubmitting(true);
    try {
      // datetime-local is naive (no timezone). Treat it as the assistant's
      // local time, which is what they meant when they picked it.
      const iso = new Date(scheduledAt).toISOString();
      const payload: Record<string, unknown> = {
        token,
        candidate_name: candidateName.trim(),
        scheduled_at: iso,
        duration_minutes: durationMinutes,
        interview_type: interviewType,
      };
      if (phone.trim()) payload.phone = phone.trim();
      if (email.trim()) payload.email = email.trim();
      if (igHandle.trim()) payload.instagram_handle = igHandle.trim();
      if (notes.trim()) payload.notes = notes.trim();

      const res = await fetch(FN_URL, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        interview_id?: string;
        calendar_template_url?: string;
        error?: string;
      };

      if (!res.ok || !body.ok) {
        setErrorMsg(body.error ?? "Could not save. Try again.");
        toast({
          title: "Could not save",
          description: body.error ?? "Try again.",
          variant: "destructive",
        });
        return;
      }

      const calendarUrl = body.calendar_template_url ?? "";
      setLastCalendarUrl(calendarUrl);
      setRecent((prev) =>
        [
          {
            id: body.interview_id ?? "",
            candidate_name: candidateName.trim(),
            scheduled_at: iso,
            calendar_template_url: calendarUrl,
          },
          ...prev,
        ].slice(0, 3),
      );
      toast({
        title: "Booked",
        description: "Calendar event ready to add.",
      });

      // Clear form for the next entry
      setCandidateName("");
      setPhone("");
      setEmail("");
      setIgHandle("");
      setScheduledAt("");
      setDurationMinutes(15);
      setInterviewType("general");
      setNotes("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setErrorMsg(msg);
      toast({
        title: "Network error",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Checking link…</span>
        </div>
      </div>
    );
  }

  if (!tokenOk) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-3xl border border-border/40 bg-card/40 px-6 py-7 text-center">
          <h1 className="text-xl font-semibold mb-2">This link isn't active</h1>
          <p className="text-sm text-muted-foreground">
            Ask Sam for a fresh link. The one you used has been disabled or
            doesn't exist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="max-w-xl mx-auto px-4 sm:px-6">
        <PageHeader
          eyebrow="APEX Financial"
          eyebrowIcon={<Calendar className="h-4 w-4" />}
          title="Interview intake"
          subtitle={tokenLabel}
          accent="emerald"
        />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-3xl bg-card/40 border border-border/40 px-6 py-7 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="candidate_name">
                Candidate name <span className="text-rose-400">*</span>
              </Label>
              <Input
                id="candidate_name"
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="e.g. Jordan Smith"
                className="text-base h-12"
                autoComplete="name"
                required
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1…"
                  className="text-base h-12"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="text-base h-12"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ig">Instagram handle</Label>
              <Input
                id="ig"
                value={igHandle}
                onChange={(e) =>
                  setIgHandle(e.target.value.replace(/^@+/, ""))
                }
                placeholder="@handle"
                className="text-base h-12"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="scheduled">
                  Date & time <span className="text-rose-400">*</span>
                </Label>
                <Input
                  id="scheduled"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="text-base h-12"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">Duration (minutes)</Label>
                <Input
                  id="duration"
                  type="number"
                  value={durationMinutes}
                  min={5}
                  max={240}
                  onChange={(e) =>
                    setDurationMinutes(
                      Math.max(5, Math.min(240, Number(e.target.value) || 15)),
                    )
                  }
                  className="text-base h-12"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Interview type</Label>
              <Select
                value={interviewType}
                onValueChange={(v) => setInterviewType(v)}
              >
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder="General" />
                </SelectTrigger>
                <SelectContent>
                  {INTERVIEW_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Source, context, anything Sam should know."
                className="text-base min-h-24"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 text-rose-200 px-4 py-3 text-sm">
              {errorMsg}
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full h-14 text-base"
            disabled={submitting}
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" /> Saving…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" /> Save interview
              </span>
            )}
          </Button>

          {lastCalendarUrl && (
            <Button asChild size="lg" variant="secondary" className="w-full h-14 text-base">
              <a
                href={lastCalendarUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full"
              >
                <span className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" /> Add to Google Calendar
                  <ExternalLink className="h-4 w-4 opacity-70" />
                </span>
              </a>
            </Button>
          )}
        </form>

        {recent.length > 0 && (
          <div className="mt-8 rounded-3xl bg-card/40 border border-border/40 px-6 py-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              Just added (this session)
            </div>
            <ul className="space-y-3">
              {recent.map((r) => (
                <li
                  key={r.id || `${r.candidate_name}-${r.scheduled_at}`}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {dash(r.candidate_name)}
                    </div>
                    <div className="text-muted-foreground">
                      {formatScheduled(r.scheduled_at)}
                    </div>
                  </div>
                  {r.calendar_template_url ? (
                    <a
                      href={r.calendar_template_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 text-emerald-400 hover:underline"
                      aria-label={`Add ${r.candidate_name} to Google Calendar`}
                    >
                      <Copy className="h-4 w-4" /> Calendar
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
