import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";
import { Crown } from "lucide-react";
import { ContentWheelSubNav } from "@/components/contentwheel/ContentWheelSubNav";
import { DashboardModule } from "@/components/contentwheel/DashboardModule";
import { IdeationRolodexModule } from "@/components/contentwheel/IdeationRolodexModule";
import { HookLabModule } from "@/components/contentwheel/HookLabModule";
import { isCwModuleKey, type CwModuleKey } from "@/components/contentwheel/modules";

/**
 * ContentWheel — the personal-brand + recruiting Content OS.
 *
 * Spec: ~/Downloads/CONTENTWHEEL_Build_Spec_Samuel_James.pdf
 * Doctrine: 15 laws enforced at the DB layer (see migration
 *   20260518230000_contentwheel_p0.sql).
 *
 * The cw_ schema, RLS, triggers, and views are deployed. Live modules
 * (Dashboard, Ideation Rolodex, Hook Lab) query real data directly.
 * Navigation only exposes modules with a working UI and live data contract.
 */
export default function ContentWheel() {
  const [params, setParams] = useSearchParams();
  const moduleParam = params.get("m");
  const active: CwModuleKey = isCwModuleKey(moduleParam) ? moduleParam : "dashboard";

  const selectModule = useCallback(
    (key: CwModuleKey) => {
      const next = new URLSearchParams(params);
      if (key === "dashboard") next.delete("m");
      else next.set("m", key);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 ops-surface ops-fade-in">
      <PageHeader
        accent="amber"
        eyebrow="Admin · Content OS"
        eyebrowIcon={<Crown className="h-3 w-3" />}
        title="ContentWheel"
        subtitle="Ideate · Hook · Shoot · Test · Iterate · Recruit. Hold the Standard. Average is the disease."
      />

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside>
          <ContentWheelSubNav active={active} onSelect={selectModule} />
        </aside>

        <main className="min-w-0">
          {active === "dashboard" ? (
            <DashboardModule />
          ) : active === "ideation" ? (
            <IdeationRolodexModule />
          ) : active === "hooks" ? (
            <HookLabModule />
          ) : null}
        </main>
      </div>
    </div>
  );
}
