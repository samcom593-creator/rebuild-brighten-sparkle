import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { motion } from "framer-motion";
import {
  Crown,
  PlayCircle,
  FileText,
  GraduationCap,
  Calendar,
  CheckCircle2,
  BookOpen,
  ArrowRight,
  DollarSign,
  Clock,
  ShieldCheck,
  LifeBuoy,
  Circle,
  Play,
  Download,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { SCHEDULING_LINKS } from "@/lib/apexConfig";
import { supabase } from "@/integrations/supabase/client";

// Canonical overview video — MUST match BUMP_VERSION suffix (E2VJ1v85IRE).
// Sam directive 2026-06-07: single video ID everywhere.
const OVERVIEW_VIDEO_ID = "E2VJ1v85IRE";
const OVERVIEW_VIDEO_TITLE = "Getting Licensed with APEX — Sam James";

// Existing partner/course/document URLs (previously hard-coded in this page).
// Kept identical so no live behavior regresses for applicants clicking through.
const LICENSING_DOCUMENT_URL =
  "https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit?usp=sharing";
const XCEL_COURSE_URL_FALLBACK = "https://partners.xcelsolutions.com/afe";

// Applicant progress snapshot — only real columns from applications table.
// If the applicant is not authenticated (RLS blocks the read) we render
// every step as "Not yet started" — never fake completion.
interface ApplicantProgress {
  course_purchased_at: string | null;
  course_started_at: string | null;
  exam_scheduled_at: string | null;
  exam_passed_at: string | null;
  fingerprints_submitted_at: string | null;
  fingerprint_done: boolean | null;
  licensed_at: string | null;
  license_status: string | null;
  license_progress: string | null;
  first_name: string | null;
}

// Local LazyYouTube — mirrors the pattern in HeroSection so we don't pull
// the SDK on first paint. Keeps LCP tight on mobile even though this page
// is behind a CTA click.
function LazyOverviewVideo({
  videoId,
  title,
}: {
  videoId: string;
  title: string;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative aspect-video rounded-md overflow-hidden border border-border/60 bg-black">
      {loaded ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
        />
      ) : (
        <button
          type="button"
          onClick={() => setLoaded(true)}
          aria-label={`Play ${title}`}
          className="absolute inset-0 w-full h-full flex items-center justify-center group"
        >
          <img
            src={`/img/hero-poster-${videoId}.jpg`}
            alt={title}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <span className="absolute inset-0 bg-black/40 group-hover:bg-black/30 transition-colors" />
          <span className="relative h-16 w-16 rounded-full bg-primary/95 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Play className="h-8 w-8 text-primary-foreground fill-primary-foreground ml-1" />
          </span>
        </button>
      )}
    </div>
  );
}

// Try to fetch progress. If email isn't provided or RLS blocks the read
// we resolve to null — every checklist item then renders as "Not yet started".
async function fetchApplicantProgress(
  applicationId: string | null,
  email: string | null,
): Promise<ApplicantProgress | null> {
  if (!applicationId && !email) return null;
  const query = supabase
    .from("applications")
    .select(
      "course_purchased_at,course_started_at,exam_scheduled_at,exam_passed_at,fingerprints_submitted_at,fingerprint_done,licensed_at,license_status,license_progress,first_name",
    )
    .limit(1);
  const scoped = applicationId
    ? query.eq("id", applicationId)
    : query.eq("email", email!.toLowerCase());
  const { data, error } = await scoped.maybeSingle();
  if (error || !data) return null;
  return data as ApplicantProgress;
}

// Ordered checklist mapping — each key maps to a real timestamp column.
const CHECKLIST: Array<{
  key: keyof Pick<
    ApplicantProgress,
    | "course_purchased_at"
    | "course_started_at"
    | "exam_scheduled_at"
    | "fingerprints_submitted_at"
    | "licensed_at"
  >;
  label: string;
  hint: string;
}> = [
  { key: "course_purchased_at", label: "Application", hint: "Your application is in" },
  { key: "course_started_at", label: "Study", hint: "Course launched" },
  { key: "exam_scheduled_at", label: "Exam booking", hint: "State exam scheduled" },
  { key: "fingerprints_submitted_at", label: "Fingerprints", hint: "Fingerprints on file" },
  { key: "licensed_at", label: "License issued", hint: "You're licensed" },
];

function stepStatus(
  progress: ApplicantProgress | null,
  key: (typeof CHECKLIST)[number]["key"],
): { done: boolean; ts: string | null } {
  if (!progress) return { done: false, ts: null };
  const raw = progress[key];
  // fingerprints_submitted_at is nullable but fingerprint_done boolean may
  // be true independently on the row — treat either signal as complete.
  if (key === "fingerprints_submitted_at" && progress.fingerprint_done) {
    return { done: true, ts: raw ?? null };
  }
  return { done: !!raw, ts: raw ?? null };
}

const TRUST_CARDS: Array<{
  icon: typeof DollarSign;
  title: string;
  detail: string;
  tint: string;
  iconClass: string;
}> = [
  {
    icon: DollarSign,
    title: "We Cover Licensing Costs",
    detail: "No upfront course fee. APEX pays it.",
    tint: "border-amber-500/25 bg-amber-500/[0.03]",
    iconClass: "text-amber-400",
  },
  {
    icon: Clock,
    title: "2–4 Week Timeline",
    detail: "From enrollment to license issued.",
    tint: "border-teal-500/25 bg-teal-500/[0.03]",
    iconClass: "text-teal-400",
  },
  {
    icon: BookOpen,
    title: "Full Training Provided",
    detail: "Scripts, playbooks, live closes.",
    tint: "border-info/30 bg-info/[0.03]",
    iconClass: "text-info",
  },
  {
    icon: ShieldCheck,
    title: "No Upfront Cost",
    detail: "Nothing on your card to start.",
    tint: "border-emerald-500/25 bg-emerald-500/[0.03]",
    iconClass: "text-emerald-400",
  },
  {
    icon: LifeBuoy,
    title: "Support Through Exam",
    detail: "Text your manager anytime.",
    tint: "border-purple-500/25 bg-purple-500/[0.03]",
    iconClass: "text-purple-400",
  },
];

const POST_LICENSE_STEPS = [
  { title: "Contracting", detail: "Carrier appointments start" },
  { title: "Training", detail: "Product + sales onboarding" },
  { title: "Field Onboarding", detail: "Shadow live closes" },
  { title: "First Sales Activity", detail: "Dial + write your first policy" },
];

export default function GetLicensed() {
  usePageTitle("Get Licensed · Start Your APEX Career");
  const [searchParams] = useSearchParams();
  const applicationId = searchParams.get("applicationId");
  const email = searchParams.get("email");
  const [progress, setProgress] = useState<ApplicantProgress | null>(null);
  const [loading, setLoading] = useState<boolean>(!!(applicationId || email));

  useEffect(() => {
    let cancelled = false;
    if (!applicationId && !email) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      const snap = await fetchApplicantProgress(applicationId, email);
      if (cancelled) return;
      setProgress(snap);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId, email]);

  const isLicensed = !!progress?.licensed_at || progress?.license_status === "licensed";

  const courseUrl = email
    ? `${XCEL_COURSE_URL_FALLBACK}?email=${encodeURIComponent(email)}`
    : XCEL_COURSE_URL_FALLBACK;

  const onboardingCallUrl = SCHEDULING_LINKS.licensed;
  const firstName = progress?.first_name?.trim();

  return (
    <main className="min-h-screen bg-background py-6 sm:py-10 px-3 sm:px-4">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,hsl(168_84%_42%/0.08)_0%,transparent_55%)]" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-5xl mx-auto relative z-10"
      >
        {/* Header */}
        <header className="text-center mb-8 sm:mb-10">
          <Link to="/" className="inline-flex items-center gap-2 mb-5">
            <Crown className="h-8 w-8 sm:h-10 sm:w-10 text-primary" />
            <span className="text-xl sm:text-2xl font-bold gradient-text">
              APEX Financial
            </span>
          </Link>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 leading-tight">
            {firstName ? (
              <>
                {firstName}, your path to{" "}
                <span className="gradient-text">Getting Licensed</span>
              </>
            ) : (
              <>
                Your Path to{" "}
                <span className="gradient-text">Getting Licensed</span>
              </>
            )}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Complete the steps below to start your insurance career with APEX.
            Licensing costs are covered.
          </p>
          {isLicensed ? (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              License on file — jump to Once Licensed below
            </div>
          ) : null}
        </header>

        {/* 3 Progress Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 sm:mb-8">
          {/* Step 1 — Watch Overview */}
          <GlassCard className="p-5 sm:p-6 flex flex-col">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-mono tracking-wider text-primary/80">
                01
              </span>
              <span className="h-px flex-1 bg-border/40" />
              <span className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center">
                <PlayCircle className="h-5 w-5 text-primary" />
              </span>
            </div>
            <h2 className="font-bold text-base mb-1.5">
              Watch the Overview Video
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              3-minute welcome from Sam James — how APEX works and what to
              expect.
            </p>

            <div className="mt-auto">
              <LazyOverviewVideo
                videoId={OVERVIEW_VIDEO_ID}
                title={OVERVIEW_VIDEO_TITLE}
              />
              <p className="text-xs text-muted-foreground mt-3 italic">
                This is the same video every APEX agent watches on day one.
              </p>
              {/* No viewed_overview_at column exists on applications — per
                  spec, no fake completion button here. */}
            </div>
          </GlassCard>

          {/* Step 2 — Licensing Guide */}
          <GlassCard className="p-5 sm:p-6 flex flex-col">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-mono tracking-wider text-primary/80">
                02
              </span>
              <span className="h-px flex-1 bg-border/40" />
              <span className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center">
                <FileText className="h-5 w-5 text-primary" />
              </span>
            </div>
            <h2 className="font-bold text-base mb-1.5">
              Review Licensing Guide
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Every step laid out in one document. Application through license
              issued.
            </p>

            <div className="flex flex-col gap-2 mb-4">
              <GradientButton asChild variant="outline" className="w-full h-11 text-sm">
                <a
                  href={LICENSING_DOCUMENT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  View Licensing Document
                  <ArrowUpRight className="h-3.5 w-3.5 ml-auto opacity-70" />
                </a>
              </GradientButton>
              <a
                href={LICENSING_DOCUMENT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-6 items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Download className="h-3 w-3" />
                Or download a copy
              </a>
            </div>

            {/* Checklist — real column data or "Not yet started" */}
            <ul className="mt-auto space-y-1.5 rounded-md border border-border/40 bg-muted/10 p-3">
              {CHECKLIST.map((item) => {
                const { done, ts } = stepStatus(progress, item.key);
                return (
                  <li
                    key={item.key}
                    className="flex items-start gap-2 text-xs"
                    data-testid={`checklist-${item.key}`}
                  >
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground/60 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={
                            done
                              ? "text-emerald-300/90 font-medium"
                              : "text-foreground/85 font-medium"
                          }
                        >
                          {item.label}
                        </span>
                        <span
                          className={
                            done
                              ? "text-[10px] text-emerald-400/70 uppercase tracking-wider"
                              : "text-[10px] text-muted-foreground uppercase tracking-wider"
                          }
                        >
                          {loading
                            ? "Loading"
                            : done
                              ? "Complete"
                              : "Not yet started"}
                        </span>
                      </div>
                      {done && ts ? (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(ts).toLocaleDateString()}
                        </p>
                      ) : (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {item.hint}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </GlassCard>

          {/* Step 3 — Course */}
          <GlassCard className="p-5 sm:p-6 flex flex-col">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-mono tracking-wider text-primary/80">
                03
              </span>
              <span className="h-px flex-1 bg-border/40" />
              <span className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center">
                <GraduationCap className="h-5 w-5 text-primary" />
              </span>
            </div>
            <h2 className="font-bold text-base mb-1.5">
              Complete Pre-Licensing Course
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              The state requires a pre-licensing course before you can take the
              exam. APEX covers this cost — no upfront payment from you.
            </p>

            <div className="mt-auto space-y-3">
              <GradientButton asChild className="w-full h-12 text-sm">
                <a href={courseUrl} target="_blank" rel="noopener noreferrer">
                  <Sparkles className="h-4 w-4 mr-2" />
                  Start Your Course
                  <ArrowRight className="h-4 w-4 ml-auto" />
                </a>
              </GradientButton>
              <div className="rounded-md border border-border/40 bg-muted/20 p-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                  Included
                </p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    Course cost covered
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    Study plan + practice exams
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    Manager support through exam day
                  </li>
                </ul>
              </div>
              {/* support_email column doesn't exist in system_settings —
                  skip the support contact link rather than fake it. */}
            </div>
          </GlassCard>
        </div>

        {/* Trust cards row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {TRUST_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className={`rounded-md border p-3 sm:p-4 flex flex-col items-start gap-2 ${card.tint}`}
              >
                <span
                  className={`h-8 w-8 rounded-md bg-background/60 flex items-center justify-center ${card.iconClass}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-semibold leading-tight">
                    {card.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                    {card.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Once Licensed section — preview when unlicensed, active when
            licensed_at is set. Never hidden entirely (applicants should see
            what's coming). */}
        <GlassCard
          className={
            isLicensed
              ? "p-5 sm:p-8 border-2 border-emerald-500/40 bg-emerald-500/5"
              : "p-5 sm:p-8 border border-border/40"
          }
        >
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Calendar
                  className={
                    isLicensed
                      ? "h-5 w-5 text-emerald-400"
                      : "h-5 w-5 text-primary"
                  }
                />
                <h2 className="text-lg sm:text-xl font-bold">
                  What Happens After You&apos;re Licensed
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                {isLicensed
                  ? "You're cleared. Book your onboarding call — Discord + contracting arrive the same day."
                  : "Preview of the activation path once your license is issued."}
              </p>
            </div>
            {isLicensed ? (
              <Badge
                variant="outline"
                className="border-emerald-500/40 text-emerald-300 self-start"
              >
                Ready to onboard
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-border/40 text-muted-foreground self-start"
              >
                Preview
              </Badge>
            )}
          </div>

          {/* Timeline — vertical mobile, horizontal desktop */}
          <ol className="flex flex-col md:flex-row md:items-stretch gap-3 mb-6">
            {POST_LICENSE_STEPS.map((step, i) => (
              <li
                key={step.title}
                className="flex-1 rounded-md border border-border/40 bg-muted/10 p-3 flex md:flex-col items-start gap-3 md:gap-2"
              >
                <span className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{step.title}</p>
                  <p className="text-xs text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
            <li className="flex-1 rounded-md border-2 border-primary/40 bg-primary/5 p-3 flex md:flex-col items-start gap-3 md:gap-2">
              <span className="h-7 w-7 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                5
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Book Onboarding Call</p>
                <p className="text-xs text-muted-foreground">
                  Get contracted + Discord invite
                </p>
              </div>
            </li>
          </ol>

          <GradientButton asChild className="w-full h-12 sm:h-14 text-sm sm:text-base" size="lg">
            <a href={onboardingCallUrl} target="_blank" rel="noopener noreferrer">
              <Calendar className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
              Book Your Onboarding Call
              <ArrowRight className="h-4 w-4 ml-auto" />
            </a>
          </GradientButton>
        </GlassCard>

        {/* Full training resources — kept from prior page so existing deep
            links and recorded training notes still land somewhere. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-6"
        >
          <Link to="/resources/licensing" className="block group">
            <GlassCard className="p-5 border border-primary/20 hover:border-primary/50 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm mb-0.5">
                    Full training resources
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Scripts, playbooks, PDFs, and recorded closes from the APEX
                    training team.
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-primary group-hover:translate-x-1 transition-transform shrink-0" />
              </div>
            </GlassCard>
          </Link>
        </motion.div>

        <p className="text-center text-xs italic text-muted-foreground mt-8">
          Hold the Standard. Average is the disease.
        </p>
      </motion.div>
    </main>
  );
}
