import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2Off, MoreHorizontal, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * MP-351: the agents production cannot credit, with status control on the row.
 *
 * Sam: "I should see all these new agents like Isaiah Caldwell, all those people
 * who have not been merged for production. When I tap on the agent we need to
 * modify fast whether they're hired, fired, etcetera."
 *
 * agentlink_book rows arrive keyed to an AgentLink user id, so an agent with no
 * al_user_id can never be credited for a sale no matter how much they write —
 * 32 of 54 active agents are in that state. Linking is therefore an action on
 * this panel, not a report someone files elsewhere.
 *
 * Status goes through set_agent_status, which reaches 'terminated' (the old
 * set_agent_active could not) and confines a manager to their own downline.
 * Merged duplicates are already excluded server-side, so a resolved duplicate
 * like Isaiah Caldwell's does not sit here looking like an open problem.
 */
type UnlinkedRow = {
  agent_id: string;
  display_name: string;
  status: string;
  hired_on: string;
  days_since_hire: number;
  manager_name: string;
  al_user_id: string;
  book_rows: number;
  license_status: string;
  blocker: string;
};

const STATUSES = [
  { key: "active", label: "Hired · active" },
  { key: "inactive", label: "Inactive" },
  { key: "terminated", label: "Fired · terminated" },
] as const;

export function UnlinkedAgentsPanel() {
  const queryClient = useQueryClient();
  const [linking, setLinking] = useState<Record<string, string>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ["unlinked-agents"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_unlinked_agents" as never, { p_days: 120 } as never);
      if (error) throw error;
      return (data ?? []) as unknown as UnlinkedRow[];
    },
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["unlinked-agents"] });
    await queryClient.invalidateQueries({ queryKey: ["onboarding-roll-call"] });
  };

  const setStatus = useMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      const { data, error } = await supabase.rpc("set_agent_status" as never, {
        p_agent_id: input.id, p_status: input.status, p_reason: null,
      } as never);
      if (error) throw error;
      return data as unknown as { to_status: string };
    },
    onSuccess: async (r) => { toast.success(`Status set to ${r?.to_status}`); await refresh(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not change status"),
  });

  const link = useMutation({
    mutationFn: async (input: { id: string; alId: number }) => {
      const { error } = await supabase.rpc("set_agent_al_link" as never, {
        p_agent_id: input.id, p_al_id: input.alId,
      } as never);
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("Linked to AgentLink — production can credit them now"); await refresh(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not link"),
  });

  if (isLoading) return <Skeleton className="h-40 rounded-lg" />;
  if (isError || !data || data.length === 0) return null;

  const unlinked = data.filter((r) => !r.al_user_id);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            <ShieldAlert className="h-3 w-3" />Agents · production linkage
          </p>
          {unlinked.length > 0 && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
              {unlinked.length} cannot be credited
            </Badge>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">{data.length} recent agents</span>
        </div>

        <div className="space-y-1.5">
          {data.map((row) => (
            <div
              key={row.agent_id}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2",
                row.al_user_id ? "border-border" : "border-amber-500/40 bg-amber-500/5",
              )}
            >
              <span className="min-w-0 truncate text-sm font-medium text-foreground">{row.display_name}</span>
              {!row.al_user_id && <Link2Off className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
              <Badge variant="outline" className="text-[10px] capitalize">{row.status}</Badge>
              <span className="text-[11px] text-muted-foreground">{row.blocker}</span>

              <div className="ml-auto flex items-center gap-2">
                {!row.al_user_id && (
                  <span className="flex items-center gap-1.5">
                    <Input
                      className="h-7 w-28 text-xs"
                      inputMode="numeric"
                      placeholder="AgentLink ID"
                      aria-label={`AgentLink ID for ${row.display_name}`}
                      value={linking[row.agent_id] ?? ""}
                      onChange={(e) => setLinking((v) => ({ ...v, [row.agent_id]: e.target.value }))}
                    />
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs"
                      disabled={link.isPending || !/^\d+$/.test(linking[row.agent_id] ?? "")}
                      onClick={() => link.mutate({ id: row.agent_id, alId: Number(linking[row.agent_id]) })}
                    >
                      Link
                    </Button>
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0"
                      aria-label={`Change status for ${row.display_name}`}>
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      {row.display_name} · {row.manager_name}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {STATUSES.map((s) => (
                      <DropdownMenuItem
                        key={s.key}
                        disabled={s.key === row.status || setStatus.isPending}
                        onSelect={(e) => { e.preventDefault(); setStatus.mutate({ id: row.agent_id, status: s.key }); }}
                      >
                        {s.label}
                        {s.key === row.status && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>

        {unlinked.length > 0 && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            AgentLink keys production by its own user id. Until one is set, nothing these {unlinked.length} write
            can be credited to them — their book will read zero however much they sell.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
