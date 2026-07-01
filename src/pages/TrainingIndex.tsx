import { Link } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { motion } from "framer-motion";
import {
  Crown,
  BookOpen,
  GraduationCap,
  Headphones,
  FileText,
  ArrowLeft,
  Sparkles,
  TrendingUp,
  Users,
  ExternalLink,
} from "lucide-react";
import { GradientButton } from "@/components/ui/gradient-button";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";

/**
 * TrainingIndex — landing hub for licensed agents. Surfaces every
 * training destination in one place: the mirrored resource library,
 * the on-site Course Catalog, Annuity Training, and the external
 * apex-resources.vercel.app hub for real-time updates.
 */

const HUB_URL = "https://apex-resources.vercel.app";

const DESTINATIONS = [
  {
    title: "Full Training Resources",
    subtitle: "Courses, PDFs, scripts, recorded presentations — mirrored on-site.",
    href: "/resources/licensing",
    icon: BookOpen,
    highlight: true,
    badge: "18 recordings · 8 resources",
    external: false,
  },
  {
    title: "Course Catalog",
    subtitle: "APEX Onboarding, Release Course, and live-training replays with progress tracking.",
    href: "/course-catalog",
    icon: GraduationCap,
    highlight: false,
    badge: "Onboarding + Core",
    external: false,
  },
  {
    title: "Annuity Training",
    subtitle: "Cross-sell annuities into your existing book. Full carrier walkthrough.",
    href: "/dashboard/annuity-training",
    icon: TrendingUp,
    highlight: false,
    badge: "Advanced",
    external: false,
  },
  {
    title: "APEX Agent Hub (live)",
    subtitle: "Real-time weekly updates. Same content, admin-managed.",
    href: HUB_URL,
    icon: ExternalLink,
    highlight: false,
    badge: "External",
    external: true,
  },
];

const QUICK_PICKS = [
  {
    title: "APEX Script 3.0 — Senior Benefits",
    kind: "Guide",
    href: "/resources/licensing",
    icon: FileText,
  },
  {
    title: "APEX Script — Veterans (VA Benefits)",
    kind: "Guide",
    href: "/resources/licensing",
    icon: FileText,
  },
  {
    title: "APEX Agent Playbook",
    kind: "PDF",
    href: "/resources/licensing",
    icon: FileText,
  },
  {
    title: "Beating the Price Objection — KJ",
    kind: "Recording",
    href: "/resources/licensing",
    icon: Headphones,
  },
  {
    title: "The Long Game — Residual Income",
    kind: "PDF",
    href: "/resources/licensing",
    icon: FileText,
  },
  {
    title: "Needs Analysis Quiz",
    kind: "PDF",
    href: "/resources/licensing",
    icon: FileText,
  },
];

export default function TrainingIndex() {
  usePageTitle("Training · APEX Financial");

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.08)_0%,transparent_50%)] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-5xl mx-auto relative z-10"
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
              For licensed agents
            </Badge>
          </div>

          <h1 className="text-3xl md:text-5xl font-bold mb-3">
            Training <span className="gradient-text">Index</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl">
            Every training destination in one place — courses, playbooks,
            scripts, and recorded presentations from the team that closes.
          </p>
        </div>

        {/* Primary destinations */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {DESTINATIONS.map((dest) => {
            const Icon = dest.icon;
            const inner = (
              <GlassCard
                className={`p-6 h-full transition-all cursor-pointer group ${
                  dest.highlight
                    ? "border-2 border-primary/40 bg-primary/5"
                    : "hover:border-primary/40"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-12 h-12 rounded-lg bg-primary/15 flex items-center justify-center">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {dest.badge}
                  </Badge>
                </div>
                <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">
                  {dest.title}
                </h3>
                <p className="text-sm text-muted-foreground">{dest.subtitle}</p>
              </GlassCard>
            );

            return dest.external ? (
              <a
                key={dest.title}
                href={dest.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {inner}
              </a>
            ) : (
              <Link key={dest.title} to={dest.href}>
                {inner}
              </Link>
            );
          })}
        </div>

        {/* Quick picks */}
        <GlassCard className="p-6 md:p-8 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Quick picks</h2>
              <p className="text-sm text-muted-foreground">
                The 6 resources agents open most.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {QUICK_PICKS.map((pick) => {
              const Icon = pick.icon;
              return (
                <Link
                  key={pick.title}
                  to={pick.href}
                  className="p-4 rounded-lg bg-muted/40 border border-border/60 hover:border-primary/40 transition-colors flex items-start gap-3 group"
                >
                  <div className="h-9 w-9 rounded-md bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs uppercase tracking-wide text-primary/90 mb-1">
                      {pick.kind}
                    </div>
                    <h4 className="font-semibold text-sm">{pick.title}</h4>
                  </div>
                </Link>
              );
            })}
          </div>
        </GlassCard>

        {/* Not licensed yet? */}
        <GlassCard className="p-6 md:p-8 border-2 border-primary/30 bg-primary/5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold mb-1">Not licensed yet?</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Start with the licensing track. We cover course costs and walk
                you through every step.
              </p>
              <Link to="/get-licensed">
                <GradientButton>
                  <GraduationCap className="h-4 w-4 mr-2" />
                  Get Licensed
                </GradientButton>
              </Link>
            </div>
          </div>
        </GlassCard>

        <p className="text-center text-xs text-muted-foreground mt-8">
          APEX Financial Empire · Internal agent resources · Confidential — do
          not distribute.
        </p>
      </motion.div>
    </div>
  );
}
