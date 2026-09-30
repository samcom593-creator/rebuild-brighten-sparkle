import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/dateUtils";
import { contactLinkProps, phoneHref } from "@/lib/phone";

/**
 * Contracting check-in (2026-09-30). Sam: "a function in my team where I can
 * mark down and confirm that somebody's contracts have been worked on ... I'm
 * about to do a check-in with everyone to audit. Make sure everyone's contracts
 * are sent out and they're ready to go for training if they're not already
 * ripping."
 *
 * Three manual steps, one derived state:
 *   contracts sent -> contracts confirmed -> ready for training
 *   producing = posted production in the last 30 days (never a checkbox, so an
 *   agent already writing business is never shown as blocked on paperwork).
 * Every tick goes through set_contracting_checkin(), which logs who changed what.
 */
type Stage = "needs_contracts" | "contracts_sent" | "contracts_confirmed" | "ready_for_training" | "producing";
type Step = "contracts_sent" | "contracts_confirmed" | "training_ready";

type Row = {
  agent_id: string;
  display_name: string;
  manager_name: string | null;
  email: string | null;
  phone: string | null;
  license_status: string | null;
  onboarding_stage: string | null;
  npn: string | null;
  hired_on: string | null;
  intake_received: boolean;
  deals_30d: number;
  last_deal_date: string | null;
  producing: boolean;
  contracts_sent_at: string | null;
  contracts_confirmed_at: string | null;
  training_ready_at: string | null;
  last_checkin_at: string | null;
  note: string | null;
  stage: Stage;
};

const GROUPS: { stage: Stage; title: string; hint: string; tone: string }[] = [
  { stage: "needs_contracts", title: "Contracts not sent", hint: "Send contracting, then tick Sent", tone: "border-rose-500/40" },
  { stage: "contracts_sent", title: "Sent, waiting on confirmation", hint: "Confirm the carriers finished them", tone: "border-amber-500/40" },
  { stage: "contracts_confirmed", title: "Contracted, not in training yet", hint: "Get them booked into training", tone: "border-sky-500/40" },
  { stage: "ready_for_training", title: "Ready for training", hint: "Contracts done, cleared to train", tone: "border-emerald-500/40" },
  { stage: "producing", title: "Already producing", hint: "Posted business in the last 30 days", tone: "border-border" },
];

const STEPS: { step: Step; label: string; field: keyof Row }[] = [
  { step: "contracts_sent", label: "Sent", field: "contracts_sent_at" },
  { step: "contracts_confirmed", label: "Confirmed", field: "contracts_confirmed_at" },
  { step: "training_ready", label: "Training ready", field: "training_ready_at" },
];

export function ContractingCheckinPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["contracting-checkin"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("contracting_checkin_list" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data ?? [];
    const filtered = q
      ? all.filter((r) => `${r.display_name} ${r.manager_name ?? ""}`.toLowerCase().includes(q))
      : all;
    return [...filtered].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [data, search]);

  const save = async (row: Row, step: Step | "note", done: boolean, note?: string) => {
    setBusy(`${row.agent_id}:${step}`);
    const { error } = await supabase.rpc("set_contracting_checkin" as never, {
      p_agent_id: row.agent_id,
      p_step: step,
      p_done: done,
      p_note: note ?? null,
    } as never);
    setBusy(null);
    if (error) {
      toast.error(`Not saved for ${row.display_name}: ${error.message}`);
      return;
    }
    if (step !== "note") toast.success(`${row.display_name}: ${done ? "marked" : "unmarked"} ${step.replace(/_/g, " ")}`);
    await qc.invalidateQueries({ queryKey: ["contracting-checkin"] });
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) {
    return (
      <p className="text-sm text-rose-400">
        The contracting list did not load. Nothing is being guessed at in its place; refresh to retry.
      </p>
    );
  }

  const total = data?.length ?? 0;
  const counts = Object.fromEntries(GROUPS.map((g) => [g.stage, (data ?? []).filter((r) => r.stage === g.stage).length]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {GROUPS.map((g) => (
          <Badge key={g.stage} variant="outline" className="text-xs">
            {g.title}: {counts[g.stage] ?? 0}
          </Badge>
        ))}
        <span className="text-xs text-muted-foreground">{total} active agents</span>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agent or manager"
            className="h-9 pl-8"
          />
        </div>
      </div>

      {GROUPS.map((g) => {
        const list = rows.filter((r) => r.stage === g.stage);
        if (list.length === 0) return null;
        return (
          <section key={g.stage} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">{g.title} · {list.length}</h3>
              <span className="text-xs text-muted-foreground">{g.hint}</span>
            </div>
            <div className="space-y-2">
              {list.map((r) => {
                const tel = phoneHref(r.phone);
                return (
                  <div key={r.agent_id} className={cn("rounded-lg border bg-card p-3", g.tone)}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{r.display_name}</span>
                      {r.manager_name && <span className="text-xs text-muted-foreground">under {r.manager_name}</span>}
                      <Badge variant="outline" className="text-[10px]">
                        {r.license_status === "licensed" ? "Licensed" : "Not licensed"}
                      </Badge>
                      {r.npn ? (
                        <span className="text-xs text-muted-foreground">NPN {r.npn}</span>
                      ) : (
                        <Badge variant="outline" className="border-rose-500/50 text-[10px] text-rose-400">No NPN</Badge>
                      )}
                      {r.intake_received && <Badge variant="outline" className="text-[10px]">Intake received</Badge>}
                      {r.producing && (
                        <span className="text-xs text-emerald-400">
                          {r.deals_30d} deal{r.deals_30d === 1 ? "" : "s"} in 30d
                        </span>
                      )}
                      {tel && (
                        <a {...contactLinkProps(tel)} className="ml-auto inline-flex items-center gap-1 text-xs text-primary">
                          <Phone className="h-3 w-3" /> {r.phone}
                        </a>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4">
                      {STEPS.map((s) => {
                        const at = r[s.field] as string | null;
                        const id = `${r.agent_id}-${s.step}`;
                        return (
                          <label key={s.step} htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm">
                            <Checkbox
                              id={id}
                              checked={!!at}
                              disabled={busy === `${r.agent_id}:${s.step}`}
                              onCheckedChange={(v) => save(r, s.step, v === true)}
                            />
                            {s.label}
                            {at && <span className="text-[11px] text-muted-foreground">{formatTimeAgo(at)}</span>}
                          </label>
                        );
                      })}
                      <Input
                        key={`${r.agent_id}-${r.note ?? ""}`}
                        defaultValue={r.note ?? ""}
                        placeholder="Check-in note (saves when you click away)"
                        className="h-8 min-w-[200px] flex-1 text-sm"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (r.note ?? "")) void save(r, "note", true, v);
                        }}
                      />
                      {r.last_checkin_at && (
                        <span className="text-[11px] text-muted-foreground">checked {formatTimeAgo(r.last_checkin_at)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
