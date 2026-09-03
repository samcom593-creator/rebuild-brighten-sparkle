import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { contactLinkProps, openGoogleVoice, phoneHref } from "@/lib/phone";
import { Phone, Clock, MapPin, ExternalLink, ArrowRight, CalendarCheck, PhoneCall, CheckCircle2, Timer, CalendarPlus } from "lucide-react";
import { format, formatDistanceToNowStrict, isToday, isTomorrow, isThisWeek } from "date-fns";

import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface ScheduledCall {
  id: string | number;
  prospect_name: string | null;
  prospect_phone: string | null;
  prospect_email: string | null;
  summary: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  duration_minutes: number | null;
  call_type: string;
  status: string;
  outcome: string | null;
  inbound_lead_id: string | null;
}

const CALL_TYPE_LABEL: Record<string, string> = {
  licensed_prospect: "Licensed",
  unlicensed_prospect: "Unlicensed",
  agent_oneonone: "1:1",
  followup: "Follow-up",
  team_meeting: "Team",
  unknown: "Call",
};

// v24 palette restraint: was 5 rainbow tints (emerald/amber/blue/violet/slate).
// Now mono — slate-only chips. Emerald reserved exclusively for the
// imminent-call border-l rail (see CallRow below).
const CALL_TYPE_TINT: Record<string, string> = {
  licensed_prospect:   "border-border bg-muted text-foreground",
  unlicensed_prospect: "border-border bg-muted text-foreground",
  agent_oneonone:      "border-border bg-muted text-foreground",
  followup:            "border-border bg-muted text-foreground",
  team_meeting:        "border-border bg-muted text-foreground",
  unknown:             "border-border bg-muted text-foreground",
};

export default function CallsTodayCockpit() {
  usePageTitle("Calls Today · APEX");

  const callsQ = useQuery({
    queryKey: ["calls-today-interview-events"],
    staleTime: 30_000,
    queryFn: async (): Promise<ScheduledCall[]> => {
      // v_upcoming_calls is built on apex_scheduled_calls, frozen since spring, and
      // upcoming-only so CONNECTED/BOOKED could never populate. interview_events is
      // the live Calendly booking table; its outcome column is dispositioned via the
      // Interview Command Center, so today's real calls + real stats show here.
      const { data, error } = await supabase
        .from("interview_events" as any)
        .select("id, invitee_name, invitee_phone, invitee_email, call_track, event_type_name, scheduled_at, ended_at, outcome, canceled_at, confirmed_at, application_id")
        .is("canceled_at", null)
        .gte("scheduled_at", new Date(Date.now() - 2 * 86_400_000).toISOString())
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      const trackToType: Record<string, string> = { licensed: "licensed_prospect", leader: "agent_oneonone" };
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        prospect_name: r.invitee_name ?? null,
        prospect_phone: r.invitee_phone ?? null,
        prospect_email: r.invitee_email ?? null,
        summary: r.call_track ?? r.event_type_name ?? null,
        location: null,
        start_at: r.scheduled_at,
        end_at: r.ended_at ?? null,
        duration_minutes: null,
        call_type: trackToType[String(r.call_track)] ?? "unknown",
        status: r.outcome ? "completed" : r.confirmed_at ? "confirmed" : "scheduled",
        outcome: r.outcome ?? null,
        inbound_lead_id: r.application_id ?? null,
      } as ScheduledCall));
    },
  });

  // v26 audit fix: isThisWeek silently dropped any call scheduled beyond
  // this week. Calls on Monday next week vanished entirely. Now: today /
  // tomorrow / later (any future call within next 14 days lands here).
  const grouped = useMemo(() => {
    const today: ScheduledCall[] = [];
    const tomorrow: ScheduledCall[] = [];
    const later: ScheduledCall[] = [];
    const now = Date.now();
    const horizon = now + 14 * 24 * 60 * 60 * 1000;
    for (const c of callsQ.data ?? []) {
      const d = new Date(c.start_at);
      if (isToday(d)) today.push(c);
      else if (isTomorrow(d)) tomorrow.push(c);
      else if (d.getTime() > now && d.getTime() < horizon) later.push(c);
    }
    return { today, tomorrow, later };
  }, [callsQ.data]);

  const startCall = (call: ScheduledCall) => {
    // Actually place the call. The old target (/dashboard/inbound-leads) was
    // retired to a redirect and nothing consumes the params, so this button did
    // nothing. Dial the prospect via Google Voice (works on desktop, keeps GV
    // caller-ID); fall back to tel: and clipboard if the number isn't dialable.
    const phone = call.prospect_phone;
    if (!phone) {
      toast.error("No phone number on this call");
      return;
    }
    if (openGoogleVoice(phone)) {
      toast.success("Opening Google Voice", { description: `Dialing ${call.prospect_name || phone}` });
    } else {
      navigator.clipboard?.writeText(phone).catch(() => { /* empty-catch-allow:clipboard blocked; toast still shows the number */ });
      /* contact-scheme-allow: the else-branch of an explicit Google Voice attempt. The number is copied to the clipboard and the toast says to paste it, so a desktop no-op is handled, not hidden. */
      window.open(`tel:${phone}`, "_self");
      toast.success(`${phone} copied — paste into your dialer`);
    }
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Calls · From Google Calendar"
        eyebrowIcon={<CalendarCheck className="h-3 w-3" />}
        title="Calls today"
        subtitle="Every event your assistant adds to your calendar shows up here. Tap Start call to open the inbound-leads form pre-filled with the prospect's name and number."
      />

      {/* v6 §31 canonical amber-gradient hero · live data via useQuery.
          Replaces flat 3-tile row. Total calls today / Connected / Avg duration
          / Booked appointments — all derived from v_upcoming_calls. */}
      <CallsTodayHero calls={callsQ.data ?? []} todayCalls={grouped.today} />


      {callsQ.isLoading ? (
        <div className="space-y-2">
          {/* v24 audit fix: skeleton CallRow placeholders instead of plain
              "Loading…" text · prevents layout reflow on data arrival */}
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (callsQ.data ?? []).length === 0 ? (
        <Card className="bg-white dark:bg-card border-slate-200 dark:border-border">
          <CardContent className="p-10">
            <EmptyState
              icon={<CalendarCheck className="h-6 w-6" />}
              title="Inbox zero. Dial something new."
              description="Booked calls from Calendly (Licensed Prospect Calls and Leader Calls) show up here automatically. Nothing on the books right now — go hunt."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {grouped.today.length > 0 && (
            <Section label={`Today · ${grouped.today.length} ${grouped.today.length === 1 ? "call" : "calls"}`} calls={grouped.today} onStart={startCall} />
          )}
          {grouped.tomorrow.length > 0 && (
            <Section label="Tomorrow" calls={grouped.tomorrow} onStart={startCall} />
          )}
          {grouped.later.length > 0 && (
            <Section label="Later this week" calls={grouped.later} onStart={startCall} />
          )}
        </>
      )}
    </div>
  );
}

function Section({
  label,
  calls,
  onStart,
}: {
  label: string;
  calls: ScheduledCall[];
  onStart: (c: ScheduledCall) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-12 font-semibold uppercase tracking-wider text-muted-foreground px-1">{label}</p>
      <div className="space-y-2">
        {calls.map((call) => (
          <CallRow key={call.id} call={call} onStart={onStart} />
        ))}
      </div>
    </div>
  );
}

function CallRow({ call, onStart }: { call: ScheduledCall; onStart: (c: ScheduledCall) => void }) {
  const start = new Date(call.start_at);
  const inFuture = start.getTime() > Date.now();
  const minutesAway = Math.round((start.getTime() - Date.now()) / 60000);
  const imminent = inFuture && minutesAway <= 15;

  // v6 §31: stage-tinted row backgrounds.
  // Completed (emerald), Missed (rose), Pending past-time (amber).
  const stageTone = getStageTone(call, inFuture);

  return (
    <Card className={`${stageTone.bg} ${stageTone.border} ${imminent ? "border-l-2 border-l-emerald-500" : ""}`}>
      <CardContent className="p-4 flex items-center gap-4">
        <div className="text-center w-16 shrink-0">
          <p className="text-20 font-bold tabular-nums">{format(start, "h:mm")}</p>
          <p className="text-11 text-muted-foreground uppercase">{format(start, "a")}</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-14 font-semibold truncate">{call.prospect_name || call.summary || "Untitled call"}</p>
            <Badge variant="outline" className={`text-11 ${CALL_TYPE_TINT[call.call_type] ?? ""}`}>
              {CALL_TYPE_LABEL[call.call_type] ?? "Call"}
            </Badge>
            {imminent && (
              <Badge className="bg-emerald-500 text-white text-11">
                in {minutesAway}m
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-12 text-muted-foreground flex-wrap">
            {call.prospect_phone && (
              <a href={phoneHref(call.prospect_phone) ?? `tel:${call.prospect_phone}`} {...contactLinkProps(phoneHref(call.prospect_phone))} className="flex items-center gap-1 hover:text-emerald-600">
                <Phone className="h-3 w-3" /> {call.prospect_phone}
              </a>
            )}
            {call.location && call.location !== call.prospect_phone && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {call.location}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {inFuture ? `in ${formatDistanceToNowStrict(start)}` : formatDistanceToNowStrict(start, { addSuffix: true })}
              {call.duration_minutes ? ` · ${call.duration_minutes}m` : ""}
            </span>
          </div>
        </div>
        <Button
          variant={imminent ? "default" : "outline"}
          size="sm"
          onClick={() => onStart(call)}
          className="shrink-0"
        >
          Start call <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}

// v6 §31: stage-tinted row backgrounds per Sam's spec.
// rose = missed · amber = pending · emerald = completed · default = neutral.
function getStageTone(call: ScheduledCall, inFuture: boolean): { bg: string; border: string } {
  const status = (call.status ?? "").toLowerCase();
  const outcome = (call.outcome ?? "").toLowerCase();
  const completed = status === "completed" || status === "done" || outcome === "connected" || outcome === "booked" || outcome === "won";
  const missed = status === "missed" || status === "no_show" || outcome === "no_answer" || outcome === "missed" || (!inFuture && !completed && status !== "in_progress");
  const pending = !inFuture && !completed && !missed;
  if (completed) {
    return { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-900/60" };
  }
  if (missed) {
    return { bg: "bg-rose-50 dark:bg-rose-950/30", border: "border-rose-200 dark:border-rose-900/60" };
  }
  if (pending) {
    return { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-900/60" };
  }
  return { bg: "bg-white dark:bg-card", border: "border-slate-200 dark:border-border" };
}

// v6 §31 canonical hero — amber gradient (recruiting/data lane).
// Live data: Total calls today / Connected / Avg duration / Booked appointments.
function CallsTodayHero({ calls, todayCalls }: { calls: ScheduledCall[]; todayCalls: ScheduledCall[] }) {
  const stats = useMemo(() => {
    const total = todayCalls.length;
    let connected = 0;
    let booked = 0;
    let durationSum = 0;
    let durationCount = 0;
    for (const c of todayCalls) {
      const outcome = (c.outcome ?? "").toLowerCase();
      const status = (c.status ?? "").toLowerCase();
      if (outcome === "connected" || outcome === "booked" || outcome === "won" || status === "completed" || status === "done") connected += 1;
      if (outcome === "booked" || outcome === "appointment_set" || outcome === "scheduled_followup") booked += 1;
      if (typeof c.duration_minutes === "number" && c.duration_minutes > 0) {
        durationSum += c.duration_minutes;
        durationCount += 1;
      }
    }
    const avgDuration = durationCount > 0 ? Math.round(durationSum / durationCount) : null;
    return { total, connected, booked, avgDuration };
  }, [todayCalls]);

  const nextCall = todayCalls.find((c) => new Date(c.start_at).getTime() > Date.now());

  return (
    <div className="rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_64px_-12px_hsl(168_70%_45%/0.35)] overflow-hidden relative">
      {/* glow accents · 2 + 1 radial */}
      <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-emerald-500/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,hsl(168_70%_45%/0.06),transparent_60%)] pointer-events-none" />

      <div className="relative p-5 sm:p-6">
        {/* LIVE indicator */}
        <div className="flex items-center gap-2 mb-4">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">DIAL SHEET · LIVE</p>
          {nextCall && (
            <p className="text-[11px] text-white/50 ml-auto tabular-nums">
              Next up · {formatDistanceToNowStrict(new Date(nextCall.start_at))} · {nextCall.prospect_name ?? "Untitled"}
            </p>
          )}
        </div>

        {/* big number row · 4 columns */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <PhoneCall className="h-3 w-3 text-amber-400" />
              <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">TODAY</p>
            </div>
            <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-white">{stats.total}</p>
            <p className="text-[10px] text-white/50 mt-1 tabular-nums">{stats.total === 1 ? "call scheduled" : "calls scheduled"}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">CONNECTED</p>
            </div>
            <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-emerald-300">{stats.connected}</p>
            <p className="text-[10px] text-white/50 mt-1 tabular-nums">
              {stats.total > 0 ? `${Math.round((stats.connected / stats.total) * 100)}% contact rate` : "—"}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Timer className="h-3 w-3 text-amber-400" />
              <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">AVG DURATION</p>
            </div>
            <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-amber-300">
              {stats.avgDuration ?? "—"}
              {stats.avgDuration !== null && <span className="text-[16px] font-bold text-white/60 ml-1">m</span>}
            </p>
            <p className="text-[10px] text-white/50 mt-1 tabular-nums">per connected call</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <CalendarPlus className="h-3 w-3 text-emerald-400" />
              <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">BOOKED</p>
            </div>
            <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-emerald-300">{stats.booked}</p>
            <p className="text-[10px] text-white/50 mt-1 tabular-nums">appointments set</p>
          </div>
        </div>

        {/* inner glass band · sub-stats */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">QUEUE</p>
            <p className="text-[22px] leading-none font-bold tabular-nums text-white">{calls.length}</p>
            <p className="text-[10px] text-white/40 tabular-nums">total upcoming</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">REMAINING</p>
            <p className="text-[22px] leading-none font-bold tabular-nums text-white">{Math.max(0, stats.total - stats.connected)}</p>
            <p className="text-[10px] text-white/40 tabular-nums">still to dial</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">CLOSE RATE</p>
            <p className="text-[22px] leading-none font-bold tabular-nums text-white">
              {stats.connected > 0 ? `${Math.round((stats.booked / stats.connected) * 100)}%` : "—"}
            </p>
            <p className="text-[10px] text-white/40 tabular-nums">booked / connected</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">NEXT UP</p>
            <p className="text-[22px] leading-none font-bold tabular-nums text-white">
              {nextCall ? formatDistanceToNowStrict(new Date(nextCall.start_at)) : "—"}
            </p>
            <p className="text-[10px] text-white/40 tabular-nums truncate">{nextCall?.prospect_name ?? "no call yet"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
