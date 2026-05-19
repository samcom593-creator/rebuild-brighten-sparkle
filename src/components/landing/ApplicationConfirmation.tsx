import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Crown,
  Calendar,
  AlertTriangle,
  MessageCircle,
  Send,
  Sparkles,
  Phone,
  Mail,
  PlayCircle,
  Clock,
  ArrowRight,
  ShieldCheck,
  Bot,
} from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CalendlyEmbed } from "@/components/landing/CalendlyEmbed";
import {
  WHATSAPP_GROUP_URL,
  TELEGRAM_GROUP_URL,
  APEX_SUPPORT_ASSISTANT_URL,
} from "@/lib/constants";
import { SCHEDULING_LINKS } from "@/lib/apexConfig";
import { useApplicationStatus } from "@/hooks/useApplicationStatus";

interface Props {
  applicationId: string | null;
  // Falls back to license_status from the RPC. Pass explicitly when the calling
  // page already routed by license (e.g. /apply/success/licensed) — keeps the
  // UI predictable when the RPC is slow or fails.
  forceLicenseStatus?: "licensed" | "unlicensed" | "pending";
  // When true, includes the Calendly embed for licensed applicants. The
  // standalone /status page should NOT embed Calendly (too heavy + duplicates
  // the booking flow already wired into the post-submit success page).
  showCalendly?: boolean;
}

function useCountdown(targetIso: string | null | undefined) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return useMemo(() => {
    if (!targetIso) return null;
    const t = new Date(targetIso).getTime();
    if (Number.isNaN(t)) return null;
    const ms = Math.max(0, t - now);
    const days = Math.floor(ms / 86_400_000);
    const hours = Math.floor((ms % 86_400_000) / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    return { days, hours, minutes, seconds, totalMs: ms };
  }, [targetIso, now]);
}

function formatSeminarLocal(iso: string | null | undefined): string {
  if (!iso) return "TBA";
  try {
    return new Date(iso).toLocaleString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return "TBA";
  }
}

function googleCalendarUrl(iso: string | null | undefined, title: string, details: string): string | null {
  if (!iso) return null;
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details,
    location: "Online — link in APEX Telegram",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const STEPS: { key: number; label: string }[] = [
  { key: 1, label: "Application Received" },
  { key: 2, label: "Manager Assigned" },
  { key: 3, label: "Manager Reached Out" },
  { key: 4, label: "In Review" },
  { key: 5, label: "Qualified" },
  { key: 6, label: "Contracted" },
];

function StatusBar({ step, total }: { step: number; total: number }) {
  const pct = Math.min(100, Math.max(0, (step / total) * 100));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Step {step} of {total}</span>
        <span>{Math.round(pct)}% complete</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted/60">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary via-primary to-emerald-400"
        />
      </div>
      <ol className="hidden md:grid grid-cols-6 gap-2 text-[10px] uppercase tracking-wide">
        {STEPS.map((s) => (
          <li
            key={s.key}
            className={
              s.key <= step
                ? "text-primary font-semibold"
                : "text-muted-foreground/60"
            }
          >
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ApplicationConfirmation({
  applicationId,
  forceLicenseStatus,
  showCalendly = true,
}: Props) {
  const { data: snap, isLoading } = useApplicationStatus(applicationId);

  const license =
    forceLicenseStatus ??
    (snap?.license_status as "licensed" | "unlicensed" | "pending" | undefined) ??
    "unlicensed";

  const telegramUrl = snap?.telegram_url || TELEGRAM_GROUP_URL;
  const telegramLabel = snap?.telegram_label || "Join the APEX Telegram";
  const supportUrl = snap?.support_url || APEX_SUPPORT_ASSISTANT_URL;
  const videoUrl = snap?.next_video_url || null;
  const cultureLine = snap?.culture_line || "Hold the Standard. Average is the disease.";

  const countdown = useCountdown(snap?.next_seminar_at);
  const calendarHref = googleCalendarUrl(
    snap?.next_seminar_at,
    "APEX Financial Recruiting Seminar",
    "Live seminar from the APEX Financial recruiting team. Join via the APEX Telegram for the meeting link.",
  );

  const firstName = snap?.first_name?.trim() || "";

  const manager = snap?.manager ?? null;

  // CTA hierarchy by license_status:
  //   licensed   → Schedule onboarding call (primary), Telegram (secondary)
  //   unlicensed → Start licensing (primary), Telegram (secondary)
  //   pending    → Manager will reach out — Telegram primary fallback
  const primaryCta = (() => {
    if (license === "licensed") {
      return { href: SCHEDULING_LINKS.licensed, label: "Schedule Onboarding Call", icon: Calendar, internal: false };
    }
    if (license === "unlicensed") {
      return { href: "/get-licensed", label: "Start Getting Licensed", icon: Sparkles, internal: true };
    }
    return { href: telegramUrl, label: telegramLabel, icon: Send, internal: false };
  })();

  return (
    <div className="min-h-screen bg-background py-6 sm:py-10 px-3 sm:px-4">
      {/* Subtle gradient backdrop — reuses the same aurora hue the landing uses */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,hsl(168_84%_42%/0.10)_0%,transparent_55%)]" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-3xl mx-auto"
      >
        <GlassCard className="p-5 sm:p-8 md:p-10 space-y-7 sm:space-y-9">
          {/* Header */}
          <div className="space-y-4 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.15, type: "spring", stiffness: 200 }}
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15"
            >
              <CheckCircle2 className="h-9 w-9 text-primary" />
            </motion.div>

            <div className="flex items-center justify-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              <span className="text-base font-semibold gradient-text">APEX Financial</span>
            </div>

            <div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold leading-tight">
                {firstName ? (
                  <>
                    {firstName}, your application is <span className="gradient-text">in.</span>
                  </>
                ) : (
                  <>
                    Application <span className="gradient-text">Received</span>
                  </>
                )}
              </h1>
              <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
                You're now in front of the APEX recruiting desk. Below is exactly what happens next — and what you can do in the next 5 minutes to move to the front of the line.
              </p>
            </div>
          </div>

          {/* Status bar */}
          {snap?.status_step ? (
            <StatusBar step={snap.status_step} total={snap.status_steps_total} />
          ) : null}

          {/* Urgency banner */}
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-left">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-amber-300">Reply fast or lose priority.</p>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Your hiring manager will call or text within hours. Applicants who reply inside <span className="font-semibold text-foreground">24 hours</span> are placed in the priority cohort. After 48 hours we re-route the slot.
              </p>
            </div>
          </div>

          {/* Manager card */}
          <section aria-label="Assigned hiring manager" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Your hiring manager</h2>
            {isLoading && !manager ? (
              <div className="h-24 rounded-xl border border-border/40 bg-muted/30 animate-pulse" />
            ) : manager ? (
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-xl border border-border/50 bg-muted/30 p-4">
                <Avatar className="h-16 w-16 ring-2 ring-primary/40">
                  <AvatarImage src={manager.avatar_url ?? undefined} alt={manager.display_name} />
                  <AvatarFallback>{manager.display_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-semibold leading-tight">{manager.display_name}</p>
                  <p className="text-xs text-muted-foreground">APEX Financial · Hiring Manager</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {manager.email ? (
                      <a href={`mailto:${manager.email}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Mail className="h-3.5 w-3.5" /> {manager.email}
                      </a>
                    ) : null}
                    {manager.phone ? (
                      <a href={`tel:${manager.phone}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Phone className="h-3.5 w-3.5" /> {manager.phone}
                      </a>
                    ) : null}
                  </div>
                </div>
                <Badge variant="outline" className="self-start sm:self-center border-primary/40 text-primary">
                  <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Assigned
                </Badge>
              </div>
            ) : (
              <div className="rounded-xl border border-border/50 bg-muted/30 p-4 text-sm text-muted-foreground">
                A hiring manager is being assigned right now. You'll see their name + photo here within minutes.
              </div>
            )}
          </section>

          {/* Next seminar countdown */}
          <section aria-label="Next live seminar" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Your first live seminar</h2>
            <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Calendar className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">{formatSeminarLocal(snap?.next_seminar_at)}</p>
                    <p className="text-xs text-muted-foreground">Live with Samuel James + APEX leadership · invite drops in Telegram</p>
                  </div>
                </div>
                {countdown ? (
                  <div className="flex items-center gap-2 text-xs font-mono text-primary">
                    <Clock className="h-4 w-4" />
                    {countdown.days > 0 ? `${countdown.days}d ` : ""}
                    {String(countdown.hours).padStart(2, "0")}h{" "}
                    {String(countdown.minutes).padStart(2, "0")}m{" "}
                    {String(countdown.seconds).padStart(2, "0")}s
                  </div>
                ) : null}
              </div>
              {calendarHref ? (
                <a
                  href={calendarHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Calendar className="h-3.5 w-3.5" /> Add to Google Calendar
                </a>
              ) : null}
            </div>
          </section>

          {/* Primary CTA + Telegram (CTA hierarchy: ONE primary, ONE high-energy secondary) */}
          <section aria-label="What to do right now" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Do this in the next 5 minutes</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {primaryCta.internal ? (
                <Link to={primaryCta.href} className="block">
                  <GradientButton size="lg" className="w-full text-base">
                    <primaryCta.icon className="h-5 w-5 mr-2" />
                    {primaryCta.label}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </GradientButton>
                </Link>
              ) : (
                <a href={primaryCta.href} target="_blank" rel="noopener noreferrer" className="block">
                  <GradientButton size="lg" className="w-full text-base">
                    <primaryCta.icon className="h-5 w-5 mr-2" />
                    {primaryCta.label}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </GradientButton>
                </a>
              )}
              <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className="block">
                <GradientButton
                  size="lg"
                  variant="outline"
                  className="w-full text-base bg-[#229ED9]/10 hover:bg-[#229ED9]/20 border-[#229ED9]/60 text-[#5fbff0]"
                >
                  <Send className="h-5 w-5 mr-2" />
                  {telegramLabel}
                </GradientButton>
              </a>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Telegram is where the seminar links, leaderboards, and APEX wins drop. Get in now so you don't miss the next call.
            </p>
          </section>

          {/* What happens next checklist */}
          <section aria-label="What happens next" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">What happens next</h2>
            <ol className="space-y-2 text-sm">
              {[
                {
                  title: "Watch the Day 1 welcome video",
                  copy: "Sam James walks you through how APEX hires, trains, and pays.",
                  done: false,
                  href: videoUrl,
                  external: true,
                },
                {
                  title: "Manager calls or texts you",
                  copy: "Within hours. Pick up. Applicants who don't are deprioritized in 48h.",
                  done: !!snap?.contacted_at,
                },
                {
                  title: "Join the live seminar",
                  copy: "Wed 7pm CT or Sat 10am CT. Drops in the APEX Telegram.",
                  done: false,
                },
                {
                  title: license === "licensed" ? "Schedule your onboarding call" : "Start your pre-licensing course",
                  copy: license === "licensed"
                    ? "Fast-track contracting kicks off as soon as the call is booked."
                    : "We cover the licensing cost. Most agents finish in 2 weeks.",
                  done: false,
                  href: license === "licensed" ? SCHEDULING_LINKS.licensed : "/get-licensed",
                  external: license === "licensed",
                },
              ].map((it) => (
                <li
                  key={it.title}
                  className="flex items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-3"
                >
                  <span
                    className={
                      it.done
                        ? "mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400"
                        : "mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-primary/50 text-primary"
                    }
                  >
                    {it.done ? <CheckCircle2 className="h-4 w-4" /> : <Sparkles className="h-3.5 w-3.5" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={"font-medium " + (it.done ? "text-emerald-300" : "text-foreground")}>{it.title}</p>
                      {it.href ? (
                        it.external ? (
                          <a href={it.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <PlayCircle className="h-3.5 w-3.5" /> Open
                          </a>
                        ) : (
                          <Link to={it.href} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <PlayCircle className="h-3.5 w-3.5" /> Open
                          </Link>
                        )
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{it.copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* Inline Calendly for licensed applicants */}
          {showCalendly && license === "licensed" ? (
            <section aria-label="Schedule call" className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Lock in your onboarding call</h2>
              <div className="rounded-xl overflow-hidden border border-border/50 bg-background/50">
                <CalendlyEmbed url={SCHEDULING_LINKS.licensed} />
              </div>
            </section>
          ) : null}

          {/* Support / AI assistant */}
          <section aria-label="Support" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Stuck? Get help in 60 seconds</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="block">
                <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 p-3 hover:bg-muted/40 transition-colors">
                  <Bot className="h-5 w-5 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">APEX Concierge</p>
                    <p className="text-xs text-muted-foreground">Live + AI-assisted. Answers in &lt; 5 min on weekdays.</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </a>
              <a href={WHATSAPP_GROUP_URL} target="_blank" rel="noopener noreferrer" className="block">
                <div className="flex items-center gap-3 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 p-3 hover:bg-[#25D366]/20 transition-colors">
                  <MessageCircle className="h-5 w-5 text-[#25D366]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">WhatsApp Hiring Chat</p>
                    <p className="text-xs text-muted-foreground">Backup if Telegram isn't your thing.</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </a>
            </div>
          </section>

          {/* Spam-folder safety net (keep — was high-value before) */}
          <div className="flex items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <p>
              Emails from APEX may land in your spam folder. Search "APEX Financial" and mark as Not Spam so you don't miss your manager's first email.
            </p>
          </div>

          {/* Culture line */}
          <div className="text-center pt-2">
            <p className="text-xs italic text-muted-foreground">{cultureLine}</p>
            <div className="mt-3 flex justify-center gap-3">
              <Link to="/">
                <GradientButton variant="outline" size="sm">Back to Home</GradientButton>
              </Link>
              {applicationId ? (
                <Link to={`/status/${applicationId}`}>
                  <GradientButton variant="outline" size="sm">
                    Check Application Status
                  </GradientButton>
                </Link>
              ) : null}
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}

export default ApplicationConfirmation;
