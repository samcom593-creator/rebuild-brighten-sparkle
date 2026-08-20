import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Check, QrCode, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { looseSupabase } from "@/lib/looseSupabase";

/**
 * Agent's personal "copy my referral link" card.
 * P3 wire-up: every logged-in agent (admin/manager/agent) gets one. Auto-mints
 * a manager_invite_links row on first visit if none exists for the current
 * user's agent_id. Apply.tsx already reads ?ref=<code> and routes attribution.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    || "ref" + Math.random().toString(36).slice(2, 8);
}

export function MyReferralLinkCard() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org";

  // 1) resolve the current user's agent_id + name
  const agentQ = useQuery({
    queryKey: ["my-referral-agent", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await looseSupabase
        .from<Record<string, unknown>>("agents")
        .select("id, display_name, profile:profiles!agents_profile_id_fkey(full_name)")
        .eq("user_id", user!.id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const profile = (data.profile as { full_name?: string } | null) ?? null;
      return {
        id: String(data.id),
        name: profile?.full_name || String(data.display_name || "agent"),
      };
    },
  });

  // 2) look up any existing invite link for this agent
  const linkQ = useQuery({
    queryKey: ["my-referral-link", agentQ.data?.id],
    enabled: Boolean(agentQ.data?.id),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await looseSupabase
        .from<Record<string, unknown>>("manager_invite_links")
        .select("invite_code")
        .eq("manager_agent_id", agentQ.data!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? String(data.invite_code) : null;
    },
  });

  // 3) auto-mint if none exists
  useEffect(() => {
    if (!agentQ.data || linkQ.isLoading || linkQ.data) return;
    let cancelled = false;
    const mint = async () => {
      const code = slugify(agentQ.data!.name);
      const { error } = await looseSupabase
        .from<Record<string, unknown>>("manager_invite_links")
        .insert({
          manager_agent_id: agentQ.data!.id,
          invite_code: code,
          referrer_role: "agent",
          is_active: true,
        });
      if (!cancelled) {
        if (error) {

        } else {
          linkQ.refetch();
        }
      }
    };
    mint();
    return () => { cancelled = true; };
  }, [agentQ.data, linkQ]);

  const code = linkQ.data;
  const fullUrl = useMemo(() => (code ? `${baseUrl}/apply?ref=${code}` : null), [baseUrl, code]);

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
  if (agentQ.isLoading) {
    return (
      <Card className="border-border/60 bg-card/80">
        <CardContent className="p-4 text-sm text-muted-foreground">Loading your referral link…</CardContent>
      </Card>
    );
  }
  if (!agentQ.data) return null;

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
              {" · "}every signup via this link credits <span className="font-medium text-foreground/80">{agentQ.data.name}</span>.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Generating your link…</p>
        )}
      </CardContent>
    </Card>
  );
}
