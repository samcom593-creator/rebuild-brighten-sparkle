import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

/** Payment plans for agents on the recruiting system. Standard is $500/month billed as 4 weekly payments. */
const PLANS = [
  { value: "standard_500", label: "$500 / month — $125 per week (standard)", monthly: 500 },
  { value: "legacy_400", label: "$400 / month — $100 per week", monthly: 400 },
  { value: "custom", label: "Custom monthly amount", monthly: null },
] as const;

type PlanValue = (typeof PLANS)[number]["value"];

interface RecruitingSystemRow {
  agent_id: string;
  enrolled: boolean;
  plan: PlanValue;
  monthly_price: number;
  weekly_payment: number;
  instagram_username: string | null;
  instagram_password: string | null;
}

/**
 * Billing + Instagram access for agents paying for recruiting systems. Admin (Sam) and
 * manager (Aisha) only — agent_recruiting_systems RLS allows no one else, so this panel
 * renders nothing for other roles rather than an empty shell.
 */
export function RecruitingSystemPanel({ agentId }: { agentId: string }) {
  const { isAdmin, isManager } = useAuth();
  const qc = useQueryClient();
  const canSee = isAdmin || isManager;
  const query = useQuery({
    queryKey: ["recruiting-system", agentId],
    enabled: canSee && !!agentId,
    queryFn: async (): Promise<RecruitingSystemRow | null> => {
      const { data, error } = await supabase
        .from("agent_recruiting_systems")
        .select("agent_id,enrolled,plan,monthly_price,weekly_payment,instagram_username,instagram_password")
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as RecruitingSystemRow) ?? null;
    },
  });
  const row = query.data ?? null;
  const [enrolled, setEnrolled] = useState(false);
  const [plan, setPlan] = useState<PlanValue>("standard_500");
  const [customMonthly, setCustomMonthly] = useState("500");
  const [igUser, setIgUser] = useState("");
  const [igPass, setIgPass] = useState("");
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);

  // Billing status comes from v_recruiting_billing_status (weeks due since enrolled_at
  // vs payments recorded); only meaningful once the enrollment row is saved.
  const billing = useQuery({
    queryKey: ["recruiting-billing", agentId],
    enabled: canSee && !!agentId && Boolean(row?.enrolled),
    queryFn: async () => {
      const [statusRes, paysRes] = await Promise.all([
        supabase.from("v_recruiting_billing_status").select("weeks_due,weeks_paid,paid_total,balance_due,last_paid").eq("agent_id", agentId).limit(1),
        supabase.from("agent_recruiting_payments").select("week_start,amount,paid_at").eq("agent_id", agentId).order("week_start", { ascending: false }).limit(4),
      ]);
      if (statusRes.error) throw statusRes.error;
      if (paysRes.error) throw paysRes.error;
      return { status: statusRes.data?.[0] ?? null, payments: paysRes.data ?? [] };
    },
  });

  useEffect(() => {
    setEnrolled(Boolean(row?.enrolled));
    setPlan((row?.plan as PlanValue) ?? "standard_500");
    setCustomMonthly(String(row?.monthly_price ?? 500));
    setIgUser(row?.instagram_username ?? "");
    setIgPass(row?.instagram_password ?? "");
  }, [row]);

  if (!canSee || !agentId) return null;

  const monthly = plan === "custom" ? Math.max(0, Number(customMonthly) || 0) : (PLANS.find((p) => p.value === plan)?.monthly ?? 500);
  const weekly = Math.round((monthly / 4) * 100) / 100;

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("agent_recruiting_systems").upsert({
      agent_id: agentId,
      enrolled,
      plan,
      monthly_price: monthly,
      instagram_username: igUser.trim() || null,
      instagram_password: igPass || null,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      toast.error(`Recruiting system not saved: ${error.message}`);
      return;
    }
    toast.success("Recruiting system saved");
    void qc.invalidateQueries({ queryKey: ["recruiting-system", agentId] });
    void qc.invalidateQueries({ queryKey: ["recruiting-billing", agentId] });
  };

  const recordWeekPayment = async () => {
    // Local-date Monday, not toISOString (UTC would shift the week at Phoenix evenings).
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const ymd = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
    setRecording(true);
    const { error } = await supabase.from("agent_recruiting_payments").insert({ agent_id: agentId, week_start: ymd, amount: weekly });
    setRecording(false);
    if (error) {
      toast.error(error.code === "23505" ? "This week's payment is already recorded." : `Payment not recorded: ${error.message}`);
      return;
    }
    toast.success(`Recorded $${weekly.toFixed(2)} for the week of ${ymd}`);
    void qc.invalidateQueries({ queryKey: ["recruiting-billing", agentId] });
  };

  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="Recruiting system">
      <h3 className="text-[15px] font-semibold text-foreground">Recruiting system</h3>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        // Deliberately NOT role="alert" and a distinct accessible name: the contracting
        // section above owns the drawer's "Retry" alert, and two identical alerts make
        // both unactionable (and ambiguous to tests and screen readers alike).
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Couldn't load the recruiting system.{" "}
          <button type="button" aria-label="Retry recruiting system" className="font-semibold underline" onClick={() => void query.refetch()}>Retry</button>
        </p>
      ) : (
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <Checkbox aria-label="Paying for recruiting systems" checked={enrolled} onCheckedChange={(v) => setEnrolled(v === true)} />
            Paying for recruiting systems
          </label>
          {enrolled ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[13px] text-muted-foreground">Payment plan</Label>
                <Select value={plan} onValueChange={(v) => setPlan(v as PlanValue)}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLANS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {plan === "custom" ? (
                  <Input inputMode="decimal" value={customMonthly} onChange={(e) => setCustomMonthly(e.target.value)} placeholder="Monthly amount" aria-label="Custom monthly amount" />
                ) : null}
                <p className="text-[13px] text-muted-foreground">
                  Billed weekly: <span className="font-semibold tabular-nums text-foreground">${weekly.toFixed(2)}</span> × 4 weeks = ${monthly.toFixed(2)} / month
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground" htmlFor={`ig-user-${agentId}`}>Instagram username</Label>
                  <Input id={`ig-user-${agentId}`} autoComplete="off" value={igUser} onChange={(e) => setIgUser(e.target.value)} placeholder="@handle" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground" htmlFor={`ig-pass-${agentId}`}>Instagram password</Label>
                  <Input id={`ig-pass-${agentId}`} type="password" autoComplete="new-password" value={igPass} onChange={(e) => setIgPass(e.target.value)} placeholder="••••••••" />
                </div>
              </div>
              {row?.enrolled ? (
                <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-foreground">Weekly billing</p>
                    <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => void recordWeekPayment()} disabled={recording}>
                      {recording ? "Recording…" : "Record this week's payment"}
                    </Button>
                  </div>
                  {billing.isLoading ? (
                    <p className="text-[13px] text-muted-foreground">Loading…</p>
                  ) : billing.isError ? (
                    <p className="text-[13px] text-amber-700 dark:text-amber-400">
                      Billing status unavailable.{" "}
                      <button type="button" aria-label="Retry billing status" className="font-semibold underline" onClick={() => void billing.refetch()}>Retry</button>
                    </p>
                  ) : billing.data?.status ? (
                    <>
                      <p className={`text-[13px] ${Number(billing.data.status.balance_due) > 0 ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                        {billing.data.status.weeks_paid} of {billing.data.status.weeks_due} weeks paid
                        {Number(billing.data.status.balance_due) > 0
                          ? ` — $${Number(billing.data.status.balance_due).toFixed(2)} behind`
                          : " — current"}
                      </p>
                      {billing.data.payments.length > 0 ? (
                        <ul className="space-y-0.5">
                          {billing.data.payments.map((p) => (
                            <li key={p.week_start} className="text-[12px] tabular-nums text-muted-foreground">
                              Week of {p.week_start} — ${Number(p.amount).toFixed(2)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">No payments recorded yet.</p>
                      )}
                    </>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">Billing starts once the enrollment is saved.</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          <Button type="button" size="sm" className="h-10" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save recruiting system"}
          </Button>
        </div>
      )}
    </section>
  );
}
