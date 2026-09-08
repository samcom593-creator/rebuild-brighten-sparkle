// ApplicantHome — what a login with NO agents row sees at /dashboard.
//
// Applying mints a login (role agent) and the confirmation page one-click
// signs the applicant in. Until 2026-09-07 that login landed on the producer
// Command Center, which needs an agents row an applicant does not have, and
// rendered "We're finishing your profile — Email Sam". 399 logins were in that
// state, 2 the day this shipped, and Sam was on the phone with one of them.
//
// This page answers the only three questions an applicant has: what is my
// status, what do I do next, and how do I reach the team. Every button is a
// route or link that exists today. Nothing here needs an agents row.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  BookOpenCheck, CalendarCheck, Crown, FileSearch, GraduationCap, MessageSquare,
  Phone, PlayCircle, ShieldCheck, Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { APEX_BRAND } from "@/config/brand";
import { LICENSING_COURSE_URL, SCHEDULING_LINKS, TEAM_COMMUNITY_LINKS } from "@/lib/apexConfig";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NextStepCard } from "@/components/dashboard/NextStepCard";

interface MyApplication {
  id: string;
  first_name: string | null;
  status: string | null;
  license_progress: string | null;
  license_status: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  new: "Application received",
  contacted: "We've reached out",
  interview_scheduled: "Interview scheduled",
  interviewed: "Interview done",
  accepted: "Accepted",
  hired: "Accepted — onboarding",
  onboarding: "Onboarding",
  rejected: "Application closed",
  disqualified: "Application closed",
  no_pickup: "We couldn't reach you — book a call",
};

const LICENSE_LABEL: Record<string, string> = {
  unlicensed: "Not licensed yet",
  course_purchased: "Licensing course purchased",
  in_course: "In the licensing course",
  finished_course: "Course finished — schedule your exam",
  exam_scheduled: "Exam scheduled",
  passed_exam: "Exam passed — apply for your license",
  licensed: "Licensed",
};

// ApplicantHome renders for a logged-in user with NO agents row — an applicant,
// never a VA — and this is APEX's own number. phoneHref/smsHref exist so an
// operator's dialer-less desktop can dial OUT through Sam's Google Voice; pointed
// inbound they would ask the applicant to sign into Google and provision their own
// Voice line just to reach us. Every other site linking this number (Footer,
// CalendlyEmbed, Contact, Storefront) links it raw for the same reason.
// contact-scheme-allow: inbound control on a non-operator surface — applicant reaching APEX's own number, native handoff is correct here
const SAM_PHONE = { display: "(469) 767-6068", tel: "tel:+14697676068", sms: "sms:+14697676068" };

function prettify(value: string | null | undefined, map: Record<string, string>): string | null {
  if (!value) return null;
  return map[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Step {
  key: string;
  icon: typeof GraduationCap;
  title: string;
  body: string;
  primary: { label: string; href: string; external?: boolean };
  secondary?: { label: string; href: string; external?: boolean };
}

function stepsFor(app: MyApplication, licensed: boolean): Step[] {
  const community: Step = {
    key: "community",
    icon: MessageSquare,
    title: "Join the team Slack",
    body: "Slack is where the team talks every day — questions, wins, and the daily meeting link. Discord carries the live rooms.",
    primary: { label: "Join Slack", href: TEAM_COMMUNITY_LINKS.slack, external: true },
    secondary: { label: "Join Discord", href: TEAM_COMMUNITY_LINKS.discord, external: true },
  };
  const status: Step = {
    key: "status",
    icon: FileSearch,
    title: "Track your application",
    body: "Your status page updates as the team moves you forward.",
    primary: { label: "Open my status", href: `/status/${app.id}` },
  };
  if (licensed) {
    return [
      {
        key: "contracting",
        icon: ShieldCheck,
        title: "Start contracting",
        body: "You're licensed, so contracting is the only thing between you and writing business. Takes about ten minutes.",
        primary: { label: "Start contracting", href: "/start-contracting" },
      },
      community,
      {
        key: "call",
        icon: CalendarCheck,
        title: "Book your onboarding call",
        body: "A short call with our onboarding manager to get your systems, dialer, and first week set up.",
        primary: { label: "Book the call", href: SCHEDULING_LINKS.onboarding, external: true },
      },
      {
        key: "training",
        icon: BookOpenCheck,
        title: "Start training",
        body: "The field course and the training library are open to you now.",
        primary: { label: "Open training", href: "/dashboard/training/library" },
        secondary: { label: "Field course", href: "/dashboard/training/sales-course" },
      },
      status,
    ];
  }
  return [
    {
      key: "license",
      icon: GraduationCap,
      title: "Get your life insurance license",
      body: "Start the pre-licensing course, then watch the six-minute walkthrough that shows the whole path from course to exam to license. Once you've purchased the course, post a screenshot of the confirmation in #unlicensed on Slack — that's how we verify it and move you forward.",
      primary: { label: "Start the licensing course", href: LICENSING_COURSE_URL, external: true },
      secondary: { label: "Watch the walkthrough", href: "/get-licensed#licensing-video" },
    },
    {
      key: "community",
      icon: MessageSquare,
      title: "Join Slack, then open #unlicensed",
      body: "Accept the Slack invite, then open the #unlicensed channel — that's your room until you're licensed. Post your course-purchase screenshot there, ask anything, and catch the daily meeting link.",
      primary: { label: "Join Slack", href: TEAM_COMMUNITY_LINKS.slack, external: true },
      secondary: { label: "Open #unlicensed", href: TEAM_COMMUNITY_LINKS.slackUnlicensedChannel, external: true },
    },
    {
      key: "call",
      icon: CalendarCheck,
      title: "Book your call",
      body: "Fifteen minutes with the team to answer your questions and map your first 30 days.",
      primary: { label: "Book my call", href: SCHEDULING_LINKS.unlicensed, external: true },
    },
    status,
  ];
}

function ActionLink({ href, external, children, variant = "default" }: {
  href: string; external?: boolean; children: React.ReactNode; variant?: "default" | "outline";
}) {
  const className = variant === "default"
    ? "bg-primary text-primary-foreground hover:bg-primary/90"
    : "";
  if (external) {
    return (
      <Button asChild size="sm" variant={variant} className={className}>
        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      </Button>
    );
  }
  return (
    <Button asChild size="sm" variant={variant} className={className}>
      <Link to={href}>{children}</Link>
    </Button>
  );
}

export function ApplicantHome() {
  const { user } = useAuth();
  const email = user?.email ?? null;

  const { data: app, isLoading, isError } = useQuery({
    queryKey: ["my-application", email],
    enabled: !!email,
    queryFn: async (): Promise<MyApplication | null> => {
      // RLS policy "Applicants can view own application by email" compares the
      // row's email to the JWT email exactly; submit-application stores lowercase.
      const { data, error } = await supabase
        .from("applications")
        .select("id, first_name, status, license_progress, license_status, created_at")
        .eq("email", email!)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as MyApplication | undefined) ?? null;
    },
  });

  if (isLoading) {
    return (
      <div className="page-enter px-4 sm:px-6 pb-24 space-y-4">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!app || isError) {
    return (
      <div className="page-enter px-4 sm:px-6 pb-24">
        <PageHeader
          eyebrow="Welcome" eyebrowIcon={<Crown className="h-3 w-3" />}
          title="Your login works — it just isn't connected to an application yet"
          subtitle={`This happens when the email you signed in with is different from the one on your application. Two ways to fix it in under a minute.`}
          accent="amber"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Users className="h-4 w-4 text-primary" /> Apply with this email</div>
            <p className="mt-2 text-sm text-muted-foreground">Takes three minutes. Your steps appear here the moment it's in.</p>
            <div className="mt-4"><ActionLink href="/apply">Apply now</ActionLink></div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Phone className="h-4 w-4 text-primary" /> Call or text Sam</div>
            <p className="mt-2 text-sm text-muted-foreground">Direct line, no funnel. Say the email you applied with and we'll connect it.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ActionLink href={SAM_PHONE.tel} external>Call {SAM_PHONE.display}</ActionLink>
              <ActionLink href={SAM_PHONE.sms} external variant="outline">Text {SAM_PHONE.display}</ActionLink>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const licensed = app.license_progress === "licensed" || app.license_status === "licensed";
  const steps = stepsFor(app, licensed);
  const statusLabel = prettify(app.status, STATUS_LABEL);
  const licenseLabel = prettify(app.license_progress, LICENSE_LABEL);
  const firstName = app.first_name?.trim() || "there";
  const appliedOn = new Date(app.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="page-enter px-4 sm:px-6 pb-24">
      <PageHeader
        eyebrow={`${APEX_BRAND.shortName} · Your next steps`} eyebrowIcon={<Crown className="h-3 w-3" />}
        title={`Welcome, ${firstName} — here's exactly what's next`}
        subtitle={licensed
          ? "You're licensed. Contracting, Slack, and your onboarding call are the three things that get you in the field this week."
          : "Get licensed, get into Slack, book your call. Do them in order and you'll be in the field in a few weeks."}
        accent="primary"
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Applied {appliedOn}</span>
        {statusLabel && <Badge variant="outline" className="border-primary/40 text-primary">{statusLabel}</Badge>}
        {licenseLabel && <Badge variant="outline" className="border-border text-muted-foreground">{licenseLabel}</Badge>}
      </div>

      <div className="mb-6">
        <NextStepCard application_id={app.id} />
      </div>

      <ol className="grid gap-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.key} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary tabular-nums">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
                    <Icon className="h-4 w-4 text-primary" /> {step.title}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionLink href={step.primary.href} external={step.primary.external}>
                      {step.primary.external && step.key === "license" ? <PlayCircle className="mr-1.5 h-3.5 w-3.5" /> : null}
                      {step.primary.label}
                    </ActionLink>
                    {step.secondary && (
                      <ActionLink href={step.secondary.href} external={step.secondary.external} variant="outline">
                        {step.secondary.label}
                      </ActionLink>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 rounded-2xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">Stuck on anything?</span> Call or text Sam at{" "}
        <a className="text-primary underline-offset-2 hover:underline" href={SAM_PHONE.tel}>{SAM_PHONE.display}</a>. Direct line.
      </div>
    </div>
  );
}
