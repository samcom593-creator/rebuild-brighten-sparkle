// The numbers tab: everything that is a number or a diagnosis and does not change the next tap.
// Nine funnel rows for the same fixed 30 days with the prior 30 days as text (no arrows, 'too few
// to compare' under 10), what's working, and health in plain words with honest labels.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Link2, MessageCircle, RefreshCw } from "lucide-react";
import { BUTTON, EMPTY, NUMBERS, SECTION } from "./igCopy";
import { fmtInt, pctOf, shortAgo } from "./igFormat";
import { stepRate } from "./IgFunnelStrip";
import type { IgDashboard, IgStage } from "./igTypes";

export interface IgNumbersTabProps {
  d: IgDashboard;
  onOpenStage: (stage: IgStage) => void;
  reconnectHref: string;
  onHowToFix: () => void;
  now: number;
}

export function priorLine(stage: IgStage): string {
  const base = NUMBERS.prior30d(fmtInt(stage.prior_count));
  return stage.count < 10 || stage.prior_count < 10 ? `${base} · ${NUMBERS.tooFew}` : base;
}

function splitLine(stage: IgStage): string | null {
  const s = stage.split;
  if (!s) return null;
  if (stage.key === "applied") return NUMBERS.byLinkByHandle(s.by_link ?? 0, s.by_handle ?? 0);
  if (stage.key === "showed") return NUMBERS.noShowNotMarked(s.no_show ?? 0, s.not_marked ?? 0);
  if (stage.key === "recovered") return NUMBERS.recoveredOf(s.recovered ?? 0, s.emailed ?? 0);
  return null;
}

function HealthLine({ icon, ok, text, action }: { icon: React.ReactNode; ok: boolean | null; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="sr-only">{ok === null ? "unknown" : ok ? "ok" : "broken"}: </span>
        {text}
      </span>
      {action}
    </div>
  );
}

export function IgNumbersTab({ d, onOpenStage, reconnectHref, onHowToFix, now }: IgNumbersTabProps) {
  const { funnel, working, health, status } = d;
  const reels = working.reels.slice(0, 3);
  const top = working.top_views;
  const cta = reels[0];
  const showReelFooter = cta && top && cta.external_id !== top.external_id;
  const tokenOk = status.token_ok;
  const linksProven = !!status.links_proven_at && (!status.last_link_refusal_at || new Date(status.links_proven_at) > new Date(status.last_link_refusal_at));
  const engineOk = status.nudge_cron_last_status === "succeeded" && !!status.nudge_cron_last_at && now - new Date(status.nudge_cron_last_at).getTime() < 30 * 60_000;

  return (
    <div className="space-y-6">
      <section aria-labelledby="ig-numbers-funnel" className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="ig-numbers-funnel" className="text-sm font-semibold tracking-tight">{SECTION.funnel}</h2>
          <span className="text-xs text-muted-foreground">{SECTION.receiptGraded}</span>
        </div>
        <div>
          {funnel.stages.map((stage) => {
            const rate = stepRate(stage, funnel.stages);
            const split = splitLine(stage);
            return (
              <Button
                key={stage.key}
                variant="ghost"
                className="flex h-auto w-full items-start justify-between gap-3 rounded-none border-b border-border px-1 py-3 text-left"
                aria-label={`${stage.label} ${stage.count}`}
                onClick={() => onOpenStage(stage)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{stage.label}</span>
                  <span className="text-xs text-muted-foreground">{stage.key === "licensed" ? NUMBERS.selfReported : stage.caption}</span>
                  {split ? <span className="text-xs text-muted-foreground">{split}</span> : null}
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-base font-semibold tabular-nums">{fmtInt(stage.count)}</span>
                  {rate ? <span className="text-xs text-muted-foreground">{NUMBERS.ofPrev(rate)}</span> : null}
                  <span className="text-xs text-muted-foreground">{priorLine(stage)}</span>
                </span>
              </Button>
            );
          })}
        </div>
        {funnel.locked_in_gap > 0 && <p className="pt-2 text-xs text-muted-foreground">{NUMBERS.lockedInGap(funnel.locked_in_gap)}</p>}
      </section>

      <section aria-labelledby="ig-numbers-working" className="space-y-3">
        <h2 id="ig-numbers-working" className="text-sm font-semibold tracking-tight">{SECTION.whatsWorking}</h2>
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">{SECTION.reels}</h3>
          {reels.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{EMPTY.noReels}</p>
          ) : (
            reels.map((r, i) => (
              <div key={r.external_id} className="flex items-start gap-3 border-b border-border py-2 text-sm">
                <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="line-clamp-1 font-medium hover:underline" aria-label={r.title || NUMBERS.noCaption}>
                      {r.title || NUMBERS.noCaption}
                    </a>
                  ) : (
                    <span className="line-clamp-1 font-medium">{r.title || NUMBERS.noCaption}</span>
                  )}
                  <div className="text-xs text-muted-foreground">{NUMBERS.reelRow(r.people_in, r.want_in, pctOf(r.want_in, r.people_in))}</div>
                  <div className="text-xs text-muted-foreground">{NUMBERS.views(fmtInt(r.views))}</div>
                </div>
              </div>
            ))
          )}
          {showReelFooter && cta && top ? (
            <p className="pt-2 text-xs text-muted-foreground">
              {NUMBERS.reelFooter(cta.title || NUMBERS.noCaption, cta.want_in, cta.people_in, top.title || NUMBERS.noCaption, top.want_in, top.people_in)}
            </p>
          ) : null}
        </div>
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">{SECTION.lines}</h3>
          {working.lines.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{EMPTY.notEnoughSends}</p>
          ) : (
            working.lines.slice(0, 3).map((l) => (
              <div key={l.line} className="flex items-start gap-2 border-b border-border py-2 text-sm">
                <Badge variant="outline" className="tabular-nums">{l.reply_rate}%</Badge>
                <span className="line-clamp-1 min-w-0 flex-1 text-muted-foreground">{l.line}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{l.replies}/{l.sends}</span>
              </div>
            ))
          )}
          {working.sam_short_pct != null && working.bot_long_pct != null ? (
            <p className="pt-2 text-xs text-muted-foreground">{NUMBERS.linesFooter(`${working.sam_short_pct}%`, `${working.bot_long_pct}%`)}</p>
          ) : null}
        </div>
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">{SECTION.whoComes}</h3>
          <div className="flex flex-wrap gap-2 pt-2">
            {working.intents.map((i) => (
              <Badge key={i.intent} variant="secondary" className="tabular-nums">{i.intent.replace(/_/g, " ")} {i.people}</Badge>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="ig-numbers-health" className="space-y-1">
        <h2 id="ig-numbers-health" className="text-sm font-semibold tracking-tight">{SECTION.health}</h2>
        <HealthLine
          icon={tokenOk === false ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          ok={tokenOk}
          text={tokenOk === false ? NUMBERS.health.tokenDead(shortAgo(status.token_checked_at, now)) : tokenOk ? NUMBERS.health.tokenAlive(shortAgo(status.token_checked_at, now)) : NUMBERS.health.tokenUnknown}
          action={tokenOk === false ? (
            <Button asChild variant="outline" className="h-9"><a href={reconnectHref} target="_blank" rel="noopener noreferrer">{BUTTON.reconnect}</a></Button>
          ) : undefined}
        />
        <HealthLine
          icon={<Link2 className="h-4 w-4" />}
          ok={status.links_blocked ? false : linksProven ? true : null}
          text={status.links_blocked ? NUMBERS.health.linksBlocked(shortAgo(status.links_blocked_at, now)) : linksProven ? NUMBERS.health.linksAllowed(shortAgo(status.links_proven_at, now)) : NUMBERS.health.linksUnproven(shortAgo(status.last_link_refusal_at, now))}
          action={status.links_blocked ? <Button variant="outline" className="h-9" onClick={onHowToFix}>{BUTTON.howToFix}</Button> : undefined}
        />
        <HealthLine icon={<MessageCircle className="h-4 w-4" />} ok={null} text={NUMBERS.health.botReplies(fmtInt(health.bot_handed), fmtInt(health.bot_receipts))} />
        <HealthLine icon={<MessageCircle className="h-4 w-4" />} ok={true} text={NUMBERS.health.yourReplies(fmtInt(health.you_delivered), fmtInt(health.you_got_reply))} />
        <HealthLine icon={<MessageCircle className="h-4 w-4" />} ok={null} text={NUMBERS.health.replied24h(pctOf(health.replied_24h_n, health.replied_24h_of), fmtInt(health.replied_24h_n), fmtInt(health.replied_24h_of))} />
        <HealthLine
          icon={engineOk ? <RefreshCw className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          ok={engineOk}
          text={engineOk ? NUMBERS.health.engine(shortAgo(health.followup_last_run_at, now), fmtInt(health.followups_sent_30d)) : NUMBERS.health.engineFailed(shortAgo(health.followup_last_run_at, now), health.followup_last_status ?? "never ran")}
        />
        <p className="pl-6 text-xs text-muted-foreground">{NUMBERS.health.engineNote}</p>
        <HealthLine icon={<AlertTriangle className="h-4 w-4" />} ok={null} text={NUMBERS.health.commentRefused(fmtInt(health.comment_refused_7d))} />

        {(health.nudged.length > 0 || health.recovery.length > 0) && (
          <div className="pt-2">
            <h3 className="text-xs font-medium text-muted-foreground">{SECTION.followupsSent}</h3>
            {health.nudged.map((n) => (
              <div key={`${n.external_id}-${n.at}`} className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-sm">
                <span className="font-medium">{n.handle ?? n.external_id}</span>
                <span className="line-clamp-1 min-w-0 flex-1 text-muted-foreground">{n.body}</span>
                <span className="text-xs text-muted-foreground">
                  {n.replied ? NUMBERS.health.nudgeReplied : n.refused ? NUMBERS.health.nudgeRefused : n.delivered ? NUMBERS.health.nudgeLanded : NUMBERS.health.botReplies("1", "0")}
                  {" · "}{shortAgo(n.at, now)}
                </span>
              </div>
            ))}
            {health.recovery.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-sm">
                <span className="font-medium">{r.first_name ?? r.email}</span>
                <span className="text-xs text-muted-foreground">{r.email}</span>
                <span className="ml-auto text-xs text-muted-foreground">{r.recovered ? NUMBERS.health.recoveryFinished : NUMBERS.health.recoveryEmailed} · {shortAgo(r.sent_at, now)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
