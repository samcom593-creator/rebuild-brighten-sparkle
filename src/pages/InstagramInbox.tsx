// Instagram command center (MP-305 Wave 4, 2026-10-28).
//
// One RPC (fn_ig_dashboard) renders everything: account status, the window's
// numbers, the action queues, the winners, and the last 60 threads. Every count
// is graded on DELIVERIES (a Meta receipt or an unrefused send), never on rows
// written: the previous page read instagram_dm_threads, a table nothing had
// updated since 2026-09-28, and showed 31 frozen threads as "the inbox".
//
// Phone numbers and emails are inline with one-tap Call / Text / Open on IG
// (feedback_no_hidden_working_data): the point of the page is the next action.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle, CheckCircle2, ExternalLink, Flame, Instagram, Link2, Mail, MessageCircle,
  Phone, RefreshCw, Trophy, UserCheck, Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { contactLinkProps, phoneHref, smsHref } from "@/lib/phone";
import { cn } from "@/lib/utils";

type Window = "today" | "7d" | "30d";

interface Status {
  links_blocked: boolean; links_blocked_at: string | null; last_link_refusal_at: string | null; links_proven_at: string | null;
  token_ok: boolean | null; token_checked_at: string | null; ig_username: string;
  last_delivered_at: string | null; last_bot_delivered_at: string | null; last_inbound_at: string | null;
  nudge_cron_last_at: string | null; nudge_cron_last_status: string | null; generated_at: string;
}
interface Kpis {
  inbound_msgs: number; inbound_people: number; replied_people: number; unanswered_people: number;
  delivered_msgs: number; bot_msgs: number; sam_msgs: number; refused_msgs: number;
  licensed_leads: number; phones_captured: number; emails_captured: number; calls_booked: number; applicants: number;
  nudges_delivered: number; recovery_emails: number; median_reply_secs: number | null;
}
interface Hot { external_id: string; handle: string | null; name: string | null; phone: string | null; email: string | null; booked: boolean; last_at: string; last_body: string | null; last_direction: string | null }
interface Waiting { external_id: string; handle: string | null; name: string | null; last_at: string; age_min: number; last_body: string | null; intent: string | null; human_lane: boolean; window_open: boolean }
interface Booked { id: string; invitee_name: string | null; invitee_phone: string | null; instagram_handle: string | null; scheduled_at: string; event_type_name: string | null }
interface Nudged { external_id: string; handle: string | null; tag: string; body: string; at: string; delivered: boolean; replied: boolean }
interface Recovery { id: string; email: string; first_name: string | null; sent_at: string; recovered: boolean }
interface Reel { external_id: string; title: string | null; url: string | null; views: number | null; likes: number | null; comments: number | null; posted_at: string; comment_events: number; keyword_comments: number; dms_from_comments: number }
interface Intent { intent: string; people: number }
interface Applicant { id: string; first_name: string | null; last_initial: string | null; created_at: string; status: string | null; instagram_handle: string | null }
interface Line { line: string; sends: number; replies: number; reply_rate: number }
interface Person { external_id: string; handle: string | null; name: string | null; last_at: string; last_body: string | null; last_direction: string | null; intent: string | null; msgs: number; phone: string | null; booked: boolean; human_lane: boolean; awaiting_us: boolean }
interface Dashboard {
  status: Status; kpis: Kpis;
  queues: { hot: Hot[]; waiting: Waiting[]; booked: Booked[]; nudged: Nudged[]; recovery: Recovery[] };
  winners: { reels: Reel[]; intents: Intent[]; applicants: Applicant[]; best_lines: Line[] };
  people: Person[];
}

const IG_INBOX = "https://www.instagram.com/direct/inbox/";
const BUSINESS = new Set(["opportunity", "licensed", "licensed_team", "mentorship", "fitness", "rentals", "partnership", "followup"]);

function ago(ts: string | null | undefined): string {
  if (!ts) return "never";
  try { return formatDistanceToNowStrict(new Date(ts), { addSuffix: true }); } catch { return "?"; }
}
function profileUrl(handle: string | null | undefined): string {
  const h = (handle ?? "").replace(/^@/, "").trim();
  return h && !/^\d+$/.test(h) ? `https://www.instagram.com/${h}/` : IG_INBOX;
}
function who(p: { handle?: string | null; name?: string | null; external_id?: string }): string {
  return p.handle && !/^\d+$/.test(p.handle.replace(/^@/, "")) ? p.handle : (p.name ?? p.external_id ?? "someone");
}
function n(v: number | null | undefined): string { return (v ?? 0).toLocaleString(); }
function secs(v: number | null | undefined): string {
  if (v == null) return "n/a";
  if (v < 60) return `${Math.round(v)}s`;
  if (v < 3600) return `${Math.round(v / 60)}m`;
  return `${(v / 3600).toFixed(1)}h`;
}
const INTENT_LABEL: Record<string, string> = {
  opportunity: "Wants in", licensed: "Licensed", licensed_team: "Licensed + team", mentorship: "Mentorship", fitness: "Fitness",
  rentals: "Rentals", partnership: "Brand / collab", followup: "Follow-up", greeting: "Said hi", casual: "Casual", props: "Props",
  socials: "Asked socials", flirty: "Flirty", troll: "Troll", spam: "Spam", sam_thread: "Sam's thread", assistant_ask: "Asked if bot",
};
const label = (i: string | null | undefined) => (i ? INTENT_LABEL[i] ?? i : "Unsorted");

function Chip({ ok, warn, children }: { ok: boolean | null; warn?: boolean; children: React.ReactNode }) {
  const tone = ok === null ? "border-border/60 text-muted-foreground" : ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : warn ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-red-500/40 bg-red-500/10 text-red-300";
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", tone)}>{children}</span>;
}
function Kpi({ title, value, sub, tone }: { title: string; value: string; sub?: string; tone?: "good" | "bad" | "gold" }) {
  return (
    <Card className={cn("border-border/60", tone === "bad" && "border-red-500/40 bg-red-500/5", tone === "good" && "border-emerald-500/30 bg-emerald-500/5", tone === "gold" && "border-amber-500/40 bg-amber-500/5")}>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
function Section({ icon, title, count, hint, children }: { icon: React.ReactNode; title: string; count?: number; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}{title}
          {typeof count === "number" && <Badge variant="secondary" className="ml-1 tabular-nums">{count}</Badge>}
          {hint && <span className="ml-auto text-xs font-normal text-muted-foreground">{hint}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}
function Empty({ text }: { text: string }) { return <div className="py-4 text-center text-sm text-muted-foreground">{text}</div>; }
function OpenIg({ handle }: { handle: string | null | undefined }) {
  return (
    <Button asChild size="sm" variant="outline"><a href={profileUrl(handle)} target="_blank" rel="noopener noreferrer"><Instagram className="mr-1 h-3.5 w-3.5" />Open on IG</a></Button>
  );
}
function CallText({ phone }: { phone: string | null | undefined }) {
  const tel = phoneHref(phone); const sms = smsHref(phone);
  if (!tel) return null;
  return (
    <>
      <Button asChild size="sm"><a href={tel} {...contactLinkProps(tel)}><Phone className="mr-1 h-3.5 w-3.5" />Call {phone}</a></Button>
      {sms && <Button asChild size="sm" variant="outline"><a href={sms} {...contactLinkProps(sms)}><MessageCircle className="mr-1 h-3.5 w-3.5" />Text</a></Button>}
    </>
  );
}

export default function InstagramInbox() {
  usePageTitle("Instagram - command center");
  const [win, setWin] = useState<Window>("7d");

  const query = useQuery({
    queryKey: ["ig-dashboard", win],
    refetchInterval: 60_000,
    queryFn: async () => {
      // fn_ig_dashboard is newer than the generated client types (types.ts regen needs the dead PAT).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("fn_ig_dashboard", { p_window: win });
      if (error) throw error;
      return data as Dashboard;
    },
  });

  const d = query.data;
  const waitingBusiness = useMemo(() => (d?.queues.waiting ?? []).filter((w) => BUSINESS.has(w.intent ?? "")), [d]);
  const waitingOther = useMemo(() => (d?.queues.waiting ?? []).filter((w) => !BUSINESS.has(w.intent ?? "")), [d]);

  if (query.isLoading) return <PageLoadingSkeleton variant="dashboard" />;
  if (query.isError || !d) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Card className="border-red-500/40"><CardContent className="p-6 text-sm">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-red-400" />The dashboard could not load.</div>
          <div className="mt-1 text-muted-foreground">{String((query.error as Error | null)?.message ?? "unknown error")}</div>
          <Button className="mt-3" size="sm" onClick={() => query.refetch()}>Try again</Button>
        </CardContent></Card>
      </div>
    );
  }

  const s = d.status; const k = d.kpis;
  const replyPct = k.inbound_people ? Math.round((100 * k.replied_people) / k.inbound_people) : 0;
  const linksTone = s.links_blocked ? false : s.links_proven_at && s.last_link_refusal_at && s.links_proven_at > s.last_link_refusal_at ? true : null;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 space-y-5">
      <PageHeader
        eyebrow="Instagram"
        eyebrowIcon={<Instagram className="h-3 w-3" />}
        title={`@${s.ig_username} command center`}
        subtitle="Every DM, comment and follow-up, graded on what actually reached people."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline"><a href={IG_INBOX} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-4 w-4" />IG inbox</a></Button>
            <Button size="sm" variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw className={cn("mr-1 h-4 w-4", query.isFetching && "animate-spin")} />Refresh</Button>
          </div>
        }
      />

      {/* Account status: the four things that silently broke this year */}
      <div className="flex flex-wrap gap-2">
        <Chip ok={s.token_ok}>{s.token_ok === false ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Token {s.token_ok === null ? "unchecked" : s.token_ok ? "alive" : "DEAD"} · {ago(s.token_checked_at)}</Chip>
        <Chip ok={linksTone} warn={linksTone === null}><Link2 className="h-3.5 w-3.5" />Links {s.links_blocked ? `BLOCKED by Meta ${ago(s.links_blocked_at)}` : linksTone ? `delivering (proven ${ago(s.links_proven_at)})` : `allowed, unproven since last refusal ${ago(s.last_link_refusal_at)}`}</Chip>
        <Chip ok={!!s.last_bot_delivered_at && Date.now() - new Date(s.last_bot_delivered_at).getTime() < 36e5 * 24} warn><MessageCircle className="h-3.5 w-3.5" />Bot last delivered {ago(s.last_bot_delivered_at)}</Chip>
        <Chip ok={s.nudge_cron_last_status === "succeeded" && !!s.nudge_cron_last_at && Date.now() - new Date(s.nudge_cron_last_at).getTime() < 30 * 60e3}><RefreshCw className="h-3.5 w-3.5" />Follow-ups {s.nudge_cron_last_status ?? "never"} · {ago(s.nudge_cron_last_at)}</Chip>
      </div>

      {/* Window + numbers */}
      <div className="flex items-center gap-2">
        {(["today", "7d", "30d"] as Window[]).map((w) => (
          <Button key={w} size="sm" variant={win === w ? "default" : "outline"} onClick={() => setWin(w)}>{w === "today" ? "Today" : w === "7d" ? "7 days" : "30 days"}</Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">updated {ago(s.generated_at)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi title="People in" value={n(k.inbound_people)} sub={`${n(k.inbound_msgs)} messages`} />
        <Kpi title="Replied in 24h" value={`${replyPct}%`} sub={`${n(k.replied_people)} of ${n(k.inbound_people)}`} tone={replyPct >= 95 ? "good" : replyPct < 70 ? "bad" : undefined} />
        <Kpi title="Waiting on us" value={n(k.unanswered_people)} sub="last message was theirs" tone={k.unanswered_people > 0 ? "bad" : "good"} />
        <Kpi title="Licensed leads" value={n(k.licensed_leads)} sub={`${n(k.phones_captured)} numbers · ${n(k.emails_captured)} emails`} tone="gold" />
        <Kpi title="Calls booked" value={n(k.calls_booked)} sub="from Instagram" tone={k.calls_booked > 0 ? "good" : undefined} />
        <Kpi title="Applicants" value={n(k.applicants)} sub="utm instagram" tone={k.applicants > 0 ? "good" : undefined} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi title="Delivered" value={n(k.delivered_msgs)} sub={`${n(k.bot_msgs)} bot · ${n(k.sam_msgs)} you`} />
        <Kpi title="Refused by Meta" value={n(k.refused_msgs)} sub="links, closed windows, retries" tone={k.refused_msgs > 0 ? "bad" : "good"} />
        <Kpi title="Median reply" value={secs(k.median_reply_secs)} sub="inbound to delivered" />
        <Kpi title="Follow-ups" value={n(k.nudges_delivered)} sub={`${n(k.recovery_emails)} recovery emails`} />
      </div>

      {/* Action queues */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={<Flame className="h-4 w-4 text-amber-400" />} title="Call now" count={d.queues.hot.length} hint="licensed, last 14 days">
          {d.queues.hot.length === 0 && <Empty text="No licensed leads waiting." />}
          {d.queues.hot.map((h) => (
            <div key={h.external_id} className={cn("rounded-lg border p-3", h.last_direction === "inbound" ? "border-red-500/40 bg-red-500/5" : "border-border/60")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{who(h)}</span>
                {h.name && h.handle && <span className="text-xs text-muted-foreground">{h.name}</span>}
                {h.booked ? <Badge className="bg-emerald-600">booked</Badge> : <Badge variant="destructive">not booked</Badge>}
                {h.last_direction === "inbound" && <Badge variant="destructive">waiting on you</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">{ago(h.last_at)}</span>
              </div>
              {h.last_body && <div className="mt-1 text-sm text-muted-foreground">"{h.last_body}"</div>}
              <div className="mt-2 flex flex-wrap gap-2">
                <CallText phone={h.phone} />
                {h.email && <Button asChild size="sm" variant="outline"><a href={`mailto:${h.email}`}><Mail className="mr-1 h-3.5 w-3.5" />{h.email}</a></Button>}
                <OpenIg handle={h.handle} />
              </div>
            </div>
          ))}
        </Section>

        <Section icon={<AlertTriangle className="h-4 w-4 text-red-400" />} title="Waiting on us" count={d.queues.waiting.length} hint="their message is the last one, 7 days">
          {d.queues.waiting.length === 0 && <Empty text="Nobody is waiting. Hold the standard." />}
          {waitingBusiness.map((w) => <WaitingRow key={w.external_id} w={w} strong />)}
          {waitingOther.length > 0 && (
            <details className="pt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">{waitingOther.length} more with no business intent (casual, props, greetings)</summary>
              <div className="mt-2 space-y-2">{waitingOther.map((w) => <WaitingRow key={w.external_id} w={w} />)}</div>
            </details>
          )}
        </Section>

        <Section icon={<UserCheck className="h-4 w-4 text-emerald-400" />} title="Booked calls" count={d.queues.booked.length} hint="from Instagram, upcoming">
          {d.queues.booked.length === 0 && <Empty text="No upcoming calls booked from Instagram." />}
          {d.queues.booked.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-3">
              <span className="font-semibold">{b.invitee_name ?? b.instagram_handle ?? "prospect"}</span>
              <span className="text-xs text-muted-foreground">{new Date(b.scheduled_at).toLocaleString("en-US", { timeZone: "America/Phoenix", weekday: "short", hour: "numeric", minute: "2-digit" })} AZ · {b.event_type_name}</span>
              <div className="ml-auto flex gap-2"><CallText phone={b.invitee_phone} /><OpenIg handle={b.instagram_handle} /></div>
            </div>
          ))}
        </Section>

        <Section icon={<RefreshCw className="h-4 w-4" />} title="Follow-ups sent" count={d.queues.nudged.length + d.queues.recovery.length} hint="last 48h nudges · 14d recovery emails">
          {d.queues.nudged.length === 0 && d.queues.recovery.length === 0 && <Empty text="Nothing nudged yet. The engine runs every 10 minutes." />}
          {d.queues.nudged.map((x) => (
            <div key={`${x.external_id}-${x.at}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2 text-sm">
              <Badge variant="secondary">{x.tag}</Badge><span className="font-medium">{who(x)}</span>
              <span className="text-muted-foreground">"{x.body}"</span>
              <span className="ml-auto text-xs">{x.delivered ? (x.replied ? <span className="text-emerald-400">replied</span> : "delivered") : <span className="text-red-400">refused</span>} · {ago(x.at)}</span>
            </div>
          ))}
          {d.queues.recovery.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2 text-sm">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" /><span className="font-medium">{r.first_name ?? r.email}</span>
              <span className="text-xs text-muted-foreground">{r.email}</span>
              <span className="ml-auto text-xs">{r.recovered ? <span className="text-emerald-400">finished the app</span> : "emailed"} · {ago(r.sent_at)}</span>
            </div>
          ))}
        </Section>
      </div>

      {/* Winners */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={<Trophy className="h-4 w-4 text-amber-400" />} title="Winning reels" hint="30 days, by views">
          {d.winners.reels.length === 0 && <Empty text="No reel stats in the last 30 days." />}
          {d.winners.reels.map((r, i) => (
            <a key={r.external_id} href={r.url ?? "#"} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg border border-border/60 p-2 hover:bg-muted/40">
              <span className="w-5 text-right text-sm font-bold tabular-nums text-amber-400">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.title || "(no caption)"}</div>
                <div className="text-xs text-muted-foreground">{n(r.views)} views · {n(r.likes)} likes · {n(r.comments)} comments{r.keyword_comments ? ` · ${r.keyword_comments} said "apex"` : ""}{r.dms_from_comments ? ` · ${r.dms_from_comments} DMs sent` : ""} · {ago(r.posted_at)}</div>
              </div>
            </a>
          ))}
        </Section>

        <div className="space-y-4">
          <Section icon={<MessageCircle className="h-4 w-4 text-emerald-400" />} title="Lines that get replies" hint="bot messages, 30 days, 4+ sends">
            {d.winners.best_lines.length === 0 && <Empty text="Not enough sends yet." />}
            {d.winners.best_lines.map((l) => (
              <div key={l.line} className="flex items-start gap-2 text-sm">
                <Badge className={cn("tabular-nums", l.reply_rate >= 60 ? "bg-emerald-600" : l.reply_rate >= 30 ? "bg-amber-600" : "bg-muted text-foreground")}>{l.reply_rate}%</Badge>
                <span className="min-w-0 flex-1 text-muted-foreground">"{l.line}"</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{l.replies}/{l.sends}</span>
              </div>
            ))}
          </Section>
          <Section icon={<Users className="h-4 w-4" />} title="What people come for" hint="30 days">
            <div className="flex flex-wrap gap-2">
              {d.winners.intents.map((x) => <Badge key={x.intent} variant={BUSINESS.has(x.intent) ? "default" : "secondary"}>{label(x.intent)} · {x.people}</Badge>)}
            </div>
          </Section>
          <Section icon={<UserCheck className="h-4 w-4 text-emerald-400" />} title="Applied from Instagram" count={d.winners.applicants.length} hint="30 days">
            {d.winners.applicants.length === 0 && <Empty text="No applications attributed to Instagram in 30 days." />}
            {d.winners.applicants.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm"><span className="font-medium">{a.first_name} {a.last_initial}.</span><Badge variant="secondary">{a.status ?? "new"}</Badge><span className="ml-auto text-xs text-muted-foreground">{a.instagram_handle ?? ""} {ago(a.created_at)}</span></div>
            ))}
          </Section>
        </div>
      </div>

      {/* People */}
      <Section icon={<Users className="h-4 w-4" />} title="Recent threads" count={d.people.length} hint="last 14 days">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-1 pr-2">Who</th><th className="py-1 pr-2">Lane</th><th className="py-1 pr-2">Last message</th><th className="py-1 pr-2">Next</th><th className="py-1 pr-2 text-right">When</th></tr></thead>
            <tbody>
              {d.people.map((p) => (
                <tr key={p.external_id} className="border-t border-border/40 align-top">
                  <td className="py-2 pr-2 whitespace-nowrap"><a className="font-medium hover:underline" href={profileUrl(p.handle)} target="_blank" rel="noopener noreferrer">{who(p)}</a>{p.human_lane && <div className="text-[10px] text-muted-foreground">your thread</div>}</td>
                  <td className="py-2 pr-2 whitespace-nowrap"><Badge variant={BUSINESS.has(p.intent ?? "") ? "default" : "secondary"}>{label(p.intent)}</Badge></td>
                  <td className="py-2 pr-2 max-w-[28rem]"><span className={cn("text-muted-foreground", p.last_direction === "outbound" && "italic")}>{p.last_direction === "outbound" ? "you: " : ""}{p.last_body}</span></td>
                  <td className="py-2 pr-2 whitespace-nowrap">
                    {p.intent?.startsWith("licensed") && p.phone && !p.booked ? <a className="text-amber-400 font-medium" href={phoneHref(p.phone) ?? "#"} {...contactLinkProps(phoneHref(p.phone))}>call {p.phone}</a>
                      : p.booked ? <span className="text-emerald-400">booked</span>
                      : p.awaiting_us ? <a className="text-red-400 font-medium" href={profileUrl(p.handle)} target="_blank" rel="noopener noreferrer">reply</a>
                      : <span className="text-muted-foreground">watch</span>}
                  </td>
                  <td className="py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{ago(p.last_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function WaitingRow({ w, strong }: { w: Waiting; strong?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", strong ? "border-red-500/40 bg-red-500/5" : "border-border/60")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{who(w)}</span>
        <Badge variant={strong ? "default" : "secondary"}>{label(w.intent)}</Badge>
        {w.human_lane && <Badge variant="outline">your thread</Badge>}
        {!w.window_open && <Badge variant="outline" className="text-muted-foreground">24h window closed</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{w.age_min >= 60 ? `${Math.round(w.age_min / 60)}h` : `${w.age_min}m`} waiting</span>
      </div>
      {w.last_body && <div className="mt-1 text-sm text-muted-foreground">"{w.last_body}"</div>}
      <div className="mt-2"><OpenIg handle={w.handle} /></div>
    </div>
  );
}
