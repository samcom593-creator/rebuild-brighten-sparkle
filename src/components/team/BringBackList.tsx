// My Team > Bring back (MP-TEAM-BRING-BACK, 2026-11-27). Sam: "make sure all the agents are there and the ones that
// I can bring back with contracts and all."
//
// The roster list drops anyone hidden, deactivated or excluded, so the people worth a bring-back call were on no
// screen: 26 hidden or inactive people who were never let go (12 holding a contract or with sales), 41 people who
// hold Sam's Ethos contract and have no account here, and 36 people let go who still hold a contract. This view
// lists them in groups (src/lib/bringBack.ts), with Call, Text, Links and, for the hidden ones, Back on the roster:
// the exact inverse of Hide from roster. People Sam let go stay behind a toggle (2026-11-24: "if I fired them,
// remove them"). Nothing here guesses: a failed read says so, and "No state on file" is its own filter value.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Phone, RefreshCw, Search, ShieldAlert, Undo2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { useFirstStepLinks } from "@/hooks/useFirstStepLinks";
import { BRING_BACK_KEY, useBringBack } from "@/hooks/useBringBack";
import {
  BRING_BACK_GROUPS, STANDING_WORDS, bringBackCounts, bringBackRows, bringBackStateOptions, carriersLine, ethosLine, lastCallLine,
  parseBringBackFilters, quietLine, soldLine, type BringBackPerson,
} from "@/lib/bringBack";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { TONE_CLASS } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SendLinksMenu } from "@/components/team/TeamList";

/** Radix Select refuses an empty item value, so "no state on file" travels as this and is written to the URL as "none". */
const NO_STATE_VALUE = "none";

const chipClass = (active: boolean) => cn(
  "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
  active ? "border-primary bg-primary/15 font-semibold text-foreground" : "border-border bg-card text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted",
);

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "Unknown error";
}

export function BringBackList({ onRestored }: { onRestored?: () => void }) {
  const { isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;
  const qc = useQueryClient();
  const todayKey = useBusinessToday();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => {
    const f = parseBringBackFilters((key) => params.get(key));
    // "none" in the URL means the people with no state on file; the lib keeps "" for that so the Select can show it.
    return params.get("state") === NO_STATE_VALUE ? { ...f, state: "" } : f;
  }, [params]);
  const query = useBringBack(true);
  const firstStepLinks = useFirstStepLinks();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const people = useMemo(() => query.data ?? [], [query.data]);
  const counts = useMemo(() => bringBackCounts(people, filters), [people, filters]);
  const stateOptions = useMemo(() => bringBackStateOptions(people, filters.includeLetGo), [people, filters.includeLetGo]);
  const letGo = useMemo(() => people.filter((p) => p.fired).length, [people]);
  const shownTotal = Object.values(counts).reduce((s, n) => s + n, 0);
  const hasFilters = Boolean(filters.state !== null || filters.search.trim() || filters.includeLetGo);

  const setParam = (key: string, value: string | null) => {
    setParams((prev) => { const next = new URLSearchParams(prev); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  };
  const clearFilters = () => {
    setParams((prev) => { const next = new URLSearchParams(prev); next.delete("state"); next.delete("q"); next.delete("letgo"); return next; }, { replace: true });
  };

  /**
   * Back on the roster: the exact inverse of Hide from roster (agents.is_inactive = true), nothing else. Success is
   * read back from the row, never assumed from the update's round-trip.
   */
  const restore = async (p: BringBackPerson) => {
    if (!p.agent_id || restoringId) return;
    setRestoringId(p.person_key);
    try {
      const { error } = await supabase.from("agents").update({ is_inactive: false }).eq("id", p.agent_id);
      if (error) { toast.error(`${p.full_name} is not back yet: ${error.message}`); return; }
      const { data: after, error: readError } = await supabase.from("agents").select("is_inactive").eq("id", p.agent_id).maybeSingle();
      if (readError || !after) { toast.message(`The change was sent but ${p.full_name}'s row could not be read back${readError ? `: ${readError.message}` : ""}.`); return; }
      if (after.is_inactive) { toast.error(`${p.full_name} is still hidden. The change did not land.`); return; }
      toast.success(`${p.full_name} is back on the roster${p.standing === "inactive" ? ", under Not active until their status is set" : ""}.`);
      void qc.invalidateQueries({ queryKey: BRING_BACK_KEY });
      void qc.invalidateQueries({ queryKey: ["crm-agent-roster"] });
      void qc.invalidateQueries({ queryKey: ["crm-agent-profile-facts"] });
      onRestored?.();
    } finally {
      setRestoringId(null);
    }
  };

  const groups = BRING_BACK_GROUPS.filter((g) => g.key !== "let_go" || filters.includeLetGo);

  return (
    <section className="space-y-4" aria-label="Bring back">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">People off the roster who are worth a call</h2>
        <p className="text-sm text-muted-foreground">
          Everyone My Team does not list who still holds a contract, wrote business, is licensed, or holds your Ethos contract with no account here.
          {letGo > 0 ? ` ${letGo} ${letGo === 1 ? "person you let go still holds" : "people you let go still hold"} a contract or wrote business; they stay off until you ask for them.` : ""}
        </p>
      </div>

      {query.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading the bring-back list">
          {Array.from({ length: 5 }, (_, n) => <Skeleton key={`bb-sk-${n}`} className="h-[88px] w-full rounded-xl" />)}
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={<ShieldAlert />}
          variant="warning"
          title="The bring-back list did not load"
          description={`Nobody is shown in its place. ${errorText(query.error)}`}
          actions={<Button type="button" variant="outline" className="h-11" onClick={() => { void query.refetch(); }}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</Button>}
        />
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter the bring-back list">
              <div className="relative min-w-0 flex-1 basis-60">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input type="search" value={filters.search} onChange={(e) => setParam("q", e.target.value || null)} placeholder="Name, phone, email or upline" aria-label="Search the bring-back list" className="h-11 bg-card pl-9 text-base" />
              </div>
              <Select value={filters.state === null ? "all" : filters.state === "" ? NO_STATE_VALUE : filters.state} onValueChange={(v) => setParam("state", v === "all" ? null : v)}>
                <SelectTrigger className="h-11 w-full bg-card text-[15px] sm:w-60" aria-label="Filter by state"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="min-h-11 text-[15px]">Every state</SelectItem>
                  {stateOptions.map((s) => (
                    <SelectItem key={s.code || NO_STATE_VALUE} value={s.code || NO_STATE_VALUE} className="min-h-11 text-[15px]">
                      {s.name} <span className="tabular-nums text-muted-foreground">({s.count})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button type="button" aria-pressed={filters.includeLetGo} className={chipClass(filters.includeLetGo)} onClick={() => setParam("letgo", filters.includeLetGo ? null : "1")} title="People deactivated, terminated, banned or suspended who still hold a contract or wrote business">
                Show people I let go <span className="tabular-nums text-muted-foreground">{letGo}</span>
              </button>
              {hasFilters ? (
                <Button type="button" variant="ghost" className="h-11 px-3 text-muted-foreground" onClick={clearFilters}><X className="h-4 w-4" aria-hidden /> Clear</Button>
              ) : null}
            </div>
            <p className="text-[15px] leading-6 text-muted-foreground" data-testid="bring-back-caption">
              <span className="font-semibold text-foreground">
                {`${shownTotal} ${shownTotal === 1 ? "person" : "people"}${filters.state ? ` in ${stateOptions.find((s) => s.code === filters.state)?.name ?? filters.state}` : filters.state === "" ? " with no state on file" : ""}`}
              </span>
              {" · "}contract holders first, then the most recently active.
            </p>
          </div>

          {shownTotal === 0 ? (
            <EmptyState
              icon={<Users />}
              title={hasFilters ? "Nobody matches these filters" : "Nobody to bring back"}
              description={hasFilters ? "Clear the filters to see everyone off the roster who is worth a call." : "Everyone with a contract, sales or a license is already on the roster."}
              actions={hasFilters ? <Button type="button" variant="outline" className="h-11" onClick={clearFilters}>Clear filters</Button> : undefined}
            />
          ) : groups.map((group) => {
            const rows = bringBackRows(people, group.key, filters, todayKey);
            if (rows.length === 0) return null;
            return (
              <div key={group.key} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-[15px] font-semibold text-foreground">{group.label} <span className="tabular-nums text-muted-foreground">{rows.length}</span></h3>
                  <p className="text-[13px] text-muted-foreground">{group.means}</p>
                </div>
                <ul aria-label={group.label} className="space-y-2">
                  {rows.map((p) => (
                    <PersonRow key={p.person_key} p={p} todayKey={todayKey} canManage={canManage} restoring={restoringId === p.person_key} onRestore={() => { void restore(p); }} links={firstStepLinks.data} linksFailed={firstStepLinks.isError} />
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

function PersonRow({ p, todayKey, canManage, restoring, onRestore, links, linksFailed }: {
  p: BringBackPerson;
  todayKey: string;
  canManage: boolean;
  restoring: boolean;
  onRestore: () => void;
  links: ReturnType<typeof useFirstStepLinks>["data"];
  linksFailed: boolean;
}) {
  const call = phoneHref(p.phone);
  const text = call ? smsHref(p.phone) : null;
  const phone = formatPhoneDisplay(p.phone);
  const facts = [ethosLine(p), carriersLine(p), soldLine(p, todayKey), quietLine(p, todayKey), lastCallLine(p)].filter((x): x is string => Boolean(x));
  const details = [
    p.home_state ? p.home_state : "No state on file",
    p.manager_name ? `Under ${p.manager_name}` : null,
    p.comp_level ? `Comp ${p.comp_level}` : null,
    p.license === "licensed" ? "Licensed" : p.license ? `License: ${p.license.replace(/_/g, " ")}` : null,
    p.instagram ? `@${p.instagram}` : null,
    p.email,
    phone,
  ].filter((x): x is string => Boolean(x));
  const standingTone = p.standing === "let_go" ? "text-muted-foreground" : p.standing === "no_account" ? TONE_CLASS.cool.text : TONE_CLASS.warm.text;
  return (
    <li className="rounded-xl border border-border bg-card px-3 py-3 sm:px-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-x-2 text-base font-semibold leading-6 text-foreground">
            {p.full_name}
            <span className={cn("text-[12px] font-semibold uppercase tracking-wide", standingTone)}>{STANDING_WORDS[p.standing]}{p.let_go_reason ? ` (${p.let_go_reason.replace(/_/g, " ")})` : ""}</span>
          </p>
          <p className="text-sm leading-5 text-foreground/90">
            {facts.map((f, i) => (
              <span key={f}>{i > 0 ? <span aria-hidden="true" className="text-muted-foreground"> · </span> : null}<span className={i === 0 && p.ethos_back ? cn("font-medium", TONE_CLASS.good.text) : undefined}>{f}</span></span>
            ))}
          </p>
          <p className="text-[13px] leading-5 text-muted-foreground">{details.join(" · ")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {call ? (
            <Button asChild variant="outline" className="h-11 px-3">
              <a href={call} {...contactLinkProps(call)} aria-label={`Call ${p.full_name}`}><Phone className="h-4 w-4" aria-hidden /> Call</a>
            </Button>
          ) : <span className="text-sm text-muted-foreground">No phone on file</span>}
          {text ? (
            <Button asChild variant="outline" className="h-11 px-3">
              <a href={text} {...contactLinkProps(text)} aria-label={`Text ${p.full_name}`}><MessageSquare className="h-4 w-4" aria-hidden /> Text</a>
            </Button>
          ) : null}
          <SendLinksMenu
            row={{ agent_id: p.agent_id ?? p.person_key, full_name: p.full_name, phone: p.phone, email: p.email, license_status: p.license }}
            name={p.full_name}
            links={links}
            linksFailed={linksFailed}
            profile={{ instagram: p.instagram }}
            compact
          />
          {canManage && p.can_restore ? (
            <Button type="button" variant="outline" className="h-11 px-3" disabled={restoring} aria-label={`Put ${p.full_name} back on the roster`} title="The inverse of Hide from roster" onClick={onRestore}>
              <Undo2 className="h-4 w-4" aria-hidden /> {restoring ? "Saving" : "Back on the roster"}
            </Button>
          ) : null}
          {canManage && p.standing === "no_account" ? (
            <Button asChild variant="ghost" className="h-11 px-3">
              <Link to="/admin/invite-links" aria-label={`Invite ${p.full_name}`} title="Make them an invite link so they get an account here"><UserPlus className="h-4 w-4" aria-hidden /> Invite</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
