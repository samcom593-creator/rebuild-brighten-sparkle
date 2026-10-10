import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTeamAttendance } from "@/hooks/useTeamAttendance";
import {
  MARKS, bulkPreview, dateKeyLabel, expectedLabel, filterAttendance, phoenixToday, shiftDateKey, statusLabel,
  type AttendanceStageFilter, type MarkStatus,
} from "@/lib/teamStage";
import { StageBadge } from "@/components/team/StageBadge";

/**
 * Attendance for one day, today in America/Phoenix by default. Who is expected comes from each person's work commitment
 * in force that day and their start date; marks are one tap with an Undo, corrections keep history, and a bulk mark only
 * ever applies to people you selected and previewed, and never overwrites a mark already made.
 */
export function TeamAttendance({ className }: { className?: string }) {
  const today = phoenixToday();
  const [date, setDate] = useState(today);
  const att = useTeamAttendance(date, true);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<AttendanceStageFilter>("all");
  const [onlyExpected, setOnlyExpected] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<Exclude<MarkStatus, "unmarked">>("present");

  const people = useMemo(() => filterAttendance(att.day?.people ?? [], stage, search, onlyExpected), [att.day, stage, search, onlyExpected]);
  const preview = useMemo(() => bulkPreview(att.day?.people ?? [], selected), [att.day, selected]);

  if (!att.canRead) return <p className={cn("rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground", className)}>Attendance is for admins, managers and the team that supports them.</p>;

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" className="h-10 w-10 p-0" aria-label="Previous day" onClick={() => setDate((d) => shiftDateKey(d, -1))}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
      <label className="text-sm">
        <span className="sr-only">Attendance date</span>
        <input type="date" value={date} max={today} onChange={(e) => { if (e.target.value && e.target.value <= today) setDate(e.target.value); }} aria-label="Attendance date"
          className="h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
      </label>
      <Button type="button" variant="outline" size="sm" className="h-10 w-10 p-0" aria-label="Next day" disabled={date >= today} onClick={() => setDate((d) => (shiftDateKey(d, 1) <= today ? shiftDateKey(d, 1) : d))}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
      {date !== today ? <Button type="button" variant="ghost" size="sm" className="h-10" onClick={() => setDate(today)}>Today</Button> : null}
      <span className="text-sm font-medium text-foreground">{dateKeyLabel(date)}{date === today ? " (today, Phoenix)" : ""}</span>
    </div>
  );

  if (att.query.isLoading) return <section aria-label="Attendance" className={cn("space-y-3", className)}>{header}<div aria-busy="true" aria-label="Loading attendance" className="space-y-2">{["a", "b", "c"].map((k) => <Skeleton key={k} className="h-14 w-full" />)}</div></section>;
  if (att.query.isError || !att.day) {
    return (
      <section aria-label="Attendance" className={cn("space-y-3", className)}>
        {header}
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm font-semibold text-foreground">Attendance for this day did not load.</p>
          <p className="text-sm text-muted-foreground">Nobody is shown as unmarked or absent until it loads.</p>
          <Button type="button" size="sm" variant="outline" className="h-10 gap-1.5" onClick={() => void att.query.refetch()}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</Button>
        </div>
      </section>
    );
  }
  const s = att.day.summary;
  const weekend = att.day.weekday > 5;

  return (
    <section aria-label="Attendance" className={cn("space-y-3", className)}>
      {header}
      <p className="text-sm text-muted-foreground" role="status">
        <b className="text-foreground">{s.expected}</b> expected · <b className="text-foreground">{s.present}</b> present · <b className="text-foreground">{s.absent}</b> absent · <b className="text-foreground">{s.excused}</b> excused · <b className="text-foreground">{s.unmarked}</b> unmarked
        {s.not_scheduled ? ` · ${s.not_scheduled} not scheduled` : ""}{s.schedule_not_set ? ` · ${s.schedule_not_set} with no schedule set` : ""}.
        {weekend ? " Weekend: nobody with a schedule is expected." : ""}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email" aria-label="Search attendance" className="h-10 pl-9" />
        </div>
        <select aria-label="Stage filter" value={stage} onChange={(e) => setStage(e.target.value as AttendanceStageFilter)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">
          <option value="all">All stages</option><option value="online_training">Online training</option><option value="training">Training</option><option value="released_in_field">Released in field</option><option value="unset">Stage not set</option>
        </select>
        <label className="inline-flex min-h-[40px] items-center gap-2 text-sm text-foreground"><input type="checkbox" className="h-4 w-4" checked={onlyExpected} onChange={(e) => setOnlyExpected(e.target.checked)} /> Expected only</label>
        {att.canEdit ? (
          <Button type="button" variant={selecting ? "secondary" : "outline"} size="sm" className="h-10" aria-pressed={selecting} onClick={() => { setSelecting((v) => !v); setSelected(new Set()); }}>
            {selecting ? "Cancel selection" : "Select several"}
          </Button>
        ) : null}
      </div>
      {!att.canEdit ? <p className="text-xs text-muted-foreground">View only. Admins and managers take attendance.</p> : null}

      {selecting && att.canEdit ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3" aria-label="Bulk mark">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-foreground">{selected.size} selected.</span>
            <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setSelected(new Set(people.filter((p) => p.expected === "yes" && p.status === "unmarked").map((p) => p.agent_id)))}>Select the unmarked expected people shown</Button>
            <select aria-label="Mark selected as" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as Exclude<MarkStatus, "unmarked">)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              {MARKS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <p className="text-xs text-muted-foreground" role="status">
            Preview: {preview.willChange.length} will be marked {statusLabel(bulkStatus)}; {preview.alreadyMarked.length} already marked and left alone{preview.notExpected.length ? `; ${preview.notExpected.length} not expected today (an extra day)` : ""}.
          </p>
          <Button type="button" size="sm" className="h-10" disabled={preview.willChange.length === 0 || att.isPending("bulk")}
            onClick={() => void att.bulk(preview.willChange.map((p) => p.agent_id), bulkStatus).then((r) => { if (r.ok) { setSelected(new Set()); setSelecting(false); } })}>
            Mark {preview.willChange.length} as {statusLabel(bulkStatus)}
          </Button>
        </div>
      ) : null}

      <ul aria-label="People for this day" className="list-none divide-y divide-border rounded-lg border border-border bg-card">
        {people.length === 0 ? <li className="p-6 text-center text-sm text-muted-foreground" role="status">{att.day.people.length === 0 ? "Nobody on the team had started by this day." : "Nobody matches these filters."}</li> : null}
        {people.map((p) => {
          const saving = att.isPending(p.agent_id);
          return (
            <li key={p.agent_id} className={cn("grid gap-x-4 gap-y-2 px-3 py-3 md:grid-cols-[auto_minmax(0,1.6fr)_minmax(8rem,0.8fr)_auto] md:items-center", p.expected !== "yes" && "bg-muted/20")}>
              {selecting && att.canEdit ? (
                <input type="checkbox" className="h-5 w-5" aria-label={`Select ${p.display_name}`} checked={selected.has(p.agent_id)} onChange={(e) => setSelected((s0) => { const n = new Set(s0); if (e.target.checked) n.add(p.agent_id); else n.delete(p.agent_id); return n; })} />
              ) : <span className="hidden md:block" />}
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-foreground">{p.display_name}</p>
                  <StageBadge stage={p.stage} />
                </div>
                <p className="text-xs text-muted-foreground">{expectedLabel(p.expected)}{p.marked_by_name && p.status !== "unmarked" ? ` · ${statusLabel(p.status)} by ${p.marked_by_name}` : ""}{p.note ? ` · ${p.note}` : ""}</p>
              </div>
              <div className="text-sm"><span className="block text-xs text-muted-foreground md:hidden">Status</span><span className={cn(p.status === "unmarked" ? "text-muted-foreground" : "font-medium text-foreground")}>{statusLabel(p.status)}</span></div>
              <div className="flex flex-wrap gap-1" role="group" aria-label={`Mark ${p.display_name}`}>
                {MARKS.map((m) => {
                  const on = p.status === m.key;
                  return (
                    <button key={m.key} type="button" aria-pressed={on} aria-busy={saving} disabled={!att.canEdit || saving}
                      aria-label={`${m.label} for ${p.display_name}${on ? " (current)" : ""}`}
                      onClick={() => void att.mark(p.agent_id, on ? "unmarked" : m.key)}
                      className={cn("inline-flex min-h-[40px] min-w-[44px] items-center justify-center rounded-md border px-3 text-sm font-medium focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] disabled:cursor-default",
                        on ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/60" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
