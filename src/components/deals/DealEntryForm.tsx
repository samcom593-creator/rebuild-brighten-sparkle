import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateOperationalTruth } from "@/lib/invalidateOperationalTruth";
import { resolveBrand } from "@/config/brand";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const BRAND = resolveBrand();
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { celebrateDeal } from "@/lib/gameFx";
import { normalizePolicyNumber, sanitizePolicyInput } from "@/lib/policyNumber";

interface Carrier { id: string; name: string }

interface DealForm {
  carrier_id: string;
  client_first_name: string;
  client_last_name: string;
  client_phone: string;
  client_dob: string;
  product_sold: string;
  policy_number: string;
  monthly_premium: string;
  face_amount: string;
  effective_date: string;
  policy_expiration_date: string;
  policy_term_months: string;
  notes: string;
}

const blank: DealForm = {
  carrier_id: "",
  client_first_name: "",
  client_last_name: "",
  client_phone: "",
  client_dob: "",
  product_sold: "",
  policy_number: "",
  monthly_premium: "",
  face_amount: "",
  effective_date: new Date().toISOString().split("T")[0],
  policy_expiration_date: "",
  policy_term_months: "",
  notes: "",
};

export function DealEntryForm({ onSaved }: { onSaved?: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DealForm>(blank);
  const [saving, setSaving] = useState(false);

  const { data: carriers = [] } = useQuery({
    queryKey: ["carriers"],
    queryFn: async (): Promise<Carrier[]> => {
      const { data } = await supabase.from("carriers" as any).select("id, name").eq("is_active", true).order("name");
      return (data as any) || [];
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const annualPremium = useMemo(() => {
    const m = parseFloat(form.monthly_premium) || 0;
    return Math.round(m * 12 * 100) / 100;
  }, [form.monthly_premium]);

  const set = <K extends keyof DealForm>(k: K, v: DealForm[K]) => setForm(p => ({ ...p, [k]: v }));

  const submit = async (status: "draft" | "submitted") => {
    if (!user?.id) { toast.error("Not signed in"); return; }
    if (!form.client_first_name || !form.client_last_name || !form.client_phone || !form.client_dob ||
        !form.product_sold || !form.policy_number || !form.monthly_premium || !form.face_amount || !form.effective_date) {
      toast.error("Please fill in all required fields");
      return;
    }
    setSaving(true);
    try {
      // The token is read server-side by the deal-submit path; this form only
      // needs the agent id. (insuracloud_api_token is now column-restricted —
      // owners read it via get_my_insuracloud_token(), audit 2026-08-27.)
      // MP-348: this was .maybeSingle(), and `agents` has NO unique index on
      // user_id. PostgREST returns data=null on a MULTI-row match, so two agent
      // rows for one login read as ZERO and the form threw "No agent record
      // found for your account" at someone who has two. Matthew Anduha is in
      // that state right now. Prefer the canonical row, then the newest, and
      // take the first explicitly rather than asking for exactly one.
      const agentRes = await supabase
        .from("agents")
        .select("id, canonical_agent_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5);
      const rows = (agentRes.data ?? []) as unknown as Array<{ id: string; canonical_agent_id: string | null }>;
      // A row that IS the canonical target (canonical_agent_id null) is the real
      // one; a row pointing at another is the duplicate.
      const agentRow = rows.find((r) => !r.canonical_agent_id) ?? rows[0] ?? null;
      if (!agentRow?.id) throw new Error("No agent record found for your account");

      const { error } = await supabase.from("deals" as any).insert({
        agent_id: agentRow.id,
        carrier_id: form.carrier_id || null,
        client_first_name: form.client_first_name,
        client_last_name: form.client_last_name,
        client_phone: form.client_phone,
        client_dob: form.client_dob,
        product_sold: form.product_sold,
        policy_number: normalizePolicyNumber(form.policy_number),
        monthly_premium: parseFloat(form.monthly_premium),
        annual_premium: annualPremium,
        face_amount: parseFloat(form.face_amount),
        effective_date: form.effective_date,
        policy_expiration_date: form.policy_expiration_date || null,
        policy_term_months: form.policy_term_months ? parseInt(form.policy_term_months) : null,
        notes: form.notes || null,
        status,
      });
      if (error) throw error;

      toast.success(
        status === "draft"
          ? "Saved as draft"
          : `Deal submitted — ${BRAND.platformName} production is updating now`,
      );

      // Celebrate closed deals: coin rain + gold flash + level-up banner
      if (status !== "draft") {
        celebrateDeal(parseFloat(form.monthly_premium) || 0);
      }

      setForm(blank);
      invalidateOperationalTruth(queryClient);
      queryClient.invalidateQueries({ queryKey: ["agent-personal-stats"] });
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message || "Failed to save deal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4 text-emerald-400" /> Log a Deal
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Client First Name *</Label>
            <Input value={form.client_first_name} onChange={e => set("client_first_name", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Client Last Name *</Label>
            <Input value={form.client_last_name} onChange={e => set("client_last_name", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Phone *</Label>
            <Input type="tel" value={form.client_phone} onChange={e => set("client_phone", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Date of Birth *</Label>
            <Input type="date" value={form.client_dob} onChange={e => set("client_dob", e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Carrier</Label>
            <Select value={form.carrier_id} onValueChange={v => set("carrier_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select carrier" /></SelectTrigger>
              <SelectContent>
                {carriers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Product Sold *</Label>
            <Input placeholder="e.g. Term 20" value={form.product_sold} onChange={e => set("product_sold", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Policy Number *</Label>
            <Input value={form.policy_number} onChange={e => set("policy_number", sanitizePolicyInput(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Effective Date *</Label>
            <Input type="date" value={form.effective_date} onChange={e => set("effective_date", e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Monthly Premium *</Label>
            <Input type="number" step="0.01" min="0" value={form.monthly_premium} onChange={e => set("monthly_premium", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Annual Premium (auto)</Label>
            <Input value={annualPremium ? `$${annualPremium.toLocaleString()}` : "$0"} disabled />
          </div>
          <div>
            <Label className="text-xs">Face Amount *</Label>
            <Input type="number" step="100" min="0" value={form.face_amount} onChange={e => set("face_amount", e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Policy Term (months)</Label>
            <Input type="number" value={form.policy_term_months} onChange={e => set("policy_term_months", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Policy Expiration</Label>
            <Input type="date" value={form.policy_expiration_date} onChange={e => set("policy_expiration_date", e.target.value)} />
          </div>
        </div>

        <div>
          <Label className="text-xs">Notes</Label>
          <Textarea rows={2} value={form.notes} onChange={e => set("notes", e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" disabled={saving} onClick={() => submit("draft")}>
            Save Draft
          </Button>
          <Button disabled={saving} onClick={() => submit("submitted")}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Submit Deal
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
