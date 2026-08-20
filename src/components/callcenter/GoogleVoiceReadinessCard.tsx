import { ExternalLink, PhoneCall, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { resolveBrand } from "@/config/brand";
import {
  GOOGLE_VOICE_HOME_HREF,
  googleVoiceAccountChooserHref,
} from "@/lib/phone";

/**
 * Google Voice eligibility belongs to Google, not APEX. Keep the recovery
 * action beside the VA queues so an ineligible default Gmail account does not
 * look like a broken APEX call button.
 */
export function GoogleVoiceReadinessCard() {
  const brand = resolveBrand();

  return (
    <GlassCard className="border-amber-500/30 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/10">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Google Voice readiness</h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              If Google says <span className="font-semibold text-foreground">Upgrade not available</span>,
              that Gmail account is not eligible for Voice. Choose a different eligible Google account;
              {brand.platformName} call buttons use Google Voice on desktop and the native dialer on mobile.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild size="sm" className="h-11 gap-2 sm:h-9">
            <a href={googleVoiceAccountChooserHref()} target="_blank" rel="noopener noreferrer">
              <PhoneCall className="h-4 w-4" /> Switch Google account
            </a>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-11 gap-2 sm:h-9">
            <a href={GOOGLE_VOICE_HOME_HREF} target="_blank" rel="noopener noreferrer">
              Test Voice <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

export default GoogleVoiceReadinessCard;
