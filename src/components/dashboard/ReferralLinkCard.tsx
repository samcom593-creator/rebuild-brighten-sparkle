import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Link2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// ReferralLinkCard — producers unlock a personal recruiting link once they've
// written enough production to credibly recruit (threshold lives in
// system_settings.referral_unlock_threshold, default $20k). Below the line we
// show the gap rather than hiding the feature, so it reads as a goal to chase.
// The link reuses the existing /r/:code short-link -> /apply?ref=<slug> flow.

type ReferralStatus = {
  has_agent: boolean;
  ref_slug: string | null;
  full_name: string | null;
  production_total: number | string;
  threshold: number | string;
  unlocked: boolean;
  remaining: number | string;
  referrals_count: number | string;
  link: string | null;
};

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function ReferralLinkCard() {
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["my-referral-status"],
    queryFn: async () => {
      const { data: res } = await supabase.rpc("my_referral_status" as any);
      return (res ?? null) as ReferralStatus | null;
    },
    staleTime: 60_000,
  });

  // Not an agent (admin-only login) — nothing to show.
  if (isLoading || !data || !data.has_agent) return null;

  const production = Number(data.production_total ?? 0);
  const threshold = Number(data.threshold ?? 20000);
  const remaining = Number(data.remaining ?? 0);
  const refCount = Number(data.referrals_count ?? 0);
  const pct = Math.min(100, threshold > 0 ? (production / threshold) * 100 : 0);

  const copy = async () => {
    if (!data.link) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked (insecure context / permission) — the link stays
      // selectable on screen, so this is a non-event for the user.
      setCopied(false);
    }
  };

  if (!data.unlocked) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Lock className="h-4 w-4" />
            Your recruiting link unlocks at ${money(threshold)}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Write ${money(remaining)} more and you can start bringing people onto your own team
            instead of sending them to the general application.
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>${money(production)}</span>
            <span>${money(threshold)}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            <span className="font-semibold">Your recruiting link</span>
            {refCount > 0 ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
                {refCount} referred
              </span>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            ${money(production)} written
          </span>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Anyone who applies through this link is credited to you instead of the general pool.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-sm">
            {data.link}
          </code>
          <Button onClick={copy} size="sm" variant={copied ? "secondary" : "default"}>
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
