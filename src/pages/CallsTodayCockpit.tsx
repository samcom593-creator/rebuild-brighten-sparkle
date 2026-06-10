import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Phone, Clock, MapPin, ExternalLink, ArrowRight, CalendarCheck } from "lucide-react";
import { format, formatDistanceToNowStrict, isToday, isTomorrow, isThisWeek } from "date-fns";

import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

interface ScheduledCall {
  id: number;
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

const CALL_TYPE_TINT: Record<string, string> = {
  licensed_prospect: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  unlicensed_prospect: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  agent_oneonone: "border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  followup: "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  team_meeting: "border-slate-500/35 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  unknown: "border-slate-500/35 bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

export default function CallsTodayCockpit() {
  usePageTitle("Calls Today · APEX");
  const navigate = useNavigate();

  const callsQ = useQuery({
    queryKey: ["upcoming-calls"],
    staleTime: 30_000,
    queryFn: async (): Promise<ScheduledCall[]> => {
      const { data, error } = await supabase
        .from("v_upcoming_calls")
        .select("*");
      if (error) throw error;
      return (data ?? []) as ScheduledCall[];
    },
  });

  const grouped = useMemo(() => {
    const today: ScheduledCall[] = [];
    const tomorrow: ScheduledCall[] = [];
    const later: ScheduledCall[] = [];
    for (const c of callsQ.data ?? []) {
      const d = new Date(c.start_at);
      if (isToday(d)) today.push(c);
      else if (isTomorrow(d)) tomorrow.push(c);
      else if (isThisWeek(d, { weekStartsOn: 1 })) later.push(c);
    }
    return { today, tomorrow, later };
  }, [callsQ.data]);

  const startCall = (call: ScheduledCall) => {
    const params = new URLSearchParams();
    if (call.prospect_name) {
      const [first, ...rest] = call.prospect_name.split(" ");
      params.set("first_name", first);
      if (rest.length) params.set("last_name", rest.join(" "));
    }
    if (call.prospect_phone) params.set("phone", call.prospect_phone);
    if (call.summary) params.set("source", call.summary);
    params.set("scheduled_call_id", String(call.id));
    navigate(`/dashboard/inbound-leads?${params.toString()}`);
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Calls · From Google Calendar"
        eyebrowIcon={<CalendarCheck className="h-3 w-3" />}
        title="Calls today"
        subtitle="Every event your assistant adds to your calendar shows up here. Tap Start call to open the inbound-leads form pre-filled with the prospect's name and number."
        accent="emerald"
      />

      {callsQ.isLoading ? (
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <CardContent className="p-6 text-12 text-slate-500">Loading your calendar…</CardContent>
        </Card>
      ) : (callsQ.data ?? []).length === 0 ? (
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <CardContent className="p-10">
            <EmptyState
              icon={<CalendarCheck className="h-6 w-6" />}
              title="No upcoming calls"
              description="When your assistant adds a Licensed Prospect Call or 1:1 to your Google Calendar, it'll appear here within 5 minutes."
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
      <p className="text-12 font-semibold uppercase tracking-wider text-slate-500 px-1">{label}</p>
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

  return (
    <Card className={`bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 ${imminent ? "ring-2 ring-emerald-500" : ""}`}>
      <CardContent className="p-4 flex items-center gap-4">
        <div className="text-center w-16 shrink-0">
          <p className="text-20 font-bold tabular-nums">{format(start, "h:mm")}</p>
          <p className="text-11 text-slate-500 uppercase">{format(start, "a")}</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-14 font-semibold truncate">{call.prospect_name || call.summary || "Untitled call"}</p>
            <Badge variant="outline" className={`text-11 ${CALL_TYPE_TINT[call.call_type] ?? ""}`}>
              {CALL_TYPE_LABEL[call.call_type] ?? "Call"}
            </Badge>
            {imminent && (
              <Badge className="bg-emerald-500 text-white text-11 animate-pulse">
                in {minutesAway}m
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-12 text-slate-500 flex-wrap">
            {call.prospect_phone && (
              <a href={`tel:${call.prospect_phone}`} className="flex items-center gap-1 hover:text-emerald-600">
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
