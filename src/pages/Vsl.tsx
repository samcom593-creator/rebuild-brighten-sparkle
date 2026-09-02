import { Link } from "react-router-dom";
import { Clock, ArrowRight } from "lucide-react";

import { usePageTitle } from "@/hooks/usePageTitle";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { GradientButton } from "@/components/ui/gradient-button";
import { resolveBrand } from "@/config/brand";
import { VSL_VIDEO } from "@/lib/vslMedia";

const BRAND = resolveBrand();

/**
 * /vsl — the public home of the APEX recruiting VSL.
 *
 * Deliberately NOT a gate. The gate on /apply was killed on purpose (089baa85)
 * because it blocked applicants behind a video; this page is the opposite —
 * a shareable link that plays immediately and points at the same apply flow.
 *
 * The player is `preload="metadata"` and the object is fast-start (moov ahead
 * of mdat) and range-served, so a viewer gets a first frame and can seek
 * without pulling 187 MB.
 */
export default function Vsl() {
  usePageTitle(`${VSL_VIDEO.title} · ${BRAND.legalName}`);

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-primary/35 text-primary">
            {BRAND.legalName}
          </Badge>
          <Badge variant="outline" className="border-border/50 text-muted-foreground">
            <Clock className="mr-1 h-3 w-3" />
            {VSL_VIDEO.durationLabel}
          </Badge>
        </div>

        <h1 className="text-2xl font-bold leading-tight sm:text-4xl">
          {VSL_VIDEO.title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {VSL_VIDEO.description}
        </p>

        <GlassCard className="mt-7 overflow-hidden border border-primary/25 p-3 sm:p-4">
          <div className="relative aspect-video overflow-hidden rounded-xl border border-primary/25 bg-black shadow-[0_18px_60px_hsl(var(--primary)/0.12)]">
            <video
              controls
              playsInline
              preload="metadata"
              poster={VSL_VIDEO.poster}
              aria-label={VSL_VIDEO.title}
              className="absolute inset-0 h-full w-full bg-black object-contain"
            >
              <source src={VSL_VIDEO.src} type="video/mp4" />
              Your browser cannot play this video. Use a current browser to continue.
            </video>
          </div>
        </GlassCard>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link to="/apply">
            <GradientButton className="w-full sm:w-auto">
              Apply to {BRAND.shortName}
              <ArrowRight className="ml-2 h-4 w-4" />
            </GradientButton>
          </Link>
          <Link
            to="/get-licensed"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Not licensed yet? Start here.
          </Link>
        </div>
      </div>
    </div>
  );
}
