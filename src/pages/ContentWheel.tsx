import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";
import { Crown } from "lucide-react";
import { ContentWheelSubNav } from "@/components/contentwheel/ContentWheelSubNav";
import { DashboardModule } from "@/components/contentwheel/DashboardModule";
import { PlaceholderModule } from "@/components/contentwheel/PlaceholderModule";
import { CW_MODULES, isCwModuleKey, type CwModuleKey } from "@/components/contentwheel/modules";

/**
 * ContentWheel — the personal-brand + recruiting Content OS.
 *
 * Spec: ~/Downloads/CONTENTWHEEL_Build_Spec_Samuel_James.pdf
 * Doctrine: 15 laws enforced at the DB layer (see migration
 *   20260518230000_contentwheel_p0.sql).
 *
 * P1 ships: nav shell + Dashboard module + Brand Core (read-only via seeds).
 * Other 11 modules land in P2..P8 per the spec's phased build sequence.
 * The cw_ schema, RLS, triggers, and views are ALL already deployed —
 * placeholder modules query real data the moment their UI lands.
 */
export default function ContentWheel() {
  const [params, setParams] = useSearchParams();
  const moduleParam = params.get("m");
  const active: CwModuleKey = isCwModuleKey(moduleParam) ? moduleParam : "dashboard";
  const activeModule = useMemo(() => CW_MODULES.find((m) => m.key === active)!, [active]);

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
    <div className="container mx-auto p-4 md:p-6 space-y-6">
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
          ) : (
            <PlaceholderModule module={activeModule} />
          )}
        </main>
      </div>
    </div>
  );
}
