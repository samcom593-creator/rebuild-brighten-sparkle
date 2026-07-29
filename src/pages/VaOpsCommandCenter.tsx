import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Briefcase,
  Flame,
  GraduationCap,
  Inbox,
  PhoneCall,
  Rocket,
  Users,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";

/**
 * VaOpsCommandCenter — /dashboard home for va_manager + va roles.
 *
 * 2026-07-27 Sam directive ("this is all milver can see — how could he
 * possibly work effectively"): VA staff used to land on the agent launch
 * cockpit, which scopes to an `agents` row they don't have and renders
 * hollow. This is their real home: every recruiting-ops work queue with a
 * live count and a tap-through. Counts come from the same sources as the
 * destination pages so the numbers never disagree.
 *
 * Production/finance surfaces are intentionally absent — VAs work the
 * pipeline, they don't see the money.
 */

interface QueueCard {
  key: string;
  label: string;
  desc: string;
  href: string;
  icon: LucideIcon;
  count: (signal: AbortSignal) => Promise<number>;
}

async function countOf(
  builder: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await builder;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

const viewCount = (view: string) => () =>
  countOf(
    supabase.from(view as never).select("*", { count: "exact", head: true }),
  );

function QueueCardTile({ card }: { card: QueueCard }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["va-ops-count", card.key],
    queryFn: ({ signal }) => card.count(signal),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const Icon = card.icon;

  return (
    <Link to={card.href} className="group block">
      <GlassCard hoverEffect className="flex h-full flex-col justify-between gap-4 p-5">
        <div className="flex items-start justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
            <Icon className="h-4 w-4 text-cyan-500" />
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
        <div>
          {isLoading ? (
            <div className="h-8 w-16 animate-pulse rounded bg-muted/60" />
          ) : isError ? (
            // Never fake a zero — a failed count renders as a failure.
            <p className="text-sm font-medium text-rose-500">count failed</p>
          ) : (
            <p className="text-3xl font-bold tabular-nums">{(data ?? 0).toLocaleString()}</p>
          )}
          <p className="mt-1 text-sm font-semibold">{card.label}</p>
          <p className="text-xs text-muted-foreground">{card.desc}</p>
        </div>
      </GlassCard>
    </Link>
  );
}

export default function VaOpsCommandCenter() {
  const { user, isVaManager } = useAuth();

  const cards: QueueCard[] = [
    {
      key: "interviews",
      label: "Interview Queue",
      desc: "Booked interviews to run and dispose",
      href: "/dashboard/interviews",
      icon: PhoneCall,
      count: viewCount("v_command_center_queue"),
    },
    {
      key: "interview-recovery",
      label: "Interview Recovery",
      desc: "Dropped bookings to rescue",
      href: "/dashboard/interview-recovery",
      icon: Rocket,
      count: viewCount("v_prospect_review_queue"),
    },
    {
      key: "unlicensed",
      label: "Unlicensed Queue",
      desc: "Prospects to push through licensing",
      href: "/admin/unlicensed-all",
      icon: GraduationCap,
      count: viewCount("v_unlicensed_all"),
    },
    {
      key: "licensed-inbox",
      label: "Licensed Inbox",
      desc: "Licensed applicants ready for contracting",
      href: "/admin/licensed-inbox",
      icon: Inbox,
      // Mirrors LicensedInbox's own filter (wave-p1k enum-safe version).
      count: () =>
        countOf(
          supabase
            .from("applications")
            .select("*", { count: "exact", head: true })
            .eq("license_status", "licensed")
            .not("status", "in", "(contracting,rejected)"),
        ),
    },
    {
      key: "license-push",
      label: "License Push",
      desc: "Hot licensing cohorts to chase",
      href: "/admin/recovery-queue",
      icon: Flame,
      count: viewCount("v_hot_licensing_prospects"),
    },
    {
      key: "applications",
      label: "Applications",
      desc: "Full applicant pipeline",
      href: "/dashboard/applicants",
      icon: Briefcase,
      count: () =>
        countOf(
          supabase
            .from("applications")
            .select("*", { count: "exact", head: true })
            .is("terminated_at", null),
        ),
    },
  ];

  if (isVaManager) {
    cards.push({
      key: "va-team",
      label: "VA Team",
      desc: "Create, monitor, disable VA logins",
      href: "/va-team",
      icon: Users,
      count: () =>
        countOf(
          supabase
            .from("profiles")
            .select("*", { count: "exact", head: true })
            .eq("managed_by", user?.id ?? ""),
        ),
    });
  }

  return (
    <div className="page-enter w-full space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        accent="cyan"
        eyebrow="VA Operations"
        eyebrowIcon={<Users className="h-3 w-3" />}
        title="Work Queues"
        subtitle="Every queue your team owns, live. Tap a card to start working it."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <QueueCardTile key={card.key} card={card} />
        ))}
      </div>
    </div>
  );
}
