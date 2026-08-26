import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trophy, Gift } from "lucide-react";
import { toast } from "sonner";

type RecordRow = {
  id: string;
  agent_id: string;
  agent_name: string | null;
  record_type: "daily_alp" | "weekly_alp" | "daily_policies" | "selling_streak";
  period_key: string;
  value: number;
  previous_best: number | null;
  achieved_on: string;
};

type BountyRow = {
  id: string;
  status: "pending" | "qualified" | "approved" | "paid" | "reversed";
  amount_cents: number;
  recruiter_name: string | null;
  recruit_name: string | null;
  policies_at_qualification: number;
  qualified_at: string;
  paid_at: string | null;
  reversed_reason: string | null;
};

type Payload = {
  records: RecordRow[];
  bounties: BountyRow[];
  candidates_near: number | null;
  is_admin: boolean;
};

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function recordLabel(r: RecordRow) {
  switch (r.record_type) {
    case "daily_alp": return `Best day · ${money(Number(r.value))} ALP`;
    case "weekly_alp": return `Best week · ${money(Number(r.value))} ALP`;
    case "daily_policies": return `Most policies in a day · ${r.value}`;
    case "selling_streak": return `Selling streak · ${r.value} business days`;
    default: return String(r.value);
  }
}

function previousLabel(r: RecordRow) {
  if (r.previous_best == null) return null;
  return r.record_type.endsWith("_alp") ? `was ${money(Number(r.previous_best))}` : `was ${r.previous_best}`;
}

const statusTone: Record<BountyRow["status"], string> = {
  pending: "border-border text-muted-foreground",
  qualified: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  approved: "border-primary/50 text-primary",
  paid: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  reversed: "border-red-500/40 text-red-600 dark:text-red-400",
};

export function RecordsAndBounties() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["apex_records_and_bounties"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("apex_records_and_bounties" as never, { p_limit: 12 } as never);
      if (error) throw error;
      return data as unknown as Payload;
    },
    staleTime: 60_000,
  });

  // Paid / reversed need a reason on the ledger row, collected inline (the
  // repo's blocking-modal ratchet retired window.prompt/confirm in wave-31).
  const [pending, setPending] = useState<{ id: string; status: "paid" | "reversed"; note: string } | null>(null);

  const setStatus = async (id: string, status: BountyRow["status"], note: string | null = null) => {
    if ((status === "paid" || status === "reversed") && !note?.trim()) {
      setPending({ id, status, note: "" });
      return;
    }
    const { error } = await supabase.rpc("set_recruiter_bounty_status" as never, { p_id: id, p_status: status, p_note: note } as never);
    if (error) { toast.error(error.message); return; }
    toast.success(`Bounty marked ${status}`);
    setPending(null);
    qc.invalidateQueries({ queryKey: ["apex_records_and_bounties"] });
  };

  const data = query.data;
  const records = data?.records ?? [];
  const bounties = data?.bounties ?? [];

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Trophy className="h-4 w-4 text-primary" /> Personal records
            <Badge variant="outline" className="ml-auto font-normal">canonical deals only</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {query.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading records…</p>
          ) : query.isError ? (
            <p className="text-xs text-red-600 dark:text-red-400">Could not load records: {(query.error as Error).message}</p>
          ) : records.length === 0 ? (
            <p className="text-xs text-muted-foreground">No records broken yet. A record is a day, week, policy count, or streak that beats the agent's own prior best.</p>
          ) : (
            records.map((r) => (
              <div key={r.id} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.agent_name ?? "Agent"}</p>
                  <p className="text-xs text-muted-foreground">{recordLabel(r)}{previousLabel(r) ? ` · ${previousLabel(r)}` : ""}</p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{r.achieved_on}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Gift className="h-4 w-4 text-primary" /> $500 recruiter bounties
            {data?.is_admin && data.candidates_near != null && (
              <Badge variant="outline" className="ml-auto font-normal">{data.candidates_near} recruits one policy away</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {query.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading bounties…</p>
          ) : bounties.length === 0 ? (
            <p className="text-xs text-muted-foreground">No bounties qualified yet. A producer (not a manager) earns $500 the moment someone they recruited posts their first two canonical policies.</p>
          ) : (
            bounties.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{b.recruiter_name ?? "Recruiter"} <span className="text-muted-foreground">← {b.recruit_name ?? "recruit"}</span></p>
                  <p className="text-xs text-muted-foreground">{money(b.amount_cents / 100)} · {b.policies_at_qualification} policies · {b.qualified_at.slice(0, 10)}{b.reversed_reason ? ` · ${b.reversed_reason}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant="outline" className={statusTone[b.status]}>{b.status}</Badge>
                  {data?.is_admin && b.status === "qualified" && (
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setStatus(b.id, "approved")}>Approve</Button>
                  )}
                  {data?.is_admin && b.status === "approved" && (
                    <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setStatus(b.id, "paid")}>Mark paid</Button>
                  )}
                  {data?.is_admin && (b.status === "qualified" || b.status === "approved") && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setStatus(b.id, "reversed")}>Reverse</Button>
                  )}
                </div>
                {pending?.id === b.id && (
                  <form
                    className="flex w-full items-center gap-2 pt-1"
                    onSubmit={(e) => { e.preventDefault(); void setStatus(b.id, pending.status, pending.note); }}
                  >
                    <Input
                      autoFocus
                      className="h-7 text-xs"
                      placeholder={pending.status === "paid" ? "Payment reference (check #, Zelle memo…)" : "Reason for reversal"}
                      value={pending.note}
                      onChange={(e) => setPending({ ...pending, note: e.target.value })}
                    />
                    <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={!pending.note.trim()}>Confirm {pending.status}</Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setPending(null)}>Cancel</Button>
                  </form>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
