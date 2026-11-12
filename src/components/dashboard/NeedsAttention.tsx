/**
 * NeedsAttention (MP-302, 2026-11-12): who is waiting on a decision, on the owner Home.
 *
 * Current state, not the selected dates: these are people waiting right now, and the header
 * says so. Recruiting groups come from the worklist's own rows and rules (needsAttention.ts),
 * so each count is the list it opens. Interviews come from interview_events for the next 48
 * hours; one with no prep notes is the one that needs preparing.
 *
 * Every row is one person: name, stage, owner, how long they have waited, and one next step.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BellRing, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useRecruitingStaff, useRecruitingWorklist } from "@/components/pipeline/worklist/useRecruitingWorklist";
import { formatAgo, formatWhen, humanizeKey, ownerName, plainSpan } from "@/components/pipeline/worklist/worklistFormat";
import { attentionTotal, buildNeedsAttention, type AttentionItem } from "@/lib/needsAttention";
import { errorMessage } from "@/lib/queryState";

interface UpcomingInterview {
  id: string;
  invitee_name: string | null;
  scheduled_at: string;
  call_track: string | null;
  application_id: string | null;
  prep_notes: string | null;
  owner_user_id: string | null;
}

const HOURS_AHEAD = 48;

function Row({ href, name, meta, action }: { href: string; name: string; meta: string; action: string }) {
  return (
    <li>
      <Link
        to={href}
        className="apex-lift flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2 hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-foreground">{name}</span>
          <span className="block truncate text-[13px] leading-5 text-muted-foreground">{meta}</span>
          {/* On a phone the next step sits under the person, so a long one can never push the row wider than the screen. */}
          <span className="block truncate text-[13px] font-semibold leading-5 text-foreground sm:hidden">{action}</span>
        </span>
        <span aria-hidden="true" className="hidden max-w-[45%] shrink-0 text-right text-[13px] font-semibold leading-4 text-foreground sm:block">{action}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

function Group({ title, rule, count, href, children }: { title: string; rule: string; count: number; href: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-foreground" title={rule}>
          {title} <span className="font-normal tabular-nums text-muted-foreground">· {count.toLocaleString()}</span>
        </h3>
        <Link to={href} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-foreground hover:underline">
          Open all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      <ul className="min-w-0 space-y-1.5">{children}</ul>
    </div>
  );
}

export function NeedsAttention() {
  const { user, isAdmin } = useAuth();
  const worklist = useRecruitingWorklist(isAdmin);
  const staffQuery = useRecruitingStaff(isAdmin);
  const staff = staffQuery.data?.staff ?? [];
  const staffAvailable = staffQuery.data?.available ?? false;

  const interviews = useQuery({
    queryKey: ["needs-attention", "interviews-next-48h"],
    enabled: isAdmin,
    staleTime: 120_000,
    retry: 1,
    queryFn: async (): Promise<UpcomingInterview[]> => {
      const from = new Date();
      const to = new Date(from.getTime() + HOURS_AHEAD * 3_600_000);
      const { data, error } = await supabase
        .from("interview_events" as never)
        .select("id, invitee_name, scheduled_at, call_track, application_id, prep_notes, owner_user_id")
        .is("canceled_at", null)
        .gte("scheduled_at", from.toISOString())
        .lt("scheduled_at", to.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as UpcomingInterview[];
    },
  });

  const groups = useMemo(
    () => (worklist.data ? buildNeedsAttention(worklist.data.rows, { now: new Date(), userId: user?.id ?? null }) : null),
    [worklist.data, user?.id],
  );

  if (!isAdmin) return null;

  const owner = (id: string | null) => (id ? ownerName(id, staff, staffAvailable) : "No owner");
  const personMeta = (item: AttentionItem) =>
    [humanizeKey(item.stage), item.licensed ? "Licensed" : null, owner(item.ownerUserId), item.waitingSince ? `waiting ${formatAgo(item.waitingSince).replace(/ ago$/, "")}` : null]
      .filter(Boolean).join(" · ");

  const unprepared = (interviews.data ?? []).filter((i) => !i.prep_notes?.trim());
  const shown = groups?.filter((g) => g.count > 0) ?? [];
  const total = (groups ? attentionTotal(groups) : 0) + unprepared.length;
  const loading = worklist.isLoading || interviews.isLoading;
  const failed = worklist.isError || interviews.isError;

  return (
    <section aria-labelledby="needs-attention-title" className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id="needs-attention-title" className="flex items-center gap-2 text-lg font-bold text-foreground">
          <BellRing className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Needs attention
          {!loading && !failed ? <span className="font-normal tabular-nums text-muted-foreground">· {total.toLocaleString()}</span> : null}
        </h2>
        <p className="text-[13px] text-muted-foreground">Right now · not the selected dates</p>
      </div>

      {loading ? <Skeleton className="h-40 rounded-xl" /> : null}

      {failed ? (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-tone-hot/35 bg-tone-hot/10 px-3 py-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            {worklist.isError ? `The recruiting list did not load: ${errorMessage(worklist.error)}` : `Upcoming interviews did not load: ${errorMessage(interviews.error)}`}
            {" "}Nothing is being guessed.
          </span>
          <Button size="sm" variant="outline" className="h-10 shrink-0" onClick={() => { void worklist.refetch(); void interviews.refetch(); }}>Try again</Button>
        </div>
      ) : null}

      {!loading && !failed && total === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-[15px] text-muted-foreground">
          Nobody is waiting on you. No overdue follow-ups, no untouched applicants, no unprepared interviews.
        </p>
      ) : null}

      {!loading && total > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {unprepared.length > 0 ? (
            <Group title="Interviews to prepare" rule={`On the calendar in the next ${HOURS_AHEAD} hours with no prep notes.`} count={unprepared.length} href="/dashboard/recruiting/interviews">
              {unprepared.slice(0, 3).map((i) => (
                <Row
                  key={i.id}
                  href={i.application_id ? `/dashboard/recruiting?person=${encodeURIComponent(i.application_id)}` : "/dashboard/recruiting/interviews"}
                  name={i.invitee_name?.trim() || "Name not on file"}
                  meta={[i.call_track === "leader" ? "Leader call" : i.call_track === "licensed" ? "Licensed call" : humanizeKey(i.call_track), owner(i.owner_user_id), `in ${plainSpan(new Date(i.scheduled_at).getTime() - Date.now())}`, formatWhen(i.scheduled_at)].join(" · ")}
                  action="Add prep notes"
                />
              ))}
            </Group>
          ) : null}
          {shown.map((g) => (
            <Group key={g.key} title={g.title} rule={g.rule} count={g.count} href={g.href}>
              {g.items.map((item) => (
                <Row key={item.id} href={item.href} name={item.name} meta={personMeta(item)} action={item.nextAction} />
              ))}
            </Group>
          ))}
        </div>
      ) : null}
    </section>
  );
}
