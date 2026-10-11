import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CheckCircle2, Circle, Hash, KeyRound } from "lucide-react";
import { CONTRACTING_PROFILE_URL } from "@/lib/contractingLinks";

const CONTRACTING_LINK = CONTRACTING_PROFILE_URL;

// Compact agent health for the profile drawer: placement (placing vs falling off),
// access (Discord / portal login), and pre-licensing progress. The Slack invite line left with the
// process retired on Oct 9, 2026 (its receipts view is not readable by signed-in users anyway). Reads
// v_agent_placement + existing tables. No heavy animation.

interface Placement {
  policies: number; total_alp: number;
  placing_n: number; placing_alp: number; placing_pct: number | null;
  falling_n: number; falling_alp: number; falling_pct: number | null;
  progress_n: number; progress_alp: number;
  unknown_n: number; unknown_alp: number;
}

interface Props {
  agentId: string;
}

interface AgentAccess {
  has_discord_access: boolean | null;
  portal_password_set: boolean | null;
  source_application_id: string | null;
  license_status: string | null;
  comp_percentage: number | null;
  contract_percentage: number | null;
  comp_approval_status: string | null;
  contracted_at: string | null;
  crm_setup_link: string | null;
}

const money = (n: number | null | undefined) =>
  n == null ? "$0" : "$" + Math.round(n).toLocaleString();

function Chip({ ok, label, icon: Icon }: { ok: boolean; label: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border ${ok ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`}>
      <Icon className="h-3 w-3" /> {label} {ok ? "✓" : "—"}
    </span>
  );
}

const PRELICENSE_STEPS = [
  { key: "course_purchased_at", label: "Course" },
  { key: "exam_scheduled_at", label: "Exam booked" },
  { key: "exam_passed_at", label: "Exam passed" },
  { key: "fingerprints_submitted_at", label: "Fingerprints" },
  { key: "license_approved_at", label: "Licensed" },
] as const;

export default function AgentHealthPanel({ agentId }: Props) {
  const qc = useQueryClient();
  const [editComp, setEditComp] = useState(false);
  const [compDraft, setCompDraft] = useState("");
  const [contractDraft, setContractDraft] = useState("");

  const access = useQuery<AgentAccess | null>({
    queryKey: ["agent-access", agentId],
    queryFn: async () => {
      // 2026-10-10: read through v_agents_full. The comp columns are not granted on the agents table to
      // signed-in users (the 2026-08-27 read-leak closure), so this exact select answered 403 for every
      // agent — including the admin — and the panel never loaded.
      const { data, error } = await supabase
        .from("v_agents_full" as never)
        .select("has_discord_access, portal_password_set, source_application_id, license_status, comp_percentage, contract_percentage, comp_approval_status, contracted_at, crm_setup_link")
        .eq("id", agentId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as AgentAccess | null;
    },
  });

  const saveComp = useMutation({
    mutationFn: async () => {
      const comp = compDraft.trim() === "" ? null : Number(compDraft);
      const contract = contractDraft.trim() === "" ? null : Number(contractDraft);
      const { error } = await supabase.rpc("rp_update_agent_comp" as never, {
        p_agent_id: agentId, p_comp: comp, p_contract: contract,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Comp updated"); setEditComp(false); qc.invalidateQueries({ queryKey: ["agent-access", agentId] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Comp update failed"),
  });

  const copyLink = () => {
    const link = CONTRACTING_LINK; // one generic link for everyone; staff type no name or email
    navigator.clipboard?.writeText(link).then(() => toast.success("Contracting link copied"), () => toast.error("Copy failed"));
  };
  const hasDiscord = access.data?.has_discord_access;
  const portalPasswordSet = access.data?.portal_password_set;
  const sourceApplicationId = access.data?.source_application_id;
  const licenseStatus = access.data?.license_status;

  const placement = useQuery<Placement | null>({
    queryKey: ["agent-placement", agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_placement" as never)
        .select("*").eq("agent_id", agentId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as Placement | null;
    },
  });

  const isLicensed = (licenseStatus ?? "").toLowerCase() === "licensed";
  const prelicense = useQuery<Record<string, string | null> | null>({
    queryKey: ["agent-prelicense", sourceApplicationId],
    enabled: !isLicensed && !!sourceApplicationId,
    queryFn: async () => {
      if (!sourceApplicationId) return null;
      const { data } = await supabase
        .from("applications" as never)
        .select("course_purchased_at, exam_scheduled_at, exam_passed_at, fingerprints_submitted_at, license_approved_at")
        .eq("id", sourceApplicationId).maybeSingle();
      return (data ?? null) as unknown as Record<string, string | null> | null;
    },
  });

  const p = placement.data;
  const placingPct = p?.placing_pct ?? 0;
  const fallingPct = p?.falling_pct ?? 0;
  const progressPct = Math.max(0, 100 - placingPct - fallingPct);

  return (
    <div className="space-y-3">
      {/* Placement */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">Production placement</span>
          <span className="text-xs text-muted-foreground">{p?.policies ?? 0} policies · {money(p?.total_alp)} ALP</span>
        </div>
        {!p || (p.placing_n + p.falling_n + p.progress_n) === 0 ? (
          <p className="text-xs text-muted-foreground">No scored book yet{p && p.unknown_n ? ` (${p.unknown_n} unclassified)` : ""}.</p>
        ) : (
          <>
            <div className="flex items-end gap-4 mb-2">
              <div><div className="text-2xl font-bold text-emerald-600">{placingPct}%</div><div className="text-xs text-muted-foreground">placing</div></div>
              <div><div className="text-2xl font-bold text-red-600">{fallingPct}%</div><div className="text-xs text-muted-foreground">falling off</div></div>
              {progressPct > 0 && <div><div className="text-2xl font-bold text-amber-600">{progressPct}%</div><div className="text-xs text-muted-foreground">in review</div></div>}
            </div>
            <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-muted">
              <div className="bg-emerald-500 h-full" style={{ width: `${placingPct}%` }} />
              <div className="bg-amber-500 h-full" style={{ width: `${progressPct}%` }} />
              <div className="bg-red-500 h-full" style={{ width: `${fallingPct}%` }} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
              <span><span className="text-emerald-600 font-medium">{p.placing_n}</span> placing · {money(p.placing_alp)}</span>
              <span><span className="text-red-600 font-medium">{p.falling_n}</span> falling · {money(p.falling_alp)}</span>
              {p.progress_n > 0 && <span><span className="text-amber-600 font-medium">{p.progress_n}</span> in review</span>}
              {p.unknown_n > 0 && <span>{p.unknown_n} unscored</span>}
            </div>
          </>
        )}
      </Card>

      {/* Access */}
      <Card className="p-3">
        <div className="text-sm font-semibold mb-2">Team access</div>
        <div className="flex flex-wrap gap-2">
          <Chip ok={!!hasDiscord} label="Discord" icon={Hash} />
          <Chip ok={!!portalPasswordSet} label="Portal login" icon={KeyRound} />
        </div>
      </Card>

      {/* Contracting & comp */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">Contracting &amp; comp</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${access.data?.contracted_at ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
            {access.data?.contracted_at ? "Contracted" : "Not contracted"}
          </span>
        </div>
        <div className="flex items-center gap-4 mb-2 text-sm">
          <div><span className="font-bold">{access.data?.comp_percentage ?? "—"}%</span> <span className="text-xs text-muted-foreground">comp</span></div>
          <div><span className="font-bold">{access.data?.contract_percentage ?? "—"}%</span> <span className="text-xs text-muted-foreground">contract</span></div>
          {access.data?.comp_approval_status && <span className="text-xs text-muted-foreground">· {access.data.comp_approval_status}</span>}
        </div>
        {editComp ? (
          <div className="flex items-center gap-1 flex-wrap">
            <Input type="number" value={compDraft} onChange={(e) => setCompDraft(e.target.value)} placeholder="comp %" className="h-8 w-24 text-xs" />
            <Input type="number" value={contractDraft} onChange={(e) => setContractDraft(e.target.value)} placeholder="contract %" className="h-8 w-28 text-xs" />
            <Button size="sm" className="h-8 px-3 text-xs" disabled={saveComp.isPending} onClick={() => saveComp.mutate()}>Save</Button>
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setEditComp(false)}>Cancel</Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => {
              setCompDraft(access.data?.comp_percentage != null ? String(access.data.comp_percentage) : "");
              setContractDraft(access.data?.contract_percentage != null ? String(access.data.contract_percentage) : "");
              setEditComp(true);
            }}>Update comp</Button>
            <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={copyLink}>Copy contracting link</Button>
          </div>
        )}
      </Card>

      {/* Pre-licensing (only when not yet licensed) */}
      {!isLicensed && sourceApplicationId && (
        <Card className="p-3">
          <div className="text-sm font-semibold mb-2">Pre-licensing progress</div>
          {prelicense.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {PRELICENSE_STEPS.map((s) => {
                const done = !!prelicense.data?.[s.key];
                return (
                  <span key={s.key} className={`inline-flex items-center gap-1 text-xs ${done ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />} {s.label}
                  </span>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
