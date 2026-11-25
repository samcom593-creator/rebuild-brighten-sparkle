/**
 * DialerSeatsPanel, on Reports for admins only (MP-SEATS-1, 2026-11-19).
 *
 * Sam: "automate the dialing even more ... lock people out, log people out who are inactive. Automatically keep the
 * seats rolling." ReadyMode sells concurrent seats (4 that day, all 4 in use) and 34 logins competed for them, 10 of
 * them belonging to people already banned on the platform. The local puller now snapshots the seats every 10 minutes,
 * signs out sessions ReadyMode itself marks inactive and locks the login of anyone the platform has shut out. This
 * panel is where that shows: who holds a seat and whether they are dialing, how often the seats are full, what the
 * automation did, and the logins nobody has dialed from in 30 days.
 *
 * Reads admin_dialer_seats() (admin only, 42501 otherwise). A non-admin never mounts the query.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Headset, Lock, LogOut, PhoneOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { QueryState, queryStale, queryStatus } from "@/components/ui/query-state";
import { formatTimeAgo } from "@/lib/dateUtils";
import { tonePill, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

export interface SeatHolder {
  uid: string;
  account: string | null;
  name: string | null;
  licence: string | null;
  signed_in: string | null;
  last_active: string | null;
  inactive: boolean;
  agent_name: string | null;
  calls_today: number;
  last_call_at: string | null;
}
export interface DialerSeats {
  generated_at: string;
  snapshot_at: string | null;
  seats: { agent_total: number; agent_assigned: number; agent_remaining: number; admin_total: number; admin_assigned: number; admin_remaining: number } | null;
  holders: SeatHolder[];
  week: { snapshots: number; full_snapshots: number } | null;
  signed_out_7d: number;
  locked_7d: number;
  actions: Array<{ at: string; action: string; name: string | null; reason: string; ok: boolean }>;
  dormant_logins: Array<{ uid: number; name: string; agent_name: string | null; last_call_at: string | null }>;
  unlinked_dialers: Array<{ dialer_name: string; calls_30d: number; last_call_at: string | null }>;
  automation: { autosignout: boolean; autolock: boolean };
}

/** A snapshot older than this means the local puller has stopped, so the seat picture is history, not now. */
export const SEAT_SNAPSHOT_STALE_MS = 30 * 60_000;

/** What one seat holder is doing, in a word. Icon and word carry it, never colour alone. */
export function holderState(h: SeatHolder): { label: string; tone: Tone; Icon: typeof CheckCircle2 } {
  if (!/agent/i.test(h.licence ?? "")) return { label: "Admin licence", tone: "slate", Icon: CheckCircle2 };
  if (h.inactive) return { label: "Window closed", tone: "hot", Icon: PhoneOff };
  if (h.calls_today === 0) return { label: "Holding a seat, no calls today", tone: "warm", Icon: AlertTriangle };
  return { label: `${h.calls_today} call${h.calls_today === 1 ? "" : "s"} today`, tone: "good", Icon: CheckCircle2 };
}

const ACTION_COPY: Record<string, { text: string; Icon: typeof LogOut }> = {
  signout_inactive: { text: "signed out (session was inactive)", Icon: LogOut },
  lock_banned_account: { text: "login locked", Icon: Lock },
};

async function fetchSeats(): Promise<DialerSeats> {
  const { data, error } = await supabase.rpc("admin_dialer_seats" as never);
  if (error) throw error;
  return data as unknown as DialerSeats;
}

export function DialerSeatsPanel({ viewerId }: { viewerId: string }) {
  const { isAdmin } = useAuth();
  const q = useQuery({ queryKey: ["admin-dialer-seats", viewerId], queryFn: fetchSeats, enabled: isAdmin && Boolean(viewerId), staleTime: 60_000 });
  if (!isAdmin) return null;
  const d = q.data;
  const stale = !!d?.snapshot_at && Date.now() - new Date(d.snapshot_at).getTime() > SEAT_SNAPSHOT_STALE_MS;
  const agentHolders = (d?.holders ?? []).filter((h) => /agent/i.test(h.licence ?? ""));
  const idle = agentHolders.filter((h) => !h.inactive && h.calls_today === 0);
  const fullPct = d?.week && d.week.snapshots > 0 ? Math.round((d.week.full_snapshots / d.week.snapshots) * 100) : null;

  return (
    <GlassCard className="space-y-4 p-4 sm:p-5" data-testid="dialer-seats">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><Headset className="h-4 w-4 text-primary" aria-hidden="true" /> Dialer seats</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Who holds a ReadyMode seat right now and whether they are dialing. Checked every 10 minutes; dead sessions are signed out and banned people's logins are locked automatically.
        </p>
      </div>

      <QueryState status={queryStatus({ ...q, isEmpty: false })} label="the dialer seats" error={q.error} onRetry={() => void q.refetch()} stale={queryStale(q)} asOf={d?.snapshot_at ?? null}>
        {d && (!d.seats ? (
          <p className="rounded-lg border border-border/60 p-3 text-sm text-muted-foreground" data-testid="seats-none">
            No seat check has been recorded yet. The first one lands within 10 minutes of the dialer puller running.
          </p>
        ) : (
          <div className="space-y-4">
            {stale && (
              <p className="rounded-lg border border-tone-hot/35 bg-tone-hot/12 p-3 text-sm" role="status" data-testid="seats-stale">
                The last seat check was {formatTimeAgo(d.snapshot_at)}. The puller on the Studio has stopped, so this is the last known picture, not now.
              </p>
            )}
            <p className="text-sm" data-testid="seats-headline">
              <span className="text-2xl font-semibold tabular-nums">{d.seats.agent_assigned} of {d.seats.agent_total}</span>{" "}
              dialing seats in use, {d.seats.agent_remaining} free.{" "}
              <span className="text-muted-foreground">
                Admin licences: {d.seats.admin_assigned} of {d.seats.admin_total} in use.
                {fullPct !== null ? ` Seats were full in ${fullPct}% of checks during calling hours this week.` : ""}
              </span>
            </p>
            {idle.length > 0 && d.seats.agent_remaining === 0 && (
              <p className="rounded-lg border border-tone-warm/35 bg-tone-warm/12 p-3 text-sm" data-testid="seats-idle">
                Every seat is taken and {idle.map((h) => h.name).join(", ")} {idle.length === 1 ? "has" : "have"} made no calls today.
                {d.seats.admin_remaining > 0 ? " Anyone who is only watching can sign in with the admin box ticked: an admin licence is free and it gives a dialing seat back." : ""}
              </p>
            )}

            <ul className="divide-y divide-border/60 rounded-lg border border-border/60 text-sm" data-testid="seats-holders">
              {d.holders.map((h) => {
                const st = holderState(h);
                return (
                  <li key={h.uid} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{h.agent_name ?? h.name ?? "Unknown login"}{h.agent_name && h.name ? <span className="ml-1.5 font-normal text-muted-foreground">({h.name})</span> : null}</p>
                      <p className="text-xs text-muted-foreground">
                        Signed in {h.signed_in ?? "at an unknown time"}
                        {h.last_call_at ? ` · last call ${formatTimeAgo(h.last_call_at)}` : /agent/i.test(h.licence ?? "") ? " · no call on record" : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn("gap-1 font-normal", tonePill(st.tone))}><st.Icon className="h-3 w-3" aria-hidden="true" />{st.label}</Badge>
                  </li>
                );
              })}
            </ul>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold">What the automation did, 7 days</h3>
                <p className="text-sm text-muted-foreground" data-testid="seats-automation">
                  {d.signed_out_7d} dead session{d.signed_out_7d === 1 ? "" : "s"} signed out, {d.locked_7d} login{d.locked_7d === 1 ? "" : "s"} locked.
                  {" "}Sign-out is {d.automation.autosignout ? "on" : "OFF"}, lock-out is {d.automation.autolock ? "on" : "OFF"}.
                </p>
                {d.actions.length > 0 && (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {d.actions.slice(0, 12).map((a) => {
                      const copy = ACTION_COPY[a.action] ?? { text: a.action, Icon: LogOut };
                      return (
                        <li key={`${a.at}-${a.name}-${a.action}`} className="flex items-start gap-1.5">
                          <copy.Icon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                          <span><span className="text-foreground">{a.name ?? "Unknown login"}</span> {a.ok ? copy.text : `${copy.text}: did NOT take`} · {a.reason} · {formatTimeAgo(a.at)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <section className="space-y-1.5">
                <h3 className="text-sm font-semibold">Logins nobody has dialed from in 30 days <span className="font-normal text-muted-foreground">· {d.dormant_logins.length}</span></h3>
                <p className="text-xs text-muted-foreground" data-testid="seats-dormant">
                  {d.dormant_logins.length === 0 ? "None." : d.dormant_logins.map((x) => x.agent_name ?? x.name).join(", ")}
                </p>
                {d.unlinked_dialers.length > 0 && (
                  <p className="text-xs" data-testid="seats-unlinked">
                    <span className="font-medium">Not linked to an agent:</span>{" "}
                    <span className="text-muted-foreground">{d.unlinked_dialers.slice(0, 6).map((u) => `${u.dialer_name} (${u.calls_30d} calls in 30 days)`).join(", ")}. Their calls show under no one until someone says who they are.</span>
                  </p>
                )}
              </section>
            </div>
          </div>
        ))}
      </QueryState>
    </GlassCard>
  );
}

export default DialerSeatsPanel;
