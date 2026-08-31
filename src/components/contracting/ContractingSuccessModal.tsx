import {
  CalendarCheck2,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  MessageSquare,
  ShieldAlert,
} from "lucide-react";
import { Link } from "react-router-dom";

import { ONBOARDING_CONTACT, SCHEDULING_LINKS, TEAM_COMMUNITY_LINKS } from "@/lib/apexConfig";
import { resolveBrand } from "@/config/brand";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { EO_COVERAGE_URL } from "@/components/contracting/ContractingReadinessCard";

export interface ContractingAcceptance {
  intake_id: string;
  status: string;
  review_reason: string | null;
  onboarding_email_sent?: boolean;
}

const BRAND = resolveBrand();
const FULL_LAUNCH_PATH = [
  "Confirm account and producer profile",
  `Join the ${BRAND.shortName} Slack`,
  "Finish licensing and confirm NPN",
  "Submit contracting intake",
  "Book the onboarding call",
  "Upload license, ID, E&O, and EFT documents privately",
  "Complete carrier appointments",
  "Finish every training and ReadyMode module",
  "Post the first deal",
] as const;

/**
 * The public intake's durable-result surface. It deliberately describes the
 * recruit's business outcome, never the internal worker/outbox mechanism.
 */
export function ContractingSuccessModal({ accepted }: { accepted: ContractingAcceptance }) {
  const needsIdentityCorrection = accepted.status === "needs_review";

  return (
    <section aria-live="polite" aria-labelledby="contracting-result-title">
      <h1 id="contracting-result-title" className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        {needsIdentityCorrection
          ? "We need one identity correction"
          : "Contracting Initiated — Fast Track Active"}
      </h1>

      <GlassCard className="mt-6 p-5">
        <div className="flex items-start gap-3">
          {needsIdentityCorrection ? (
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-sm">
              {needsIdentityCorrection
                ? "We found conflicting identity details. Correct the email or NPN before account access can be issued. Nothing was overwritten."
                : `Your profile is active and contracting has started. ${accepted.onboarding_email_sent ? "A secure one-click training login was sent to your email." : "You can continue directly into onboarding now."}`}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Reference <span className="font-mono">{accepted.intake_id.slice(0, 8)}</span>
            </p>
          </div>
        </div>

        {needsIdentityCorrection ? (
          <div className="mt-4 rounded-lg border border-amber-500/35 bg-amber-500/5 p-3">
            <p className="text-xs">
              That email address is already on file under a different NPN. Contact support with the reference above so the identity can be corrected safely.
            </p>
          </div>
        ) : (
          <div className="mt-5 border-t border-border pt-5">
            <p className="text-sm font-semibold">Your complete launch path</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing is skipped. Your dashboard verifies progress and always keeps one next action at the top.
            </p>
            <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {FULL_LAUNCH_PATH.map((step, index) => (
                <li key={step} className="flex items-start gap-2 rounded-md border border-border/60 bg-background/30 px-3 py-2 text-xs">
                  <span className="font-semibold text-primary">{index + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              {ONBOARDING_CONTACT.name} is your {ONBOARDING_CONTACT.role}. Bring your NPN, EFT bank letter or voided check, and active E&amp;O certificate. Put account and routing numbers only into secure carrier portals.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button asChild size="sm" className="sm:col-span-2">
                <Link to="/agent-portal">
                  <GraduationCap className="mr-1.5 h-4 w-4" /> Continue to your onboarding roadmap
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="sm:col-span-2">
                <a href={SCHEDULING_LINKS.onboarding} target="_blank" rel="noopener noreferrer">
                  <CalendarCheck2 className="mr-1.5 h-4 w-4" /> Book with {ONBOARDING_CONTACT.name}
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={TEAM_COMMUNITY_LINKS.slack} target="_blank" rel="noopener noreferrer">
                  <MessageSquare className="mr-1.5 h-4 w-4" /> Join team Slack
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={EO_COVERAGE_URL} target="_blank" rel="noopener noreferrer">
                  E&amp;O coverage <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </div>
        )}
      </GlassCard>
    </section>
  );
}
