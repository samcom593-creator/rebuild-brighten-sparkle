import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Crown, Calendar, Sparkles } from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { CalendlyEmbed } from "@/components/landing/CalendlyEmbed";
import { SCHEDULING_LINKS, buildBookingUrl, getCalendlyHostName } from "@/lib/apexConfig";
import { useApplicationStatus, type ApplicationManager } from "@/hooks/useApplicationStatus";
import { LicensingProofStep, type OwnerContact } from "@/components/landing/LicensingProofStep";
import { supabase } from "@/integrations/supabase/client";
import { CONTRACTING_PROFILE_PATH } from "@/lib/contractingLinks";
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
 * the team to Slack.
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
  // useApplicationStatus is a react-query result: the snapshot lives on .data.
  const { data: snap, isLoading } = useApplicationStatus(applicationId);

  // On /status/:id nothing forces the branch, so the license status has to
  // come from the snapshot. Until it arrives we must not guess "unlicensed",
  // or a licensed applicant is briefly told to start the licensing course and
  // the magic link is minted for the wrong destination.
  const statusPending = !forceLicenseStatus && !!applicationId && isLoading;

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
    if (!applicationId || statusPending) {
      setAutoLoginUrl(null);
      return () => {
        cancelled = true;
      };
    }
    // The edge fn looks up email by applicationId server-side — we don't
    // need to wait for the status snapshot to load.
    const redirectPath =
      license === "licensed" ? CONTRACTING_PROFILE_PATH : "/get-licensed#licensing-video";

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
  }, [applicationId, license, statusPending]);

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
              <span className="text-base font-semibold gradient-text">Galaxy Financial</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold leading-tight">
              {firstName ? <>{firstName}, your application is <span className="gradient-text">in.</span></> : <>Application <span className="gradient-text">received.</span></>}
            </h1>
          </div>

          {/* Branched body */}
          {statusPending ? (
            <p className="text-center text-sm text-muted-foreground" role="status">
              Loading your next step...
            </p>
          ) : (
            <>
              {license === "licensed" ? <LicensedBody applicationId={applicationId} showCalendly={showCalendly} autoLoginUrl={autoLoginUrl} firstName={snap?.first_name} lastName={snap?.last_name} /> : null}
              {license === "unlicensed" ? <UnlicensedBody applicationId={applicationId} autoLoginUrl={autoLoginUrl} firstName={snap?.first_name} lastName={snap?.last_name} manager={snap?.manager ?? null} /> : null}
              {license === "pending" ? <PendingBody applicationId={applicationId} firstName={snap?.first_name} lastName={snap?.last_name} manager={snap?.manager ?? null} /> : null}
            </>
          )}

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

/** The recruiter the snapshot already exposes to this applicant (same data as the welcome email). */
function ownerFrom(manager: ApplicationManager | null | undefined): OwnerContact | null {
  if (!manager || (!manager.phone && !manager.email)) return null;
  return { name: (manager.display_name || "your recruiter").split(" ")[0], phone: manager.phone, email: manager.email };
}

// Slack policy (Sam 2026-09-07, MP-357): unlicensed applicants belong in #unlicensed for
// questions and the daily meeting link. The invite stays OFF this public page and arrives by
// email; receipts never go to Slack.
const SLACK_LINE = "Your Slack invite is in your welcome email. Join #unlicensed for questions and the daily meeting link.";

function UnlicensedBody({
  applicationId,
  autoLoginUrl,
  firstName,
  lastName,
  manager,
}: {
  applicationId: string | null;
  autoLoginUrl: string | null;
  firstName?: string | null;
  lastName?: string | null;
  manager: ApplicationManager | null;
}) {
  // Identify the applicant on /get-licensed by application id, the param
  // GetLicensed reads (and the one JoinLink already passes). The status
  // snapshot carries no email, so an email param could never be filled.
  const courseUrl = applicationId
    ? `/get-licensed?applicationId=${encodeURIComponent(applicationId)}#licensing-video`
    : "/get-licensed#licensing-video";

  // Step 1 opens in a NEW TAB: when the magic-link mint succeeded it auto-logs the
  // applicant in and lands on the licensing video; otherwise the plain /get-licensed link.
  // Either way this page (upload + booking) stays open behind it.
  const videoHref = autoLoginUrl ?? courseUrl;

  return (
    <div className="space-y-5">
      {/* WP2: ONE ordered list (video, course, receipt, licensing call) plus an always-visible
          human path. Sam 2026-11-10: the receipt is what unlocks the licensing call. */}
      <LicensingProofStep
        applicationId={applicationId}
        firstName={firstName}
        lastName={lastName}
        videoHref={videoHref}
        owner={ownerFrom(manager)}
      />

      <p className="text-xs text-center text-muted-foreground">{SLACK_LINE}</p>
      <p className="text-xs text-center text-muted-foreground">
        We also sent these steps to your email. Check inbox + spam.
      </p>
    </div>
  );
}

// ---------- Licensed ----------

function LicensedBody({
  applicationId,
  showCalendly,
  autoLoginUrl,
  firstName,
  lastName,
}: {
  applicationId: string | null;
  showCalendly: boolean;
  autoLoginUrl: string | null;
  firstName?: string | null;
  lastName?: string | null;
}) {
  // v9 wave-C complaint #6: applicants land on a Calendly with no idea who
  // they're booking with. Derive host name from the URL slug.
  const calendlyHost = getCalendlyHostName(SCHEDULING_LINKS.licensed);
  // WP2: prefill + utm_content=<application id> so the booking lands on this application.
  // A licensed applicant is NEVER gated: the call is always bookable here.
  const licensedUrl = buildBookingUrl(SCHEDULING_LINKS.licensed, { applicationId, firstName, lastName });
  return (
    <div className="space-y-6">
      {/* The path */}
      <div className="rounded-md border border-border/40 bg-muted/20 p-4 sm:p-5 space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Activation path</p>
        <Step done label="Application received" />
        <Step current label="Book your hire call" detail="The fastest path to your first check." />
        <Step label="Activate portal → submit contracting → complete training" />
      </div>

      {/* Host disclosure — applicant should know whose calendar this is */}
      <p className="text-center text-sm">
        <span className="text-muted-foreground">You're booking with: </span>
        <span className="font-semibold text-foreground">{calendlyHost}</span>
      </p>

      {/* Primary CTA: Calendly */}
      {showCalendly ? (
        <section className="rounded-md overflow-hidden border border-border/50 bg-background/50">
          <CalendlyEmbed url={licensedUrl} />
        </section>
      ) : (
        <GradientButton asChild className="w-full text-base h-14" size="lg">
          <a href={licensedUrl} target="_blank" rel="noopener noreferrer" className="block">
            <Calendar className="h-5 w-5 mr-2" />
            Book your hire call
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
        Slack access is issued after you are hired and your {BRAND.shortName} identity
        is verified — you'll get both links by email at that point.
      </p>
    </div>
  );
}

// ---------- Pending (license status unknown) ----------

function PendingBody({
  applicationId,
  firstName,
  lastName,
  manager,
}: {
  applicationId: string | null;
  firstName?: string | null;
  lastName?: string | null;
  manager: ApplicationManager | null;
}) {
  // WP2: the same gate as the unlicensed branch, so "pending" is not a side door around the
  // receipt step, and the same always-visible human path for someone mid-way through.
  return (
    <div className="space-y-4">
      <p className="text-sm text-center text-muted-foreground">
        Your manager will reach out to verify your license status and route you to the right next step.
      </p>
      <LicensingProofStep
        applicationId={applicationId}
        firstName={firstName}
        lastName={lastName}
        owner={ownerFrom(manager)}
        intro="Already bought or finished the course? Upload the receipt or completion certificate to unlock the licensing call. Still deciding? Ask us below."
      />
      <p className="text-xs text-center text-muted-foreground">{SLACK_LINE}</p>
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
