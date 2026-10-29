// The Numbers tab (OVERHAUL-instagram, 2026-10-28): the month from a message to a hire, what is
// working, and whether the machine is running, in plain words. Every funnel step opens the people in
// it. A share is printed only where the step is a subset of the one it is measured against (the
// old strip printed "of prev 238%" for applied over booked, two groups that do not nest), and a
// zero denominator prints a dash, never 0%.
import type { ReactNode } from "react";
import {
  AlertTriangle, BadgeCheck, Briefcase, CalendarCheck, CheckCircle2, CircleHelp, ExternalLink, FileCheck, Link2, MailCheck, MessageCircle, Phone, RefreshCw, Trophy, UserCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RevealList } from "@/components/ui/delight/Reveal";
import { TonePill, ToneBubble } from "@/components/ui/delight/ToneBubble";
import type { Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { BUTTON, EMPTY, INTENT_WORD, NUMBERS, SECTION, STAGE_NAME } from "./igCopy";
import { fmtInt, pctOf, shortAgo } from "./igFormat";
import { tileTrend } from "./igScore";
import type { IgDashboard, IgStage, IgStageKey } from "./igTypes";

export interface IgNumbersTabProps {
  d: IgDashboard;
  /** A step was tapped: the page opens its people. */
  onOpenStage: (stage: IgStage) => void;
  reconnectHref: string;
  onHowToFix: () => void;
  now: number;
  /** The biggest-leak card, shown first. */
  lever?: ReactNode;
}

const STAGE_ICON: Record<IgStageKey, LucideIcon> = {
  in: MessageCircle, business: Briefcase, licensed: BadgeCheck, number: Phone, booked: CalendarCheck,
  showed: UserCheck, applied: FileCheck, hired: Trophy, recovered: MailCheck,
};
const STAGE_TONE: Record<IgStageKey, Tone> = {
  in: "royal", business: "warm", licensed: "good", number: "warm", booked: "cool", showed: "good", applied: "good", hired: "gold", recovered: "cool",
};
/** The order a person moves through. Recovered sits apart: it is the abandoned-form email lane. */
const ORDER: IgStageKey[] = ["in", "business", "licensed", "number", "booked", "showed", "applied", "hired", "recovered"];

/** The share line, only where the step nests inside the group it is measured against. */
export function shareLine(stage: IgStage, stages: IgStage[]): string | null {
  const of = (k: IgStageKey) => stages.find((s) => s.key === k)?.count ?? 0;
  switch (stage.key) {
    case "business":
    case "number":
      return NUMBERS.shareOfIn(pctOf(stage.count, of("in")));
    case "showed":
      return NUMBERS.shareOfBooked(pctOf(stage.count, of("booked")));
    default:
      return null;
  }
}

export function splitLine(stage: IgStage): string | null {
  const s = stage.split;
  if (stage.key === "licensed") return NUMBERS.selfReported;
  if (!s) return null;
  if (stage.key === "applied") return NUMBERS.byLinkByHandle(s.by_link ?? 0, s.by_handle ?? 0);
  if (stage.key === "showed") return NUMBERS.noShowNotMarked(s.no_show ?? 0, s.not_marked ?? 0);
  if (stage.key === "recovered") return NUMBERS.recoveredOf(s.recovered ?? 0, s.emailed ?? 0);
  return null;
}

const TREND_WORDS = { up: NUMBERS.upFrom, down: NUMBERS.downFrom, same: NUMBERS.same };

function HealthLine({ icon: Icon, state, text, action }: { icon: LucideIcon; state: boolean | null; text: string; action?: ReactNode }) {
  const tone: Tone = state === null ? "slate" : state ? "good" : "hot";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <ToneBubble tone={tone} size="sm"><Icon /></ToneBubble>
      <span className="min-w-0 flex-1 text-[15px] leading-[22px] text-foreground">{text}</span>
      <TonePill tone={tone} className="shrink-0">{state === null ? NUMBERS.health.unknown : state ? NUMBERS.health.ok : NUMBERS.health.broken}</TonePill>
      {action}
    </li>
  );
}

function InfoLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <ToneBubble tone="slate" size="sm"><Icon /></ToneBubble>
      <span className="min-w-0 flex-1 pt-1 text-[15px] leading-[22px] text-foreground">{text}</span>
    </li>
  );
}

export function IgNumbersTab({ d, onOpenStage, reconnectHref, onHowToFix, now, lever }: IgNumbersTabProps) {
  const { funnel, working, health, status } = d;
  const stages = ORDER.map((k) => funnel.stages.find((s) => s.key === k)).filter((s): s is IgStage => !!s);
  const reels = working.reels.slice(0, 3);
  const top = working.top_views;
  const cta = reels[0];
  const showReelFooter = !!(cta && top && cta.external_id !== top.external_id);
  const tokenOk = status.token_ok;
  // Proven = a link went out with a Meta receipt after the last refusal. No proof on file is "not
  // sure", not "working".
  const proven = !!status.links_proven_at && (!status.last_link_refusal_at || new Date(status.links_proven_at) > new Date(status.last_link_refusal_at));
  const engineOk = status.nudge_cron_last_status === "succeeded" && !!status.nudge_cron_last_at && now - new Date(status.nudge_cron_last_at).getTime() < 30 * 60_000;

  return (
    <div className="space-y-6">
      {lever}

      <section aria-labelledby="ig-numbers-funnel" className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3 sm:px-5">
          <h2 id="ig-numbers-funnel" className="text-xl font-bold text-foreground">{SECTION.funnel}</h2>
          <p className="text-sm text-muted-foreground">{SECTION.funnelHint}</p>
        </header>
        <RevealList as="ol" className="divide-y divide-border">
          {stages.map((stage) => {
            const Icon = STAGE_ICON[stage.key];
            const share = shareLine(stage, funnel.stages);
            const split = splitLine(stage);
            const trend = tileTrend(stage, TREND_WORDS);
            const name = STAGE_NAME[stage.key] ?? stage.label;
            return (
              <li key={stage.key}>
                <button
                  type="button"
                  onClick={() => onOpenStage(stage)}
                  aria-label={`${name}: ${fmtInt(stage.count)}. See the people.`}
                  className="apex-lift flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:px-5"
                >
                  <ToneBubble tone={STAGE_TONE[stage.key]} size="md"><Icon /></ToneBubble>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold leading-6 text-foreground">{name}</span>
                    {share ? <span className="block text-sm text-muted-foreground">{share}</span> : null}
                    {split ? <span className="block text-sm text-muted-foreground">{split}</span> : null}
                    {trend ? <TonePill tone={trend.tone} className="mt-1.5 whitespace-nowrap">{trend.text}</TonePill> : null}
                  </span>
                  <span className="shrink-0 pt-0.5 text-[28px] font-bold leading-none tabular-nums text-foreground">{fmtInt(stage.count)}</span>
                </button>
              </li>
            );
          })}
        </RevealList>
        {funnel.locked_in_gap > 0 ? (
          <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground sm:px-5">{NUMBERS.lockedInGap(funnel.locked_in_gap)}</p>
        ) : null}
        <p className="border-t border-border px-4 py-3 text-[13px] leading-[18px] text-muted-foreground sm:px-5">{NUMBERS.trendNote}</p>
      </section>

      <section aria-labelledby="ig-numbers-working" className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3 sm:px-5">
          <h2 id="ig-numbers-working" className="text-xl font-bold text-foreground">{SECTION.whatsWorking}</h2>
        </header>
        <div className="space-y-5 px-4 py-4 sm:px-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{SECTION.reels}</h3>
            {reels.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{EMPTY.noReels}</p>
            ) : (
              <ol className="mt-2 space-y-2">
                {reels.map((r, i) => {
                  const title = r.title || NUMBERS.noCaption;
                  return (
                    <li key={r.external_id} className="flex items-start gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
                      <span className="w-5 shrink-0 pt-0.5 text-right text-base font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-[15px] font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">
                            <span className="truncate">{title}</span>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          </a>
                        ) : (
                          <span className="block truncate text-[15px] font-semibold text-foreground">{title}</span>
                        )}
                        <p className="text-sm text-muted-foreground">{NUMBERS.reelRow(r.people_in)} · {NUMBERS.views(fmtInt(r.views))}</p>
                        <TonePill tone={r.want_in > 0 ? "good" : "slate"} className="mt-1.5 whitespace-nowrap tabular-nums">{NUMBERS.wantInPct(r.want_in, pctOf(r.want_in, r.people_in))}</TonePill>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {showReelFooter && cta && top ? (
              <p className="pt-2 text-sm text-muted-foreground">
                {NUMBERS.reelFooter(cta.title || NUMBERS.noCaption, cta.want_in, cta.people_in, top.title || NUMBERS.noCaption, top.want_in, top.people_in)}
              </p>
            ) : null}
          </div>

          <div>
            <h3 className="text-base font-semibold text-foreground">{SECTION.lines}</h3>
            {working.lines.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{EMPTY.notEnoughSends}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {working.lines.slice(0, 3).map((l) => (
                  <li key={l.line} className="flex items-start gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
                    <TonePill tone={l.reply_rate >= 50 ? "good" : "slate"} className="mt-0.5 shrink-0 tabular-nums">{l.reply_rate}%</TonePill>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] leading-[22px] text-foreground [overflow-wrap:anywhere]">“{l.line}”</p>
                      <p className="text-sm tabular-nums text-muted-foreground">{NUMBERS.answered(l.replies, l.sends)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {working.sam_short_pct != null && working.bot_long_pct != null ? (
              <p className="pt-2 text-sm text-muted-foreground">{NUMBERS.linesFooter(`${working.sam_short_pct}%`, `${working.bot_long_pct}%`)}</p>
            ) : null}
          </div>

          {working.intents.length > 0 ? (
            <div>
              <h3 className="text-base font-semibold text-foreground">{SECTION.whoComes}</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {working.intents.map((i) => (
                  <li key={i.intent}>
                    <TonePill tone="slate" className="tabular-nums">{INTENT_WORD[i.intent] ?? i.intent.replace(/_/g, " ")} · {fmtInt(i.people)}</TonePill>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      <section id="ig-numbers-health" aria-labelledby="ig-numbers-health-heading" className="scroll-mt-32 rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3 sm:px-5">
          <h2 id="ig-numbers-health-heading" className="text-xl font-bold text-foreground">{SECTION.health}</h2>
        </header>
        <ul className="divide-y divide-border px-4 sm:px-5">
          <HealthLine
            icon={tokenOk === false ? AlertTriangle : CheckCircle2}
            state={tokenOk}
            text={tokenOk === false ? NUMBERS.health.tokenDead(shortAgo(status.token_checked_at, now)) : tokenOk ? NUMBERS.health.tokenAlive(shortAgo(status.token_checked_at, now)) : NUMBERS.health.tokenUnknown}
            action={tokenOk === false ? (
              <Button asChild variant="outline" className="h-11 sm:h-10"><a href={reconnectHref} target="_blank" rel="noopener noreferrer">{BUTTON.reconnect}</a></Button>
            ) : undefined}
          />
          <HealthLine
            icon={Link2}
            state={status.links_blocked ? false : proven ? true : null}
            text={status.links_blocked ? NUMBERS.health.linksBlocked(shortAgo(status.links_blocked_at, now)) : proven ? NUMBERS.health.linksAllowed(shortAgo(status.links_proven_at, now)) : NUMBERS.health.linksUnproven(shortAgo(status.last_link_refusal_at, now))}
            action={status.links_blocked ? <Button variant="outline" className="h-11 sm:h-10" onClick={onHowToFix}>{BUTTON.howToFix}</Button> : undefined}
          />
          <HealthLine
            icon={engineOk ? RefreshCw : AlertTriangle}
            state={engineOk}
            text={engineOk ? NUMBERS.health.engine(shortAgo(health.followup_last_run_at, now), fmtInt(health.followups_sent_30d)) : NUMBERS.health.engineFailed(shortAgo(health.followup_last_run_at, now), health.followup_last_status ?? "never ran")}
          />
          <InfoLine icon={MessageCircle} text={NUMBERS.health.botReplies(fmtInt(health.bot_handed), fmtInt(health.bot_receipts))} />
          <InfoLine icon={MessageCircle} text={NUMBERS.health.yourReplies(fmtInt(health.you_delivered), fmtInt(health.you_got_reply))} />
          <InfoLine icon={CircleHelp} text={NUMBERS.health.replied24h(pctOf(health.replied_24h_n, health.replied_24h_of), fmtInt(health.replied_24h_n), fmtInt(health.replied_24h_of))} />
          <InfoLine icon={AlertTriangle} text={NUMBERS.health.commentRefused(fmtInt(health.comment_refused_7d))} />
        </ul>
        <p className="border-t border-border px-4 py-3 text-[13px] leading-[18px] text-muted-foreground sm:px-5">{NUMBERS.health.engineNote}</p>

        {health.nudged.length > 0 || health.recovery.length > 0 ? (
          <div className="space-y-4 border-t border-border px-4 py-4 sm:px-5">
            {health.nudged.length > 0 ? (
              <div>
                <h3 className="text-base font-semibold text-foreground">{SECTION.followupsSent}</h3>
                <ul className="mt-1 divide-y divide-border">
                  {health.nudged.map((n) => {
                    const word = n.replied ? NUMBERS.health.nudgeReplied : n.refused ? NUMBERS.health.nudgeRefused : n.delivered ? NUMBERS.health.nudgeLanded : NUMBERS.health.nudgeNoReceipt;
                    const tone: Tone = n.replied ? "good" : n.refused ? "hot" : n.delivered ? "cool" : "slate";
                    return (
                      <li key={`${n.external_id}-${n.at}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                        <span className="min-w-0 truncate text-[15px] font-semibold text-foreground">{n.handle ?? n.external_id}</span>
                        <span className={cn("min-w-0 flex-1 truncate text-sm text-muted-foreground")}>{n.body}</span>
                        <TonePill tone={tone} className="shrink-0">{word} · {shortAgo(n.at, now)}</TonePill>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {health.recovery.length > 0 ? (
              <div>
                <h3 className="text-base font-semibold text-foreground">{SECTION.recovery}</h3>
                <ul className="mt-1 divide-y divide-border">
                  {health.recovery.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                      <span className="text-[15px] font-semibold text-foreground">{r.first_name ?? r.email}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{r.email}</span>
                      <TonePill tone={r.recovered ? "good" : "slate"} className="shrink-0">{r.recovered ? NUMBERS.health.recoveryFinished : NUMBERS.health.recoveryEmailed} · {shortAgo(r.sent_at, now)}</TonePill>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
