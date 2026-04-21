import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { celebrateDeal } from "@/lib/gameFx";

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
      const [agentRes, profileRes] = await Promise.all([
        supabase.from("agents").select("id, insuracloud_api_token" as any).eq("user_id", user.id).maybeSingle(),
        supabase.from("profiles" as any).select("full_name, instagram_handle").eq("user_id", user.id).maybeSingle(),
      ]);
      const agentRow = agentRes.data as unknown as { id: string; insuracloud_api_token: string | null } | null;
      const profile = profileRes.data as unknown as { full_name: string | null; instagram_handle: string | null } | null;
      if (!agentRow?.id) throw new Error("No agent record found for your account");

      const { data: deal, error } = await supabase.from("deals" as any).insert({
        agent_id: agentRow.id,
        carrier_id: form.carrier_id || null,
        client_first_name: form.client_first_name,
        client_last_name: form.client_last_name,
        client_phone: form.client_phone,
        client_dob: form.client_dob,
        product_sold: form.product_sold,
        policy_number: form.policy_number,
        monthly_premium: parseFloat(form.monthly_premium),
        annual_premium: annualPremium,
        face_amount: parseFloat(form.face_amount),
        effective_date: form.effective_date,
        policy_expiration_date: form.policy_expiration_date || null,
        policy_term_months: form.policy_term_months ? parseInt(form.policy_term_months) : null,
        notes: form.notes || null,
        status,
      }).select("id").single();
      if (error) throw error;

      toast.success(
        status === "draft"
          ? "Saved as draft"
          : "Deal submitted — rolling into production & pushing to InsuraCloud",
      );

      // Celebrate closed deals: coin rain + gold flash + level-up banner
      if (status !== "draft") {
        celebrateDeal(parseFloat(form.monthly_premium) || 0);
      }

      setForm(blank);
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["agent-personal-stats"] });
      onSaved?.();

      const dealId = (deal as any)?.id as string | undefined;
      if (status !== "draft" && dealId) {
        const agentName  = (profile as any)?.full_name        || "An agent";
        const instagram  = (profile as any)?.instagram_handle || null;

        // Discord webhook URL (loaded from automation_settings, falls back to hardcoded channel)
        const { data: hookRow } = await supabase
          .from("automation_settings" as any)
          .select("description")
          .eq("name", "Discord Webhook")
          .maybeSingle();
        const webhookUrl =
          (hookRow as any)?.description ||
          "https://discord.com/api/webhooks/1425987081418571779/3JrtT5W00gDos8XY2iYc5_nb5sxr9S9ztagW1bBigI-8daIrb170vTyxIqXV2E8x2S0T";

        const fmt$ = (n: number) => {
          const v = n || 0;
          if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
          if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}k`;
          return `$${v.toFixed(0)}`;
        };
        const aop     = annualPremium;
        const monthly = aop / 12;
        const igLine  = instagram
          ? `\n📸 [@${String(instagram).replace(/^@/, "")}](https://instagram.com/${String(instagram).replace(/^@/, "")})`
          : "";

        const embed = {
          title: "🔥  DEAL CLOSED!",
          description: `**${agentName}** just slammed a deal shut! The money is IN! 💥${igLine}`,
          color: 0x10b981,
          fields: [
            { name: "💰 ALP",      value: fmt$(aop),              inline: true },
            { name: "📅 Monthly",  value: fmt$(monthly),          inline: true },
            { name: "📦 Product",  value: form.product_sold || "—", inline: true },
          ],
          footer: { text: "Apex Financial • Deal Alert" },
          timestamp: new Date().toISOString(),
        };

        // Direct Discord webhook (CORS-allowed)
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [embed] }),
        }).catch(() => {});

        // Milestone reward email: detect 25K / 40K / 75K / 100K monthly ALP crossings
        (async () => {
          try {
            const monthStart = new Date();
            monthStart.setDate(1);
            const monthStartISO = monthStart.toISOString().split("T")[0];
            const { data: mtdRows } = await supabase
              .from("daily_production")
              .select("aop")
              .eq("agent_id", agentRow.id)
              .gte("production_date", monthStartISO);
            const mtdBefore = (mtdRows ?? []).reduce(
              (s: number, r: { aop: number | null }) => s + Number(r.aop ?? 0),
              0,
            );
            const mtdAfter  = mtdBefore + annualPremium;
            const TIERS     = [100000, 75000, 40000, 25000];
            const crossed   = TIERS.find(t => mtdBefore < t && mtdAfter >= t);
            if (crossed) {
              supabase.functions.invoke("send-milestone-reward", {
                body: { agent_id: agentRow.id, milestone: crossed, mtd_production: mtdAfter },
              }).catch(() => {});
            }
          } catch { /* non-blocking */ }
        })();

        // InsuraCloud: hand off to the outbox edge function (it reads the
        // agent's insuracloud_api_token from the DB and handles retries).
        // Cross-origin CORS blocks a direct browser→agentlink POST, so we
        // must go through Supabase.
        supabase.functions.invoke("insuracloud-outbox", {
          body: { deal_id: dealId },
        }).catch(() => {});
      }
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
            <Input value={form.policy_number} onChange={e => set("policy_number", e.target.value)} />
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
