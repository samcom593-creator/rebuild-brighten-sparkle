import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Check, QrCode, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

/**
 * Agent's personal "copy my referral link" card.
 * Every active agent gets one stable link from agents.ref_slug. The database
 * backfills old rows and generates the slug for new hires, so the card never
 * relies on client-side INSERT permission or a $20K production gate.
 */

type RecruitingLink = {
  active: boolean;
  agent_id?: string;
  ref_slug?: string;
  link?: string;
};

export function MyReferralLinkCard() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const linkQ = useQuery({
    queryKey: ["my-recruiting-link", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_recruiting_link" as never);
      if (error) throw error;
      return data as unknown as RecruitingLink;
    },
  });
  const code = linkQ.data?.ref_slug ?? null;
  const fullUrl = linkQ.data?.link ?? null;

  const handleCopy = async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error("Could not copy. Try again or copy manually.");
    }
  };

  if (!user) return null;
  if (linkQ.isLoading) {
    return (
      <Card className="border-border/60 bg-card/80">
        <CardContent className="p-4 text-sm text-muted-foreground">Loading your referral link…</CardContent>
      </Card>
    );
  }
  if (!linkQ.data?.active) return null;

  return (
    <Card className="border-emerald-500/30 bg-white dark:bg-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Your referral link</p>
            <p className="text-xs text-muted-foreground">Share it. Get credit for every applicant who signs up through it.</p>
          </div>
          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
            <QrCode className="mr-1 h-3 w-3" /> live
          </Badge>
        </div>
        {fullUrl ? (
          <>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <div className="flex-1 truncate rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-xs">
                {fullUrl}
              </div>
              <Button
                onClick={handleCopy}
                size="sm"
                variant="outline"
                className="shrink-0"
                aria-label="Copy referral link"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
              </Button>
              <Button asChild size="sm" variant="ghost" aria-label="Open apply link">
                <a href={fullUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Code: <span className="font-mono text-foreground/80">{code}</span>
              {" · "}every signup through this link is credited to your recruiting pipeline.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Generating your link…</p>
        )}
      </CardContent>
    </Card>
  );
}
