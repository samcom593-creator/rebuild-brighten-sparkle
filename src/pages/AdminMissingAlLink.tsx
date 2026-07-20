import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Link2, Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SuggestedMatch {
  al_user_id: number;
  al_name: string;
  al_email?: string | null;
  similarity: number;
}

interface Row {
  agent_id: string;
  display_name: string | null;
  full_name: string | null;
  email: string | null;
  license_status: string | null;
  status: string | null;
  onboarding_stage: string | null;
  created_at: string;
  days_since_created: number | null;
  manager_name: string | null;
  suggested_matches: SuggestedMatch[] | null;
}

export default function AdminMissingAlLink() {
  usePageTitle("Missing AgentLink · APEX");
  const qc = useQueryClient();
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["v_agents_missing_al_link"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agents_missing_al_link" as any)
        .select("*")
        .order("days_since_created", { ascending: false });
      if (error) throw error;
      return (data as unknown as Row[]) ?? [];
    },
    staleTime: 60_000,
  });

  const link = useMutation({
    mutationFn: async ({ agent_id, al_id }: { agent_id: string; al_id: number }) => {
      const { error } = await supabase.rpc("set_agent_al_link" as any, {
        p_agent_id: agent_id,
        p_al_id: al_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["v_agents_missing_al_link"] });
      toast.success("AgentLink linked");
      setLinkingId(null);
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Link failed");
      setLinkingId(null);
    },
  });

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Admin · Data Integrity"
        eyebrowIcon={<Link2 className="h-3 w-3" />}
        title="Missing AgentLink Links"
        subtitle="Active agents with no AgentLink ID. Tap a suggested match to link them so their deals appear in AgentLink Book of Business."
      />

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {!isLoading && rows.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            <Check className="h-5 w-5 text-emerald-500 mx-auto mb-2" />
            Every active agent has an AgentLink link. Nothing to do.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {rows.map((r) => {
          const matches = Array.isArray(r.suggested_matches) ? r.suggested_matches : [];
          const linking = linkingId === r.agent_id;
          return (
            <Card key={r.agent_id} className="border border-amber-500/25 bg-amber-500/5">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">
                      {r.display_name || r.full_name || "unnamed agent"}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      {r.license_status && <Badge variant="outline" className="text-[10px]">{r.license_status}</Badge>}
                      {r.onboarding_stage && <span className="text-[11px]">{r.onboarding_stage}</span>}
                      {r.days_since_created !== null && <span className="text-[11px] text-amber-500">{r.days_since_created}d</span>}
                      {r.manager_name && <span className="text-[11px]">mgr: {r.manager_name}</span>}
                    </div>
                    {r.email && <div className="text-[11px] text-muted-foreground truncate">{r.email}</div>}
                  </div>
                  {matches.length === 0 && (
                    <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-400">
                      <AlertCircle className="h-3 w-3 mr-1" /> no match
                    </Badge>
                  )}
                </div>

                {matches.length > 0 && (
                  <div className="space-y-1.5">
                    {matches.map((m) => (
                      <div key={m.al_user_id} className="flex items-center gap-2 text-xs bg-background/60 rounded-md p-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{m.al_name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            AL #{m.al_user_id} · sim {Math.round((m.similarity || 0) * 100)}%
                            {m.al_email && ` · ${m.al_email}`}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          disabled={link.isPending && linking}
                          onClick={() => {
                            setLinkingId(r.agent_id);
                            link.mutate({ agent_id: r.agent_id, al_id: m.al_user_id });
                          }}
                        >
                          {linking && link.isPending ? (
                            <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Linking…</>
                          ) : (
                            <>Link</>
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
