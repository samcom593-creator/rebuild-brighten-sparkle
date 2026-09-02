import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, Save, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// MP-391 — agents own their licensing record.
//
// Every read and write goes through two SECURITY DEFINER RPCs
// (my_agent_profile / update_my_agent_profile) because the authenticated
// role has NO column grant on agents.nipr_number / license_number / eo_*
// (the MP-329 read-leak closure). The RPC owns the whitelist, the NPN
// uniqueness check, the contracting_intakes sync and the audit_log row;
// this component only decides WHICH keys changed and sends those.
//
// With no `agentId` prop it edits the signed-in agent's own row. With one,
// it is the admin path (the RPC refuses p_agent_id for non-admins), and the
// license_status select appears because can_edit_status comes back true.

interface LicensingRecord {
  agent_id: string;
  display_name: string | null;
  email: string | null;
  nipr_number: string | null;
  nipr_verified: boolean;
  nipr_verified_at: string | null;
  license_number: string | null;
  license_status: "licensed" | "unlicensed" | "pending" | null;
  license_states: string[];
  license_expires_at: string | null;
  licensed_at: string | null;
  contracting_contact_name: string | null;
  eo_policy_number: string | null;
  eo_expires_at: string | null;
  eo_certificate_url: string | null;
  eft_ready: boolean | null;
  can_edit_status: boolean;
  is_admin_view: boolean;
}

type FormState = {
  display_name: string;
  nipr_number: string;
  license_number: string;
  license_states: string;
  license_expires_at: string;
  license_status: "" | "licensed" | "unlicensed" | "pending";
  contracting_contact_name: string;
  eo_policy_number: string;
  eo_expires_at: string;
  eo_certificate_url: string;
};

const FIELD_LABELS: Record<keyof FormState, string> = {
  display_name: "display name",
  nipr_number: "NPN",
  license_number: "license number",
  license_states: "licensed states",
  license_expires_at: "license expiry",
  license_status: "license status",
  contracting_contact_name: "contracting contact",
  eo_policy_number: "E&O policy number",
  eo_expires_at: "E&O expiry",
  eo_certificate_url: "E&O certificate link",
};

// timestamptz / date -> the YYYY-MM-DD an <input type="date"> wants.
const toDateInput = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");

const toForm = (r: LicensingRecord): FormState => ({
  display_name: r.display_name ?? "",
  nipr_number: r.nipr_number ?? "",
  license_number: r.license_number ?? "",
  license_states: (r.license_states ?? []).join(", "),
  license_expires_at: toDateInput(r.license_expires_at),
  license_status: r.license_status ?? "",
  contracting_contact_name: r.contracting_contact_name ?? "",
  eo_policy_number: r.eo_policy_number ?? "",
  eo_expires_at: toDateInput(r.eo_expires_at),
  eo_certificate_url: r.eo_certificate_url ?? "",
});

// Only the keys the user actually changed go over the wire; an emptied
// field is sent as null so the RPC clears it instead of ignoring it.
function buildPatch(before: FormState, after: FormState): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  (Object.keys(after) as (keyof FormState)[]).forEach((k) => {
    if (before[k] === after[k]) return;
    const v = after[k].trim();
    if (k === "license_states") {
      patch[k] = v
        ? v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        : [];
      return;
    }
    if (k === "license_status") {
      if (v) patch[k] = v;
      return;
    }
    patch[k] = v === "" ? null : v;
  });
  return patch;
}

export function AgentLicensingEditor({ agentId }: { agentId?: string | null }) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["my-agent-licensing", agentId ?? "self"], [agentId]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "my_agent_profile" as never,
        (agentId ? { p_agent_id: agentId } : {}) as never,
      );
      if (error) throw error;
      return (data ?? null) as LicensingRecord | null;
    },
  });

  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => {
    if (data) setForm(toForm(data));
  }, [data]);

  const baseline = useMemo(() => (data ? toForm(data) : null), [data]);
  const dirtyKeys = useMemo(() => {
    if (!form || !baseline) return [] as (keyof FormState)[];
    return (Object.keys(form) as (keyof FormState)[]).filter((k) => form[k] !== baseline[k]);
  }, [form, baseline]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form || !baseline) throw new Error("Nothing loaded yet");
      const patch = buildPatch(baseline, form);
      const { data: after, error } = await supabase.rpc(
        "update_my_agent_profile" as never,
        { p_patch: patch, p_agent_id: agentId ?? null } as never,
      );
      if (error) throw error;
      return { after: after as LicensingRecord, changed: Object.keys(patch) as (keyof FormState)[] };
    },
    onSuccess: ({ after, changed }) => {
      const what = changed.map((k) => FIELD_LABELS[k] ?? k).join(", ");
      const npnNote = changed.includes("nipr_number") && after?.nipr_number
        ? " — NPN will show as unverified until it is re-checked"
        : "";
      toast.success(`Saved ${what}${npnNote}`);
      qc.setQueryData(queryKey, after);
      qc.invalidateQueries({ queryKey: ["producer-profile-detail"] });
      qc.invalidateQueries({ queryKey: ["agent"] });
      qc.invalidateQueries({ queryKey: ["contracting-readiness"] });
    },
    onError: (e: Error) => {
      // The RPC's messages are already written for the agent
      // ("that NPN is already on file for another agent — contact your manager…").
      toast.error(e.message);
    },
  });

  if (isLoading) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-5 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-5 flex items-center justify-between gap-3">
          <p className="text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Could not load licensing record: {(error as Error).message}
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data || !form) {
    return (
      <Card className="border-border/60">
        <CardContent className="p-5">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Licensing &amp; Contracting
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            No agent record is linked to this login yet. Ask your manager to link your
            agent profile and this section will unlock.
          </p>
        </CardContent>
      </Card>
    );
  }

  const set = (k: keyof FormState) => (v: string) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const npnBadge = data.nipr_number ? (
    data.nipr_verified ? (
      <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Verified{data.nipr_verified_at ? ` ${toDateInput(data.nipr_verified_at)}` : ""}
      </Badge>
    ) : (
      <Badge variant="outline" className="text-amber-600 border-amber-500/40">
        Not yet verified
      </Badge>
    )
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Not on file
    </Badge>
  );

  return (
    <Card className="border-border/60">
      <CardContent className="p-5 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> Licensing &amp; Contracting
              {data.is_admin_view && (
                <Badge variant="secondary" className="ml-1">
                  Admin editing {data.display_name ?? "agent"}
                </Badge>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.is_admin_view
                ? "Changes are audited under your admin login."
                : "This is your record. Keep your NPN and license details current so contracting and carrier appointments are not held up."}
            </p>
          </div>
          {data.email && (
            <p className="text-xs text-muted-foreground">{data.email}</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="lic-npn" className="flex items-center gap-2">
              National Producer Number (NPN) {npnBadge}
            </Label>
            <Input
              id="lic-npn"
              inputMode="numeric"
              placeholder="Digits only — from nipr.com"
              value={form.nipr_number}
              onChange={(e) => set("nipr_number")(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Your NPN is the key carriers use to appoint you. It must match NIPR exactly.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lic-number">License number</Label>
            <Input
              id="lic-number"
              value={form.license_number}
              onChange={(e) => set("license_number")(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lic-states">Licensed states</Label>
            <Input
              id="lic-states"
              placeholder="AZ, TX, FL"
              value={form.license_states}
              onChange={(e) => set("license_states")(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lic-expires">License expires</Label>
            <Input
              id="lic-expires"
              type="date"
              value={form.license_expires_at}
              onChange={(e) => set("license_expires_at")(e.target.value)}
            />
          </div>

          {data.can_edit_status ? (
            <div className="space-y-1.5">
              <Label htmlFor="lic-status">License status (admin)</Label>
              <Select
                value={form.license_status || undefined}
                onValueChange={(v) => set("license_status")(v)}
              >
                <SelectTrigger id="lic-status">
                  <SelectValue placeholder="Set status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unlicensed">Unlicensed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="licensed">Licensed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>License status</Label>
              <div className="h-10 flex items-center">
                <Badge variant="outline" className="capitalize">
                  {data.license_status ?? "unknown"}
                </Badge>
                <span className="text-[11px] text-muted-foreground ml-2">
                  set by your manager
                </span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="lic-display">Display name (leaderboards)</Label>
            <Input
              id="lic-display"
              value={form.display_name}
              onChange={(e) => set("display_name")(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lic-contact">Contracting contact name</Label>
            <Input
              id="lic-contact"
              placeholder="Name exactly as it appears on your contracting paperwork"
              value={form.contracting_contact_name}
              onChange={(e) => set("contracting_contact_name")(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lic-eo-policy">E&amp;O policy number</Label>
            <Input
              id="lic-eo-policy"
              value={form.eo_policy_number}
              onChange={(e) => set("eo_policy_number")(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lic-eo-expires">E&amp;O expires</Label>
            <Input
              id="lic-eo-expires"
              type="date"
              value={form.eo_expires_at}
              onChange={(e) => set("eo_expires_at")(e.target.value)}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="lic-eo-url">E&amp;O certificate link</Label>
            <Input
              id="lic-eo-url"
              type="url"
              placeholder="https://…"
              value={form.eo_certificate_url}
              onChange={(e) => set("eo_certificate_url")(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-muted-foreground">
            {dirtyKeys.length === 0
              ? "No unsaved changes"
              : `Unsaved: ${dirtyKeys.map((k) => FIELD_LABELS[k]).join(", ")}`}
          </p>
          <div className="flex gap-2">
            {dirtyKeys.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => baseline && setForm(baseline)}
                disabled={save.isPending}
              >
                Discard
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={dirtyKeys.length === 0 || save.isPending}
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              {save.isPending ? "Saving…" : "Save licensing"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default AgentLicensingEditor;
