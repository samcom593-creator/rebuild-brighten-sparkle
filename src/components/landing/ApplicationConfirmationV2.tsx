import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Crown, Send, Calendar, Sparkles, AlertTriangle } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { CalendlyEmbed } from "@/components/landing/CalendlyEmbed";
import { SCHEDULING_LINKS, getCalendlyHostName } from "@/lib/apexConfig";
import { useApplicationStatus } from "@/hooks/useApplicationStatus";

/**
 * Stage 1 final success page.
 *
 * Sam-feedback 2026-06-03: replace the 595-line page that had 7 competing CTAs
 * with a deliberately minimal branched view. ONE primary CTA + ONE secondary,
 * different per license_status. No seminar, no manager card, no support
 * assistant, no spam-folder warning, no support backup link.
 *
 * UNLICENSED: Start prelicensing course (primary) → Telegram bot DM (secondary).
 * LICENSED:   Book hire call via Calendly (primary) → Telegram bot DM (secondary).
 */

interface Props {
  applicationId: string | null;
  forceLicenseStatus?: "licensed" | "unlicensed" | "pending";
  showCalendly?: boolean;
}

const TG_BOT = "ApexFinancialBot";

export function ApplicationConfirmationV2({
  applicationId,
  forceLicenseStatus,
  showCalendly = true,
}: Props) {
  const { snap, isLoading } = useApplicationStatus(applicationId);

  const license =
    forceLicenseStatus ??
    (snap?.license_status as "licensed" | "unlicensed" | "pending" | undefined) ??
    "unlicensed";

  const firstName = snap?.first_name?.trim() || "";

  const tgDeepLink = applicationId
    ? `https://t.me/${TG_BOT}?start=apply_${applicationId}`
    : `https://t.me/${TG_BOT}`;

  // Sticky-bottom CTA on mobile so it never gets lost in scroll.
  return (
    <div className="min-h-screen bg-background py-6 sm:py-10 px-3 sm:px-4 pb-24 sm:pb-10">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,hsl(168_84%_42%/0.10)_0%,transparent_55%)]" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 w-full max-w-2xl mx-auto"
      >
        <GlassCard className="p-5 sm:p-8 space-y-6">
          {/* Brand + receipt */}
          <div className="text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <div className="flex items-center justify-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              <span className="text-base font-semibold gradient-text">APEX Financial</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold leading-tight">
              {firstName ? <>{firstName}, your application is <span className="gradient-text">in.</span></> : <>Application <span className="gradient-text">received.</span></>}
            </h1>
          </div>

          {/* Branched body */}
          {license === "licensed" ? <LicensedBody applicationId={applicationId} showCalendly={showCalendly} tgDeepLink={tgDeepLink} /> : null}
          {license === "unlicensed" ? <UnlicensedBody firstName={firstName} email={snap?.email ?? ""} tgDeepLink={tgDeepLink} /> : null}
          {license === "pending" ? <PendingBody tgDeepLink={tgDeepLink} /> : null}

          {/* Culture line — small, no CTA, no buttons */}
          <p className="text-center text-xs italic text-muted-foreground pt-2">
            Hold the Standard. Average is the disease.
          </p>
        </GlassCard>
      </motion.div>
    </div>
  );
}

// ---------- Unlicensed ----------

function UnlicensedBody({ firstName, email, tgDeepLink }: { firstName: string; email: string; tgDeepLink: string }) {
  // Pre-fill applicant email into the get-licensed URL so XCEL recognizes them.
  const courseUrl = email
    ? `/get-licensed?email=${encodeURIComponent(email)}`
    : "/get-licensed";

  return (
    <div className="space-y-6">
      {/* The three-step path */}
      <div className="rounded-md border border-border/40 bg-muted/20 p-4 sm:p-5 space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Your 3-step path</p>
        <Step done label="Application received" />
        <Step current label="Start your prelicensing course" detail="~$120, refundable when you produce. 3 days to license." />
        <Step label="Hire call unlocks the moment you pass" />
      </div>

      {/* Primary CTA */}
      <Link to={courseUrl} className="block">
        <GradientButton className="w-full text-base h-14" size="lg">
          <Sparkles className="h-5 w-5 mr-2" />
          Start your prelicensing course
        </GradientButton>
      </Link>

      {/* Secondary CTA: Telegram bot */}
      <a href={tgDeepLink} target="_blank" rel="noopener noreferrer" className="block">
        <GradientButton variant="outline" className="w-full" size="lg">
          <Send className="h-4 w-4 mr-2" />
          Open APEX bot on Telegram
        </GradientButton>
      </a>

      <p className="text-xs text-center text-muted-foreground">
        We also sent the course link to your email. Check inbox + spam.
      </p>
    </div>
  );
}

// ---------- Licensed ----------

function LicensedBody({
  applicationId,
  showCalendly,
  tgDeepLink,
}: {
  applicationId: string | null;
  showCalendly: boolean;
  tgDeepLink: string;
}) {
  // v9 wave-C complaint #6: applicants land on a Calendly with no idea who
  // they're booking with. Derive host name from the URL slug.
  const calendlyHost = getCalendlyHostName(SCHEDULING_LINKS.licensed);
  return (
    <div className="space-y-6">
      {/* The path */}
      <div className="rounded-md border border-border/40 bg-muted/20 p-4 sm:p-5 space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Activation path</p>
        <Step done label="Application received" />
        <Step current label="Book your hire call" detail="The fastest path to your first check." />
        <Step label="Contracting + Discord invite arrive same day" />
      </div>

      {/* Host disclosure — applicant should know whose calendar this is */}
      <p className="text-center text-sm">
        <span className="text-muted-foreground">You're booking with: </span>
        <span className="font-semibold text-foreground">{calendlyHost}</span>
      </p>

      {/* Primary CTA: Calendly */}
      {showCalendly ? (
        <section className="rounded-md overflow-hidden border border-border/50 bg-background/50">
          <CalendlyEmbed url={SCHEDULING_LINKS.licensed} />
        </section>
      ) : (
        <a href={SCHEDULING_LINKS.licensed} target="_blank" rel="noopener noreferrer" className="block">
          <GradientButton className="w-full text-base h-14" size="lg">
            <Calendar className="h-5 w-5 mr-2" />
            Book your hire call
          </GradientButton>
        </a>
      )}

      {/* Secondary CTA: Telegram bot */}
      <a href={tgDeepLink} target="_blank" rel="noopener noreferrer" className="block">
        <GradientButton variant="outline" className="w-full" size="lg">
          <Send className="h-4 w-4 mr-2" />
          Open APEX bot on Telegram
        </GradientButton>
      </a>

      <p className="text-xs text-center text-muted-foreground">
        We also emailed the booking link + Discord invite. Check inbox + spam.
      </p>
    </div>
  );
}

// ---------- Pending (license status unknown) ----------

function PendingBody({ tgDeepLink }: { tgDeepLink: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-center text-muted-foreground">
        Your manager will reach out shortly to verify license status and route you to the right next step.
      </p>
      <a href={tgDeepLink} target="_blank" rel="noopener noreferrer" className="block">
        <GradientButton variant="outline" className="w-full" size="lg">
          <Send className="h-4 w-4 mr-2" />
          Open APEX bot on Telegram
        </GradientButton>
      </a>
    </div>
  );
}

// ---------- Reusable step row ----------

function Step({ label, detail, done, current }: { label: string; detail?: string; done?: boolean; current?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={
          done
            ? "mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 shrink-0"
            : current
            ? "mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0 animate-pulse"
            : "mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/40 text-muted-foreground shrink-0"
        }
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : null}
      </span>
      <div className="min-w-0">
        <p className={current ? "text-sm font-semibold text-foreground" : done ? "text-sm text-emerald-300/80 line-through" : "text-sm text-muted-foreground"}>
          {label}
        </p>
        {detail ? <p className="text-xs text-muted-foreground mt-0.5">{detail}</p> : null}
      </div>
    </div>
  );
}

export default ApplicationConfirmationV2;
