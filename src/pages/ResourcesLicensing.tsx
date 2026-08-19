import { Link } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { motion } from "framer-motion";
import {
  Crown,
  FileText,
  GraduationCap,
  Headphones,
  BookOpen,
  ExternalLink,
  ArrowLeft,
  Sparkles,
  Award,
  Mic,
  ClipboardCheck,
} from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";

/**
 * ResourcesLicensing — mirrors apex-resources.vercel.app content into
 * apex-financial.org so applicants + licensed agents get the full
 * training + resource library without leaving the main site.
 *
 * Source: /Users/samjames/business-ops/knowledge/apex-resources-harvest-2026-07-01.md
 * Harvested from apex-resources.vercel.app on 2026-07-01.
 *
 * Sections rendered:
 *   1. Courses (core curriculum + onboarding)
 *   2. PDFs (playbook, needs analysis, residual income)
 *   3. Guides / Scripts (Senior + Veteran)
 *   4. Recorded presentations (audio + transcripts, by presenter)
 *   5. Quick links (Admin, Readymode, AgentLink, Recruits sheet)
 */

const HUB_URL = "https://apex-resources.vercel.app";

type Course = {
  title: string;
  presenter: string;
  role: string;
  category: string;
  description: string;
  lessons: string;
  duration: string;
  url: string;
};

const COURSES: Course[] = [
  {
    title: "APEX Financial Release Course",
    presenter: "APEX Training Team",
    role: "Recorded Curriculum",
    category: "Core Curriculum",
    description:
      "Once you have been released from training, complete this course to start producing.",
    lessons: "5 lessons",
    duration: "41 min",
    url: `${HUB_URL}/#library`,
  },
  {
    title: "APEX Onboarding Course",
    presenter: "Sam",
    role: "Agency Owner",
    category: "Onboarding",
    description:
      "Required before live training. Gets you accustomed to the APEX script and sales process.",
    lessons: "4 lessons",
    duration: "self-paced",
    url: `${HUB_URL}/#library`,
  },
  {
    title: "Training Course",
    presenter: "Obi",
    role: "Senior Producer",
    category: "Core Curriculum",
    description: "The recorded live training. Watch, take notes, practice.",
    lessons: "1 lesson",
    duration: "full session",
    url: `${HUB_URL}/#library`,
  },
];

type PdfResource = {
  title: string;
  subtitle: string;
  date: string;
  isNew: boolean;
  url: string;
};

const PDFS: PdfResource[] = [
  {
    title: "The Long Game",
    subtitle: "How Residual Income Works in Life Insurance",
    date: "May 29, 2026",
    isNew: true,
    url: `${HUB_URL}/#library`,
  },
  {
    title: "APEX Agent Playbook",
    subtitle:
      "The official APEX playbook — start-to-finish guide to onboarding, daily activity, and the systems that drive production.",
    date: "May 28, 2026",
    isNew: true,
    url: `${HUB_URL}/#library`,
  },
  {
    title: "Needs Analysis Quiz",
    subtitle:
      "A quick client needs-analysis quiz to uncover the real coverage gap before you present.",
    date: "May 28, 2026",
    isNew: true,
    url: `${HUB_URL}/#library`,
  },
];

type Script = {
  title: string;
  subtitle: string;
  date: string;
  url: string;
};

const SCRIPTS: Script[] = [
  {
    title: "APEX Script 3.0 — Senior Benefits",
    subtitle:
      "Current Senior State Benefits / life insurance phone script — intro through the close.",
    date: "May 26, 2026",
    url: `${HUB_URL}/#library`,
  },
  {
    title: "APEX Script — Veterans (VA Benefits)",
    subtitle:
      "Veteran burial-coverage opener and full call flow for VA-benefit prospects.",
    date: "May 24, 2026",
    url: `${HUB_URL}/#library`,
  },
];

type Recording = {
  title: string;
  category: string;
  presenter: string;
  role: string;
  date: string;
  hasTranscript: boolean;
};

const RECORDINGS: Recording[] = [
  {
    title: "Vet Close 3",
    category: "General",
    presenter: "APEX Training Team",
    role: "Recorded Trainer",
    date: "Jun 22, 2026",
    hasTranscript: true,
  },
  {
    title: "Vet Close 2",
    category: "Vet",
    presenter: "APEX Training Team",
    role: "Recorded Trainer",
    date: "Jun 18, 2026",
    hasTranscript: true,
  },
  {
    title: "Vet Close 1",
    category: "Vet",
    presenter: "APEX Training Team",
    role: "Recorded Trainer",
    date: "Jun 17, 2026",
    hasTranscript: true,
  },
  {
    title: "Vet Close",
    category: "General",
    presenter: "Aisha",
    role: "Top Producer",
    date: "Jun 11, 2026",
    hasTranscript: true,
  },
  {
    title: "Vet Close",
    category: "General",
    presenter: "Sam",
    role: "Agency Owner",
    date: "Jun 8, 2026",
    hasTranscript: true,
  },
  {
    title: "Vet Intro Objection",
    category: "General",
    presenter: "Sam",
    role: "Agency Owner",
    date: "Jun 8, 2026",
    hasTranscript: true,
  },
  {
    title: "Vet Roleplay",
    category: "Veterans",
    presenter: "Sam",
    role: "Agency Owner",
    date: "Jun 5, 2026",
    hasTranscript: true,
  },
  {
    title: "Replacing a Term",
    category: "Closing · 22:07",
    presenter: "Moody",
    role: "Top Producer",
    date: "May 30, 2026",
    hasTranscript: true,
  },
  {
    title: "Beating Price",
    category: "Closing · 43:08",
    presenter: "Moody",
    role: "Top Producer",
    date: "May 30, 2026",
    hasTranscript: true,
  },
  {
    title: "Price Objection Close",
    category: "Recorded Presentation",
    presenter: "Chudi",
    role: "Field Trainer",
    date: "May 29, 2026",
    hasTranscript: true,
  },
  {
    title: "Beating the Price Objection — Version 1",
    category: "Recorded Presentation",
    presenter: "APEX Training Team",
    role: "Recorded Trainer",
    date: "May 21, 2026",
    hasTranscript: true,
  },
  {
    title: "Beating the Price Objection — Version 2",
    category: "Recorded Presentation",
    presenter: "APEX Training Team",
    role: "Recorded Trainer",
    date: "May 7, 2026",
    hasTranscript: true,
  },
  {
    title: "Selling More Coverage — Objection Handling",
    category: "Recorded Presentation",
    presenter: "APEX Training Team",
    role: "Recorded Trainer",
    date: "Apr 12, 2026",
    hasTranscript: true,
  },
];

const PRESENTERS = [
  { initial: "AT", name: "APEX Training Team", role: "Recorded Curriculum", count: 6 },
  { initial: "O", name: "Obi", role: "Senior Producer", count: 5 },
  { initial: "S", name: "Sam", role: "Agency Owner", count: 3 },
  { initial: "M", name: "Moody", role: "Top Producer", count: 2 },
  { initial: "C", name: "Chudi", role: "Field Trainer", count: 1 },
  { initial: "AI", name: "Aisha", role: "Top Producer", count: 1 },
];

const QUICK_LINKS = [
  {
    label: "Admin Portal",
    subtitle: "Manage resources + recordings",
    url: `${HUB_URL}/admin/`,
  },
  {
    label: "Readymode",
    subtitle: "Power dialer",
    url: "https://apexfinancial.readymode.com/",
  },
  {
    label: "AgentLink",
    subtitle: "Agent CRM",
    url: "https://agentlink.insuracloud.ai/",
  },
  {
    label: "APEX Recruits Sheet",
    subtitle: "See all applicants",
    url: "https://docs.google.com/spreadsheets/d/1bRk9DAsg0xUvAxWlo9DsGC1WxdDaCwlSQ13JYIN1cO4/edit?usp=sharing",
  },
];

function SectionHeader({
  icon: Icon,
  title,
  count,
  subtitle,
}: {
  icon: typeof BookOpen;
  title: string;
  count: number;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">{title}</h2>
          <Badge variant="secondary" className="text-xs">
            {count}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

export default function ResourcesLicensing() {
  usePageTitle("APEX Resources · Training + Licensing");

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.08)_0%,transparent_50%)] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-6xl mx-auto relative z-10"
      >
        {/* Header */}
        <div className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>

          <div className="flex items-center gap-2 mb-4">
            <Crown className="h-8 w-8 text-primary" />
            <span className="text-xl font-bold gradient-text">APEX Financial</span>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <Badge variant="outline" className="text-xs">
              <Sparkles className="h-3 w-3 mr-1" />
              Internal training + licensing
            </Badge>
          </div>

          <h1 className="text-3xl md:text-5xl font-bold mb-3">
            Everything you need,{" "}
            <span className="gradient-text">in one place.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl">
            Scripts, carrier guides, recorded trainings, courses, and PDFs —
            curated for APEX applicants and licensed agents. Updated weekly.
          </p>
        </div>

        {/* Courses */}
        <GlassCard className="p-6 md:p-8 mb-6">
          <SectionHeader
            icon={GraduationCap}
            title="Courses"
            count={COURSES.length}
            subtitle="Core curriculum + onboarding tracks."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {COURSES.map((course) => (
              <div
                key={course.title}
                className="p-4 rounded-lg bg-muted/40 border border-border/60 flex flex-col"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                    {course.category}
                  </Badge>
                </div>
                <h3 className="font-bold text-base mb-1">{course.title}</h3>
                <p className="text-xs text-primary/90 mb-3">
                  with {course.presenter} · {course.role}
                </p>
                <p className="text-sm text-muted-foreground mb-4 flex-1">
                  {course.description}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                  <span>{course.lessons}</span>
                  <span>·</span>
                  <span>{course.duration}</span>
                </div>
                <GradientButton asChild variant="outline" className="mt-auto w-full text-sm">
                  <a
                    href={course.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <GraduationCap className="h-4 w-4 mr-2" />
                    Start Course
                  </a>
                </GradientButton>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* PDFs */}
        <GlassCard className="p-6 md:p-8 mb-6">
          <SectionHeader
            icon={FileText}
            title="PDFs"
            count={PDFS.length}
            subtitle="Playbook + client-facing tools."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PDFS.map((pdf) => (
              <a
                key={pdf.title}
                href={pdf.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-4 rounded-lg bg-muted/40 border border-border/60 hover:border-primary/40 transition-colors flex flex-col group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className="text-[10px]">
                    PDF
                  </Badge>
                  {pdf.isNew && (
                    <Badge className="text-[10px] bg-primary text-primary-foreground">
                      NEW
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {pdf.date}
                  </span>
                </div>
                <h3 className="font-bold text-base mb-1">{pdf.title}</h3>
                <p className="text-sm text-muted-foreground mb-4 flex-1">
                  {pdf.subtitle}
                </p>
                <div className="text-sm text-primary flex items-center gap-1 group-hover:gap-2 transition-all">
                  Open PDF <ExternalLink className="h-3 w-3" />
                </div>
              </a>
            ))}
          </div>
        </GlassCard>

        {/* Scripts / Guides */}
        <GlassCard className="p-6 md:p-8 mb-6">
          <SectionHeader
            icon={ClipboardCheck}
            title="Scripts & Guides"
            count={SCRIPTS.length}
            subtitle="Intro through the close — Senior + Veteran call flows."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SCRIPTS.map((script) => (
              <a
                key={script.title}
                href={script.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-4 rounded-lg bg-muted/40 border border-border/60 hover:border-primary/40 transition-colors flex flex-col group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className="text-[10px]">
                    GUIDE
                  </Badge>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {script.date}
                  </span>
                </div>
                <h3 className="font-bold text-base mb-1">{script.title}</h3>
                <p className="text-sm text-muted-foreground mb-4 flex-1">
                  {script.subtitle}
                </p>
                <div className="text-sm text-primary flex items-center gap-1 group-hover:gap-2 transition-all">
                  Open script <ExternalLink className="h-3 w-3" />
                </div>
              </a>
            ))}
          </div>
        </GlassCard>

        {/* Recorded Presentations */}
        <GlassCard className="p-6 md:p-8 mb-6">
          <SectionHeader
            icon={Mic}
            title="Recorded Presentations"
            count={RECORDINGS.length}
            subtitle="Hear it straight from the people closing business."
          />

          {/* Presenter chips */}
          <div className="flex flex-wrap gap-2 mb-6">
            {PRESENTERS.map((presenter) => (
              <div
                key={presenter.name}
                className="px-3 py-1.5 rounded-full bg-muted/50 border border-border/60 text-xs flex items-center gap-2"
              >
                <span className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                  {presenter.initial}
                </span>
                <span className="font-semibold">{presenter.name}</span>
                <span className="text-muted-foreground">{presenter.role}</span>
                <Badge variant="secondary" className="text-[10px] ml-1">
                  {presenter.count}
                </Badge>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {RECORDINGS.map((rec, idx) => (
              <a
                key={`${rec.title}-${idx}`}
                href={`${HUB_URL}/#presentations`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3 rounded-lg bg-muted/40 border border-border/60 hover:border-primary/40 transition-colors flex items-start gap-3 group"
              >
                <div className="h-10 w-10 rounded-md bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Headphones className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-sm truncate">{rec.title}</h4>
                  </div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">
                    {rec.category}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {rec.presenter}
                    </span>
                    <span>·</span>
                    <span>{rec.date}</span>
                    {rec.hasTranscript && (
                      <>
                        <span>·</span>
                        <span className="text-primary">Transcript</span>
                      </>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </GlassCard>

        {/* Quick Links */}
        <GlassCard className="p-6 md:p-8 mb-6">
          <SectionHeader
            icon={Award}
            title="Quick Links"
            count={QUICK_LINKS.length}
            subtitle="Direct jumps to production tools + admin surfaces."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {QUICK_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-4 rounded-lg bg-muted/40 border border-border/60 hover:border-primary/40 transition-colors flex items-center justify-between group"
              >
                <div>
                  <div className="font-bold text-sm">{link.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {link.subtitle}
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-primary group-hover:translate-x-0.5 transition-transform" />
              </a>
            ))}
          </div>
        </GlassCard>

        {/* Single-purpose footer — back to the licensing flow. */}
        <div className="mt-8">
          <GradientButton asChild variant="outline" className="w-full">
            <Link to="/get-licensed">
              <GraduationCap className="h-4 w-4 mr-2" />
              Back to Get Licensed
            </Link>
          </GradientButton>
        </div>
      </motion.div>
    </div>
  );
}
