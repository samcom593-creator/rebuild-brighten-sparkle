import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Crown, Calendar, Sparkles, AlertTriangle } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { CalendlyEmbed } from "@/components/landing/CalendlyEmbed";
import { SCHEDULING_LINKS, getCalendlyHostName } from "@/lib/apexConfig";
import { useApplicationStatus } from "@/hooks/useApplicationStatus";
import { supabase } from "@/integrations/supabase/client";
import { resolveBrand } from "@/config/brand";

/**
 * Stage 1 final success page.
 *
 * Sam-feedback 2026-06-03: replace the 595-line page that had 7 competing CTAs
 * with a deliberately minimal branched view. ONE primary CTA + ONE secondary,
 * different per license_status. No seminar, no manager card, no support
 * assistant, no spam-folder warning, no support backup link.
 *
 * UNLICENSED: Start prelicensing course (primary) → book the licensing call.
 * LICENSED:   Book hire call via Calendly (primary) → activate the portal.
 *
 * 2026-08-31: every branch used to end in "Open APEX bot on Telegram". Telegram
 * had EIGHT registered users in its entire lifetime while that CTA sat on every
 * applicant confirmation, so it converted essentially nobody, and Sam has moved
 * the team to Slack + Discord.
 *
 * Slack is deliberately NOT offered here. These /apply/success routes are
 * public, and the Slack invite is an open shared-invite URL — putting it on
 * this page would let anyone who submits the form walk into the internal
 * workspace. The page's own copy already states the real policy: team channels
 * are issued after you are hired and your identity is verified. So each branch
 * now ends in the next real step instead of a chat app.
 */

interface Props {
  applicationId: string | null;
  forceLicenseStatus?: "licensed" | "unlicensed" | "pending";
  showCalendly?: boolean;
}

const BRAND = resolveBrand();

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


  // Mint a one-click magic-login URL the moment we have an applicationId.
  // Sam directive 2026-06-15 (voice): "Whenever I click the referral link,
  // they're logged in and everything like that. They should have the course
  // click — point and clear."
  //
  // The action_link is a Supabase NATIVE magic link — clicking it auto-logs
  // the applicant in and redirects to the licensing roadmap (unlicensed) or
  // contracting intake (licensed). If the mint fails for any reason we fall back to
  // the regular non-authenticated CTAs below — never break the flow.
  const [autoLoginUrl, setAutoLoginUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!applicationId) {
      setAutoLoginUrl(null);
      return () => {
        cancelled = true;
      };
    }
    // The edge fn looks up email by applicationId server-side — we don't
    // need to wait for the status snapshot to load.
    const redirectPath =
      license === "licensed" ? "/start-contracting" : "/get-licensed#licensing-video";

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          "applicant-magic-link",
          { body: { applicationId, redirectPath } },
        );
        if (cancelled) return;
        if (error) {
          // Non-fatal — leave autoLoginUrl null so CTA falls back to /get-licensed.
          return;
        }
        const link = (data as any)?.action_link;
        if (typeof link === "string" && link.startsWith("http")) {
          setAutoLoginUrl(link);
        }
      } catch { // empty-catch-allow:best-effort-fallback
        // Non-fatal: keep the legacy CTA as the fallback path.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applicationId, license]);

  // Sticky-bottom CTA on mobile so it never gets lost in scroll.
  return (
    <main className="min-h-screen bg-background py-6 sm:py-10 px-3 sm:px-4 pb-24 sm:pb-10">
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
          {license === "licensed" ? <LicensedBody applicationId={applicationId} showCalendly={showCalendly} autoLoginUrl={autoLoginUrl} /> : null}
          {license === "unlicensed" ? <UnlicensedBody firstName={firstName} email={snap?.email ?? ""} autoLoginUrl={autoLoginUrl} /> : null}
          {license === "pending" ? <PendingBody /> : null}

          {/* Culture line — small, no CTA, no buttons */}
          <p className="text-center text-xs italic text-muted-foreground pt-2">
            Hold the Standard. Average is the disease.
          </p>
        </GlassCard>
      </motion.div>
    </main>
  );
}

// ---------- Unlicensed ----------

function UnlicensedBody({
  firstName,
  email,
  autoLoginUrl,
}: {
  firstName: string;
  email: string;
  autoLoginUrl: string | null;
}) {
  // Pre-fill applicant email into the get-licensed URL so XCEL recognizes them.
  const courseUrl = email
    ? `/get-licensed?email=${encodeURIComponent(email)}#licensing-video`
    : "/get-licensed#licensing-video";

  // Primary CTA: when the magic-link mint succeeded, clicking the button
  // auto-logs the applicant in and drops them straight onto
  // the licensing roadmap. When it failed (or hasn't returned yet) we fall
  // back to the legacy /get-licensed link so the page never blocks.
  const primaryHref = autoLoginUrl ?? courseUrl;
  const primaryIsExternal = !!autoLoginUrl;

  return (
    <div className="space-y-6">
      {/* The three-step path */}
      <div className="rounded-md border border-border/40 bg-muted/20 p-4 sm:p-5 space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Your 3-step path</p>
        <Step done label="Application received" />
        <Step current label="Open your APEX licensing roadmap" detail="The license is the gateway to the producer, manager, and agency-owner paths." />
        <Step label="Complete course → exam → fingerprints → state approval" />
      </div>

      {/* Primary CTA — auto-login + course when the magic link is ready */}
      {primaryIsExternal ? (
        <GradientButton asChild className="w-full text-base h-14" size="lg">
          <a href={primaryHref} className="block">
            <Sparkles className="h-5 w-5 mr-2" />
            Watch licensing video &amp; open roadmap
          </a>
        </GradientButton>
      ) : (
        <GradientButton asChild className="w-full text-base h-14" size="lg">
          <Link to={primaryHref} className="block">
            <Sparkles className="h-5 w-5 mr-2" />
            Watch licensing video &amp; open roadmap
          </Link>
        </GradientButton>
      )}

      {/* Secondary: talk to a human. Replaces the Telegram CTA — see the file
          header for why that went away. */}
      <GradientButton asChild variant="outline" className="w-full" size="lg">
        <a href={SCHEDULING_LINKS.unlicensed} target="_blank" rel="noopener noreferrer" className="block">
          <Calendar className="h-4 w-4 mr-2" />
          Book a call with your manager
        </a>
      </GradientButton>

      <p className="text-xs text-center text-muted-foreground">
        Every week you wait is a week you are not contracting, training, producing, or building your book. We sent the roadmap to your email; check inbox + spam.
      </p>
    </div>
  );
}

// ---------- Licensed ----------

function LicensedBody({
  applicationId,
  showCalendly,
  autoLoginUrl,
}: {
  applicationId: string | null;
  showCalendly: boolean;
  autoLoginUrl: string | null;
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
        <Step current label="Book your brokerage activation call" detail="Your application does not activate carrier, platform, training, or lead access by itself." />
        <Step label="Activate portal → contracting → training → production → ownership path" />
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
        <GradientButton asChild className="w-full text-base h-14" size="lg">
          <a href={SCHEDULING_LINKS.licensed} target="_blank" rel="noopener noreferrer" className="block">
            <Calendar className="h-5 w-5 mr-2" />
            Book your brokerage activation call
          </a>
        </GradientButton>
      )}

      {/* One-click auto-login into the agent portal — Sam directive
          2026-06-15: "They're logged in and everything like that." For
          licensed applicants the destination is /dashboard (training course
          is for unlicensed). Hidden until the magic-link mint returns. */}
      {autoLoginUrl ? (
        <GradientButton asChild variant="outline" className="w-full" size="lg">
          <a href={autoLoginUrl} className="block">
            <Sparkles className="h-4 w-4 mr-2" />
            Activate portal &amp; start contracting
          </a>
        </GradientButton>
      ) : null}

      <p className="text-xs text-center text-muted-foreground">
        Slack and Discord access is issued after you are hired and your {BRAND.shortName} identity
        is verified — you'll get both links by email at that point. Income is not guaranteed;
        advancement follows licensing, activity, production, and leadership execution.
      </p>
    </div>
  );
}

// ---------- Pending (license status unknown) ----------

function PendingBody() {
  // This branch previously had the Telegram link as its ONLY call to action, so
  // removing it would have left an applicant with nowhere to go. Booking a call
  // is the step that actually resolves an unknown license status.
  return (
    <div className="space-y-4">
      <p className="text-sm text-center text-muted-foreground">
        Your manager will reach out shortly to verify license status and route you to the right next step.
      </p>
      <GradientButton asChild variant="outline" className="w-full" size="lg">
        <a href={SCHEDULING_LINKS.unlicensed} target="_blank" rel="noopener noreferrer" className="block">
          <Calendar className="h-4 w-4 mr-2" />
          Book a call now
        </a>
      </GradientButton>
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
