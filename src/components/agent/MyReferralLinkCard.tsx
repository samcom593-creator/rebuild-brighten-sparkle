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

const APEX_ORIGIN = "https://apex-financial.org";

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
  const bioUrl = code ? `${APEX_ORIGIN}/r/${encodeURIComponent(code)}` : fullUrl;

  const handleCopy = async () => {
    if (!bioUrl) return;
    try {
      await navigator.clipboard.writeText(bioUrl);
      setCopied(true);
      toast.success("Link in bio copied");
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error("Could not copy. Try again or copy manually.");
    }
  };

  if (!user) return null;
  if (linkQ.isLoading) {
    return (
      // Opaque bg-card, not bg-card/80: apex-tokens.css repaints bg-card/80 as pure
      // white in light mode, which is the isolated white card F39 removed.
      <Card className="border-border/60 bg-card">
        <CardContent className="p-4 text-sm text-muted-foreground">Loading your referral link…</CardContent>
      </Card>
    );
  }
  if (!linkQ.data?.active) return null;

  return (
    <Card className="border-emerald-500/30 bg-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider text-card-foreground">Your link in bio</p>
            <p className="text-xs text-muted-foreground">Put it in Instagram, TikTok, or any bio. Every applicant is credited to you.</p>
          </div>
          {/* The tint uses the primary token. A bg-emerald-* class with no text-emerald-*
              class matches the light-mode rule in apex-tokens.css that forces white text,
              which measured 1.18:1 for this label. */}
          <Badge variant="outline" className="border-primary/40 bg-primary/10">
            <QrCode className="mr-1 h-3 w-3" /> live
          </Badge>
        </div>
        {bioUrl ? (
          <>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <a
                href={bioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 break-all rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-xs text-foreground underline-offset-2 hover:border-primary/50 hover:text-primary hover:underline"
              >
                {bioUrl}
              </a>
              <Button
                onClick={handleCopy}
                size="sm"
                variant="outline"
                className="shrink-0"
                aria-label="Copy link in bio"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1.5">{copied ? "Copied" : "Copy bio link"}</span>
              </Button>
              <Button asChild size="sm" variant="ghost" aria-label="Open link in bio">
                <a href={bioUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-4 w-4" /> Open
                </a>
              </Button>
            </div>
            <p className="text-[12px] text-muted-foreground">
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
