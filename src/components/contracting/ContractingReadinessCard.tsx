import { Link } from "react-router-dom";
import { Building2, ExternalLink, FileCheck2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CONTRACTING_LINK_URL, CONTRACTING_PROFILE_PATH } from "@/lib/contractingLinks";

/**
 * Contracting asks contracting questions only (Sam, 2026-11-17): the five profile fields here, and the carriers
 * themselves in the MGN Agent Hub. No document asks — no driver's license, no E&O certificate, no voided check;
 * anything a carrier needs, the carrier's own portal collects.
 */
export function ContractingReadinessCard({ compact = false }: { compact?: boolean }) {
  return (
    <Card>
      <CardContent className={compact ? "space-y-4 p-4" : "space-y-5 p-5"}>
        <div>
          <p className="text-sm font-semibold">Contracting readiness</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Two steps, contracting questions only. Anything a carrier needs beyond this, the carrier portal asks for itself.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <ReadinessStep icon={FileCheck2} title="1. Complete your contracting profile" body="Your NPN number, first and last name, email address and resident state. Details we already have are filled in; add only what's missing." />
          <ReadinessStep icon={Building2} title="2. Contract in the MGN Agent Hub" body="Carrier contracting runs through the MGN Agent Hub. Set up your account there and complete each carrier; your team confirms them on your profile as they land." />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={CONTRACTING_PROFILE_PATH}>Complete contracting profile</Link>
          </Button>
          <Button asChild variant="outline">
            <a href={CONTRACTING_LINK_URL} target="_blank" rel="noopener noreferrer">
              Open the MGN Agent Hub <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
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
