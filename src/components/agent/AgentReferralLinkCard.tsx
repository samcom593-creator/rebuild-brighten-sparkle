import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Copy, UserPlus } from "lucide-react";
import { toast } from "sonner";

interface Props {
  agentId: string | null | undefined;
}

const APEX_HOST = "https://apex-financial.org";

export function AgentReferralLinkCard({ agentId }: Props) {
  const [refSlug, setRefSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: agent, error } = await supabase
          .from("agents")
          .select("ref_slug, display_name, profile_id")
          .eq("id", agentId)
          .maybeSingle();
        if (error) {
          console.error("[AgentReferralLinkCard] fetch error:", error);
          return;
        }
        if (cancelled) return;

        let slug = agent?.ref_slug as string | null;
        if (!slug) {
          // Generate one on the fly if missing
          const base =
            (agent?.display_name || "agent")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/(^-|-$)/g, "") || "agent";
          slug = `${base}-${agentId.slice(0, 6)}`;
          const { error: upErr } = await supabase
            .from("agents")
            .update({ ref_slug: slug })
            .eq("id", agentId);
          if (upErr) console.error("[AgentReferralLinkCard] update slug failed:", upErr);
        }
        setRefSlug(slug);
      } catch (err) {
        console.error("[AgentReferralLinkCard] unexpected:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const link = refSlug ? `${APEX_HOST}/apply?ref=${refSlug}` : "";

  const handleCopy = async () => {
    if (!link) {
      toast.error("Your referral link isn't ready yet — try again in a moment.");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Referral link copied!");
    } catch (err) {
      console.error("[AgentReferralLinkCard] copy failed:", err);
      toast.error(`Copy failed. Your referral URL: ${link}`);
    }
  };

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <UserPlus className="h-5 w-5 text-primary shrink-0" />
        <h3 className="font-semibold">Refer a Friend</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Know someone who'd be great at this? Share your referral link — applicants who
        use it are credited to you automatically.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-muted p-2 rounded truncate min-w-0">
          {loading ? "Loading…" : link || "—"}
        </code>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={handleCopy}
          disabled={loading || !link}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </GlassCard>
  );
}
