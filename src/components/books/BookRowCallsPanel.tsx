// BookRowCallsPanel — every ReadyMode dialer call the agency ever had with this book row's client,
// inline on the Book of Business row (MP-310, 2026-10-28). Matched by phone first, then by the same
// name key Book Flips uses; each call carries whatever intelligence exists for it: the booking packet
// summary (sold calls), the resell read (objection calls), and the training grade. Sam + Aisha only:
// v_book_row_call_detail is security_invoker over tables gated by can_view_sold_calls(), so anyone
// else gets zero rows and the panel renders nothing.
import { useQuery } from "@tanstack/react-query";
import { PhoneCall, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { looseSupabase } from "@/lib/looseSupabase";
import { CallAudioPlayer } from "@/components/calls/CallAudioPlayer";
import { Badge } from "@/components/ui/badge";
import { dispositionLabel } from "@/lib/readymodeDispositions";

export interface BookRowCall {
  flip_key: string;
  call_id: string;
  matched_by: "phone" | "name";
  external_call_id: string | null;
  call_started_at: string | null;
  disposition: string | null;
  agent_name: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  has_transcript: boolean;
  packet_id: string | null;
  packet_carrier: string | null;
  packet_monthly_premium: number | null;
  packet_status: string | null;
  call_summary: string | null;
  resell_summary: string | null;
  approval_status: string | null;
  gave_ssn: boolean | null;
  gave_bank: boolean | null;
  overall_score: number | null;
  great_call: boolean | null;
  stage_reached: string | null;
  coaching_notes: string | null;
  grade_summary: string | null;
  work_status: string | null;
}

const mmss = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

async function fetchBookRowCalls(flipKey: string): Promise<BookRowCall[]> {
  const { data, error } = await (looseSupabase
    .from("v_book_row_call_detail")
    .select("*")
    .eq("flip_key", flipKey)
    .order("call_started_at", { ascending: false })
    .limit(60) as unknown as Promise<{ data: BookRowCall[] | null; error: Error | null }>);
  if (error) throw error;
  return data ?? [];
}

export function BookRowCallsPanel({ flipKey }: { flipKey: string | null | undefined }) {
  const q = useQuery({
    queryKey: ["book-row-calls", flipKey],
    queryFn: () => fetchBookRowCalls(flipKey as string),
    enabled: !!flipKey,
    staleTime: 60_000,
  });
  const calls = q.data ?? [];
  if (!flipKey || calls.length === 0) return null;
  const sold = calls.filter((c) => c.disposition === "Completed Sale").length;
  return (
    <div className="rounded-xl border border-border/70 bg-muted/10">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm font-semibold">
        <PhoneCall className="h-4 w-4 text-primary" />
        Dialer history · {calls.length} {calls.length === 1 ? "call" : "calls"}
        {sold > 0 && <span className="font-normal text-muted-foreground">· {sold} sold</span>}
        {calls.some((c) => c.matched_by === "name") && !calls.some((c) => c.matched_by === "phone") && (
          <span className="font-normal text-muted-foreground">· matched by name only</span>
        )}
      </div>
      <ul className="divide-y divide-border/60 border-t border-border/60">
        {calls.map((c) => {
          const summary = c.call_summary || c.resell_summary || c.grade_summary;
          return (
            <li key={c.call_id} className="space-y-1 px-4 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{shortDate(c.call_started_at)}</span>
                <Badge variant="outline" className={c.disposition === "Completed Sale" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : ""}>
                  {dispositionLabel(c.disposition)}
                </Badge>
                <span className="text-muted-foreground">{c.agent_name || "unknown agent"}</span>
                {c.duration_seconds != null && c.duration_seconds > 0 && <span className="text-muted-foreground">{mmss(c.duration_seconds)}</span>}
                {c.overall_score != null && c.stage_reached !== "voicemail" && c.stage_reached !== "no_contact" && (
                  <span className={c.great_call ? "inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>
                    {c.great_call && <Star className="h-3.5 w-3.5" />}
                    {c.overall_score}/100
                  </span>
                )}
                {c.packet_id && (
                  <span className="text-muted-foreground">
                    packet {c.packet_status === "booked" ? "resold" : c.packet_status ?? "ready"}
                    {c.packet_carrier ? ` · ${c.packet_carrier}` : ""}
                    {c.packet_monthly_premium ? ` · $${Math.round(Number(c.packet_monthly_premium))}/mo` : ""}
                  </span>
                )}
                {c.approval_status && c.approval_status !== "not_said" && <span className="text-muted-foreground">agent said {c.approval_status}</span>}
                {c.gave_ssn && c.gave_bank && <span className="text-emerald-700 dark:text-emerald-300">gave SSN + bank</span>}
                {c.work_status && <span className="text-muted-foreground">marked {c.work_status}</span>}
                <span className="ml-auto flex items-center gap-3">
                  {c.disposition === "Completed Sale" && c.packet_id && (
                    <Link to={`/dashboard/sold-calls?call=${encodeURIComponent(c.call_id)}`} className="text-primary hover:underline">Sold call</Link>
                  )}
                </span>
              </div>
              {summary ? <p className="text-muted-foreground">{summary}</p> : !c.has_transcript && c.duration_seconds != null && c.duration_seconds > 60 ? (
                <p className="text-xs text-muted-foreground">No transcript yet.</p>
              ) : null}
              <CallAudioPlayer callId={c.call_id} compact />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
