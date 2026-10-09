import { Link } from "react-router-dom";
import { Banknote, ExternalLink, FileCheck2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { resolveBrand } from "@/config/brand";
import { CONTRACTING_PROFILE_PATH } from "@/lib/contractingLinks";

export const EO_COVERAGE_URL = "https://app.napa-benefits.org/errors-and-omissions/";

export function ContractingReadinessCard({ compact = false }: { compact?: boolean }) {
  const brand = resolveBrand();
  return (
    <Card>
      <CardContent className={compact ? "space-y-4 p-4" : "space-y-5 p-5"}>
        <div>
          <p className="text-sm font-semibold">Contracting readiness</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete these once. Banking details stay in the secure carrier portals—not in {brand.shortName} forms.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <ReadinessStep icon={FileCheck2} title="1. Complete your contracting profile" body="Your NPN number, first and last name, email address and resident state. Details we already have are filled in; add only what's missing." />
          <ReadinessStep icon={Banknote} title="2. Prepare EFT" body="Have a voided check or bank letter ready. Enter routing and account numbers only when the carrier portal requests them." />
          <ReadinessStep icon={ShieldCheck} title="3. Confirm E&O" body="Keep an active certificate ready for carrier appointments. Compare the coverage and limits before purchasing." />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={CONTRACTING_PROFILE_PATH}>Complete contracting profile</Link>
          </Button>
          <Button asChild variant="outline">
            <a href={EO_COVERAGE_URL} target="_blank" rel="noopener noreferrer">
              E&O coverage options <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link to="/dashboard/profile#contracting-documents">My documents</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReadinessStep({ icon: Icon, title, body }: { icon: typeof FileCheck2; title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-2 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export default ContractingReadinessCard;
