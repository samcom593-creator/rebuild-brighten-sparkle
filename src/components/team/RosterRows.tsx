import { Link } from "react-router-dom";
import { Flame, Link2, Mail, Phone } from "lucide-react";
import { AgentAvatar, getAvatarUrl } from "@/components/ui/AgentAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { contactLinkProps, phoneHref } from "@/lib/phone";
import { formatTimeAgo } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { daysSince, isSyncOnly, usdOrNull, type RosterRow } from "@/lib/teamRoster";
import { OnboardingProgress } from "@/components/team/OnboardingProgress";

/**
 * The production roster: one row per person with the money columns, opening the detail drawer. Contracting has its own
 * view (the contracting review); this list carries no contracting status.
 *
 * Layout: at xl and wider a row is one line of aligned columns; below that each row stacks into a card, so a phone
 * never scrolls sideways. Rows are plain div roles (table / row / cell), and the column header row exists only where
 * the columns do.
 */

const PROD_GRID = "xl:grid-cols-[minmax(230px,1.7fr)_130px_120px_100px_90px_110px_120px_84px]";

const ROW = "grid grid-cols-1 gap-x-4 gap-y-2 border-b border-border/60 px-2 py-3 md:grid-cols-2 xl:items-start";

function CellLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-0.5 block text-xs font-semibold text-muted-foreground xl:hidden">{children}</span>;
}

function PersonCell({ r, selected, onOpen, compact = false }: { r: RosterRow; selected: boolean; onOpen: (id: string) => void; /** Production rows leave the Call and Email line to the detail drawer. */ compact?: boolean }) {
  const sync = isSyncOnly(r);
  const inactive = r.status !== "active";
  return (
    <div role="cell" className="flex min-w-0 items-start gap-2">
      <AgentAvatar avatarUrl={getAvatarUrl(r.avatar_url ?? undefined)} name={r.full_name ?? "—"} size="sm" className="mt-0.5 shrink-0 ring-2 ring-background" />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Link to={`/dashboard/profile?agentId=${r.agent_id}`}
            className={cn("min-w-0 truncate text-sm font-semibold underline-offset-2 decoration-dotted hover:text-primary hover:underline", selected ? "text-primary" : "text-foreground")}>
            {r.full_name ?? "Name not on file"}
          </Link>
          {isSyncOnly(r) && (
            <Badge variant="outline" className="h-5 shrink-0 gap-1 border-amber-500/50 bg-amber-500/10 px-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
              title="Placeholder seat, not a person. Minted by the Discord deal ingest to hold production it could not match to an agent. No login, no onboarding path, nothing to chase.">
              <Link2 className="h-3 w-3" aria-hidden /> Sync only
            </Badge>
          )}
          {r.free_leads_qualified ? (
            <Badge variant="outline" className="h-5 shrink-0 border-sky-500/50 bg-sky-500/10 px-1.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300" title={r.free_leads_reason ?? "Free Leads active"}>Free leads</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {r.license_status === "licensed" ? "Licensed" : r.license_status ? "Not licensed" : "License unknown"}
          {" · "}
          <span className={cn(inactive && "font-semibold text-foreground")}>{r.status ?? "unknown"}</span>
          {r.agent_code ? <span className="tabular-nums"> · {r.agent_code}</span> : null}
        </p>
        {sync || compact ? null : (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
            {r.phone ? (
              <a href={phoneHref(r.phone) ?? `tel:${r.phone}`} {...contactLinkProps(phoneHref(r.phone))} aria-label={`Call ${r.full_name ?? "this person"}`}
                className="inline-flex min-h-[36px] items-center gap-1 text-sm font-medium text-foreground hover:text-primary hover:underline">
                <Phone className="h-3.5 w-3.5" aria-hidden /> Call
              </a>
            ) : <span className="inline-flex min-h-[36px] items-center text-xs italic text-muted-foreground">No phone on file</span>}
            {r.email ? (
              <a href={`mailto:${r.email}`} aria-label={`Email ${r.full_name ?? "this person"}`}
                className="inline-flex min-h-[36px] items-center gap-1 text-sm text-muted-foreground hover:text-primary hover:underline">
                <Mail className="h-3.5 w-3.5" aria-hidden /> Email
              </a>
            ) : null}
          </div>
        )}
        {/* Below xl the Details button sits under the person; at xl it is its own column (DetailsCell). */}
        <Button type="button" variant={selected ? "secondary" : "outline"} size="sm" className="mt-2 h-10 xl:hidden" aria-haspopup="dialog" aria-expanded={selected}
          onClick={() => onOpen(r.agent_id)} aria-label={`Open details for ${r.full_name ?? "this person"}`}>
          Details
        </Button>
      </div>
    </div>
  );
}

function DetailsCell({ r, onOpen, selected }: { r: RosterRow; onOpen: (id: string) => void; selected: boolean }) {
  return (
    <div role="cell" className="hidden xl:block xl:justify-self-end">
      <Button type="button" variant={selected ? "secondary" : "outline"} size="sm" className="h-9" aria-haspopup="dialog" aria-expanded={selected}
        onClick={() => onOpen(r.agent_id)} aria-label={`Open details for ${r.full_name ?? "this person"}`}>
        Details
      </Button>
    </div>
  );
}

function sinceSaleText(days: number | null): string {
  if (days === null) return "—";
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : `${Math.max(0, days)} days ago`;
}

export function RosterProductionList({ rows, selectedId, onOpen }: {
  rows: RosterRow[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div role="table" aria-label="Team production roster" className="text-sm">
      <div role="row" className={cn("hidden gap-x-4 border-b border-border px-2 pb-1.5 text-xs font-semibold text-muted-foreground xl:grid", PROD_GRID)}>
        <div role="columnheader">Person</div>
        <div role="columnheader">Onboarding</div>
        <div role="columnheader">Today</div>
        <div role="columnheader" className="text-right">Month ALP</div>
        <div role="columnheader" className="text-right">Last 30d</div>
        <div role="columnheader" className="text-right">Lifetime</div>
        <div role="columnheader">Last sale</div>
        <div role="columnheader"><span className="sr-only">Details</span></div>
      </div>
      <div role="rowgroup">
        {rows.map((r) => {
          const mtd = usdOrNull(r.mtd_alp);
          const l30 = usdOrNull(r.l30_alp);
          const life = usdOrNull(r.lifetime_alp);
          const since = daysSince(r.last_posted_date);
          const selected = selectedId === r.agent_id;
          const sold = (r.today_deals ?? 0) > 0;
          return (
            <div role="row" key={r.agent_id} className={cn(ROW, "xl:grid", PROD_GRID, selected && "bg-muted/40")}>
              <PersonCell r={r} selected={selected} onOpen={onOpen} compact />
              <div role="cell"><CellLabel>Onboarding</CellLabel><OnboardingProgress row={r} /></div>
              <div role="cell">
                <CellLabel>Today</CellLabel>
                {sold ? (
                  <p className="text-sm"><span className="font-semibold text-emerald-700 dark:text-emerald-300">Sold today</span>
                    <span className="block text-xs tabular-nums text-muted-foreground">{usdOrNull(r.today_alp) ?? "$0"} · {r.today_deals} {r.today_deals === 1 ? "deal" : "deals"}</span></p>
                ) : <span className="text-sm text-muted-foreground">No sale today</span>}
                {(r.selling_streak_days ?? 0) > 0 ? (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-300"><Flame className="h-3.5 w-3.5" aria-hidden />{r.selling_streak_days}-day streak</span>
                ) : null}
              </div>
              <div role="cell" className="xl:text-right">
                <CellLabel>Month ALP</CellLabel>
                <span className={cn("font-semibold tabular-nums", mtd ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>{mtd ?? "—"}</span>
                {(r.mtd_deals ?? 0) > 0 ? <span className="ml-1 text-xs tabular-nums text-muted-foreground">×{r.mtd_deals}</span> : null}
              </div>
              <div role="cell" className="xl:text-right"><CellLabel>Last 30d</CellLabel><span className={cn("tabular-nums", l30 ? "text-foreground" : "text-muted-foreground")}>{l30 ?? "—"}</span></div>
              <div role="cell" className="xl:text-right">
                <CellLabel>Lifetime</CellLabel>
                <span className={cn("tabular-nums", life ? "text-foreground" : "text-muted-foreground")}>{life ?? "—"}</span>
                {(r.lifetime_deals ?? 0) > 0 ? <span className="ml-1 text-xs tabular-nums text-muted-foreground">×{r.lifetime_deals}</span> : null}
              </div>
              <div role="cell">
                <CellLabel>Last sale</CellLabel>
                {r.last_posted_date ? (
                  <span className={cn("text-sm font-medium", since !== null && since >= 60 ? "text-red-700 dark:text-red-300" : since !== null && since >= 14 ? "text-amber-700 dark:text-amber-300" : "text-foreground")}>
                    {sinceSaleText(since)}{since !== null && since >= 14 ? <span className="sr-only"> (no recent sale)</span> : null}
                  </span>
                ) : <span className="text-sm text-muted-foreground">Never sold</span>}
              </div>
              <DetailsCell r={r} onOpen={onOpen} selected={selected} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
