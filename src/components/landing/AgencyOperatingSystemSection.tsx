import { Link, useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileCheck2,
  GraduationCap,
  Network,
  UserPlus,
} from "lucide-react";
import { applyHrefWithRef } from "@/lib/refSlug";
import { SectionHeading } from "@/components/ui/section-heading";

const operatingStages = [
  {
    icon: UserPlus,
    step: "01",
    title: "Recruit",
    description: "One application routes licensed and unlicensed candidates into the right path.",
  },
  {
    icon: FileCheck2,
    step: "02",
    title: "Contract",
    description: "A guided intake collects the information needed to launch carrier appointments.",
  },
  {
    icon: GraduationCap,
    step: "03",
    title: "Train",
    description: "Every agent sees the required lessons, completed work, and exact next action.",
  },
  {
    icon: BarChart3,
    step: "04",
    title: "Produce",
    description: "Personal, team, and agency production stay separated and visible in one view.",
  },
  {
    icon: Network,
    step: "05",
    title: "Scale",
    description: "Hierarchy reporting gives each leader the right view of their own downline.",
  },
];

const controlPanels = [
  {
    label: "Recruiting engine",
    value: "One link",
    detail: "Applications, interviews, hiring, and follow-up",
  },
  {
    label: "Launch control",
    value: "Next step clear",
    detail: "Licensing, contracting, training, and field release",
  },
  {
    label: "Agency intelligence",
    value: "Live hierarchy",
    detail: "Personal, team, sub-agency, and total production",
  },
];

export function AgencyOperatingSystemSection() {
  const [searchParams] = useSearchParams();
  const applyHref = applyHrefWithRef(searchParams.get("ref"));

  return (
    <section id="agency-system" className="relative border-y border-border bg-background py-24">
      <div className="container mx-auto px-4">
        <SectionHeading
          badge="The Agency Command Center"
          title="One platform. Every stage of agency growth."
          subtitle="Recruiting, licensing, contracting, training, production, and hierarchy management move together instead of living in disconnected tools."
        />

        <div className="mx-auto mt-14 grid max-w-6xl gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="overflow-hidden rounded-2xl border border-primary/25 bg-card shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Agency workflow</p>
                <h3 className="mt-1 font-display text-xl font-bold text-foreground">From first contact to scaled production</h3>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400">
                <Activity className="h-3.5 w-3.5" aria-hidden />
                Connected system
              </div>
            </div>

            <ol className="divide-y divide-border/70">
              {operatingStages.map((stage, index) => {
                const Icon = stage.icon;
                return (
                  <li key={stage.title} className="group grid gap-4 px-5 py-5 transition-colors hover:bg-primary/5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:px-6">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="font-mono text-xs font-bold text-muted-foreground">{stage.step}</span>
                    </div>
                    <div>
                      <h4 className="font-display text-lg font-bold text-foreground">{stage.title}</h4>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{stage.description}</p>
                    </div>
                    <div className="hidden items-center gap-1.5 text-xs font-semibold text-emerald-400 sm:flex">
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      {index === 0 ? "Entry point" : "Connected"}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="flex flex-col gap-4">
            {controlPanels.map((panel) => (
              <div key={panel.label} className="rounded-2xl border border-border bg-card p-5 shadow-lg">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{panel.label}</p>
                <p className="mt-2 font-display text-2xl font-extrabold text-primary">{panel.value}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{panel.detail}</p>
              </div>
            ))}

            <Link
              to={applyHref}
              className="group mt-auto inline-flex min-h-14 items-center justify-between rounded-xl bg-primary px-5 py-4 font-display font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
            >
              Choose your path
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
