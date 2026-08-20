import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio, AlertTriangle, Send, ArrowRight, Activity, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CwSmbBridgePayload } from "./useDashboardPayload";

interface Props {
  smb: CwSmbBridgePayload | null;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "$—";
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Bridge card on the ContentWheel Dashboard.
 *
 * ContentWheel is the BRAIN (doctrine, the wheel, demand sources, hooks,
 * split tests, outliers, recruiting funnel). The Social Media Bot is the
 * DOER (today's draft queue, daemon health, vidIQ analytics, inbound DMs,
 * blockers). This card surfaces "what the bot is doing right now" so the
 * strategist screen never loses sight of the tactical hopper.
 *
 * Backing view: v_cw_smb_bridge. When a SMB draft flips to status='shipped',
 * a DB trigger auto-creates a cw_posts row — so KPIs on this dashboard
 * always reflect what actually went live, regardless of who hit Publish.
 */
export function SmbBridgeCard({ smb }: Props) {
  if (!smb) {
    return null;
  }
  const t = smb.today;
  const b = smb.blockers;
  const a = smb.last_analytics;
  const i = smb.inbound_7d;
  const run = smb.last_run;
  const runMinutesAgo = run?.started_at
    ? Math.max(0, Math.round((Date.now() - new Date(run.started_at).getTime()) / 60000))
    : null;

  const blockerTone = (b?.hot_blockers ?? 0) > 0 ? "alert" : (b?.open_blockers ?? 0) > 0 ? "warn" : "ok";

  return (
    <Card className="p-5 border border-primary/20 bg-white dark:bg-card">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 border border-primary/20 shrink-0">
            <Radio className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">Social Media Bot · tactical hopper</h3>
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              The DOER. Daily drafts, daemon health, analytics, blockers — bot ships, ContentWheel grades.
            </p>
          </div>
        </div>
        <Link
          to="/dashboard/admin/social-media-bot"
          className="text-xs inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary px-2.5 py-1.5 transition-colors shrink-0"
        >
          Open Bot <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <BridgeStat
          icon={Send}
          label="Drafts today"
          value={`${t?.shipped_today ?? 0} / ${t?.drafts_today ?? 0}`}
          sub={`${t?.pending_today ?? 0} pending · ${t?.approved_today ?? 0} approved`}
          tone={(t?.shipped_today ?? 0) > 0 ? "ok" : "neutral"}
        />
        <BridgeStat
          icon={AlertTriangle}
          label="Open blockers"
          value={`${b?.open_blockers ?? 0}`}
          sub={`${b?.hot_blockers ?? 0} hot · ${fmtUsd(b?.open_dollar_impact)} impact`}
          tone={blockerTone}
        />
        <BridgeStat
          icon={Activity}
          label={a?.platform ? `${a.platform.toUpperCase()} reach` : "Analytics"}
          value={fmt(a?.subscribers)}
          sub={a
            ? `${a.channel_handle ?? "—"} · +${a.subscribers_gained ?? 0} · ${a.avg_view_pct ?? "—"}% retention`
            : "no snapshot yet"}
          tone="neutral"
        />
        <BridgeStat
          icon={Users}
          label="Inbound (7d)"
          value={`${i?.inbound_count ?? 0}`}
          sub={`${fmtUsd(i?.inbound_paid_usd)} paid · DMs converting`}
          tone={(i?.inbound_paid_usd ?? 0) > 0 ? "ok" : "neutral"}
        />
      </div>

      {run && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {run.mode ?? "run"}
          </Badge>
          <span>
            last fire {runMinutesAgo === null ? "—" : runMinutesAgo < 60 ? `${runMinutesAgo}m ago` : `${Math.round(runMinutesAgo / 60)}h ago`}
            {" · "}status {run.status} · {run.entries ?? 0} entries
          </span>
        </div>
      )}
      {a && (a.days_since_upload ?? 0) >= 7 && (
        <div className="mt-3 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-300 leading-snug">
          {a.days_since_upload} days since last upload to {a.platform}. The wheel stops turning when the doer goes quiet.
        </div>
      )}
    </Card>
  );
}

interface StatProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "alert" | "neutral";
}

function BridgeStat({ icon: Icon, label, value, sub, tone }: StatProps) {
  const ring: Record<StatProps["tone"], string> = {
    ok:      "border-emerald-500/25",
    warn:    "border-amber-500/30",
    alert:   "border-rose-500/40",
    neutral: "border-border",
  };
  const accent: Record<StatProps["tone"], string> = {
    ok:      "text-emerald-300",
    warn:    "text-amber-300",
    alert:   "text-rose-300",
    neutral: "text-foreground",
  };
  return (
    <div className={cn("rounded-lg border bg-card/40 p-3", ring[tone])}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={cn("mt-1.5 text-xl font-bold tabular-nums leading-none", accent[tone])}>{value}</div>
      <p className="mt-1.5 text-[10px] text-muted-foreground leading-snug">{sub}</p>
    </div>
  );
}
