import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatTimeAgo } from "@/lib/dateUtils";
import type { TeamPerson } from "@/lib/teamContracting";

type Change = { id: number | string; contract_key: string; action: string; acted_by: string | null; acted_at: string };

/**
 * Who changed which milestone and when, read from the append-only audit table (row security decides what each person
 * may see). A failed read says so; it never shows an empty "no changes" in its place.
 */
export function CheckoffHistory({ person }: { person: TeamPerson }) {
  const version = person.milestones.map((m) => `${m.key}:${m.checked_at ?? ""}`).join("|");
  const q = useQuery({
    queryKey: ["team-checkoff-history", person.agent_id, version],
    staleTime: 0,
    queryFn: async (): Promise<{ changes: Change[]; names: Map<string, string> }> => {
      const { data, error } = await supabase
        .from("agent_contract_checkoff_events")
        .select("id, contract_key, action, acted_by, acted_at")
        .eq("agent_id", person.agent_id)
        .order("acted_at", { ascending: false })
        .limit(8);
      if (error) throw new Error(error.message);
      const changes = (data ?? []) as Change[];
      const ids = [...new Set(changes.map((c) => c.acted_by).filter((x): x is string => Boolean(x)))];
      const names = new Map<string, string>();
      if (ids.length > 0) {
        // Names are a courtesy. If this lookup is refused the change is still listed, just without a name.
        const { data: who } = await supabase.from("agents").select("user_id, display_name").in("user_id", ids);
        for (const w of who ?? []) if (w.user_id && w.display_name) names.set(w.user_id, w.display_name);
      }
      return { changes, names };
    },
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading change history…</p>;
  if (q.isError) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-400">
        Change history unavailable.{" "}
        <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Retry</button>
      </p>
    );
  }
  const { changes, names } = q.data!;
  if (changes.length === 0) return <p className="text-sm text-muted-foreground">No changes recorded yet.</p>;
  const label = (key: string) => person.milestones.find((m) => m.key === key)?.label ?? key;
  return (
    <ul className="space-y-1 text-sm text-muted-foreground">
      {changes.map((c) => (
        <li key={c.id}>
          <span className="text-foreground">{label(c.contract_key)}</span> {c.action === "checked" ? "checked off" : "reopened"}
          {c.acted_by ? ` by ${names.get(c.acted_by) ?? "a team member"}` : ""}, {formatTimeAgo(c.acted_at)}
        </li>
      ))}
    </ul>
  );
}
