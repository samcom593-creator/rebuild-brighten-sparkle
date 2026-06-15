// Hierarchy v1 stub — biggest legs + downline contract counts.
// Real implementation lands via the dispatched build agent.
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Workflow } from "lucide-react";

export default function Hierarchy() {
  usePageTitle("Hierarchy · APEX");
  return (
    <div className="px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Recruiting"
        eyebrowIcon={<Workflow className="h-3 w-3" />}
        title="Hierarchy"
        subtitle="Biggest legs · contracts · production rolling up."
      />
      <div className="rounded-3xl bg-card/40 border border-border/40 px-6 py-8 text-sm text-muted-foreground">
        Loading hierarchy…
      </div>
    </div>
  );
}
