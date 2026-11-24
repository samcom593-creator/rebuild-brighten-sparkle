import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ETHOS_CONSUMER_CAMPAIGN_KEY } from "../../../supabase/functions/_shared/ethos-consumer-campaign";

type Scope = { state: string; license_status: string; license_evidence_ref: string | null; license_expires_at: string | null; license_verified_at: string | null; ethos_eligible: boolean; ethos_evidence_ref: string | null; ethos_verified_at: string | null };
type Settings = { campaign: { sends_enabled: boolean }; scope: Scope[] };

export function EthosConsumerSettings({ onChanged }: { onChanged: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState("");
  const [licenseRef, setLicenseRef] = useState("");
  const [expires, setExpires] = useState("");
  const [ethosRef, setEthosRef] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const call = async (body: Record<string, unknown>) => {
    const { data, error: requestError } = await supabase.functions.invoke("ethos-consumer-campaign", { body: { campaign_key: ETHOS_CONSUMER_CAMPAIGN_KEY, ...body } });
    if (requestError) {
      const response = (requestError as { context?: Response }).context;
      const detail = response?.clone ? await response.clone().json().catch(() => { throw new Error(requestError.message); }) : null;
      throw new Error(detail?.error ?? requestError.message);
    }
    if (!data?.ok) throw new Error(data?.error ?? "State evidence could not be loaded.");
    return data;
  };
  const load = async () => { const data = await call({ action: "settings" }); setSettings(data as Settings); };
  useEffect(() => {
    if (!open) return;
    let current = true;
    setBusy(true); setError(null); setSettings(null);
    void call({ action: "settings" }).then((data) => { if (current) setSettings(data as Settings); }).catch((e) => { if (current) { setSettings(null); setError((e as Error).message); } }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [open, loadAttempt]);
  const change = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null); onChanged(); setReviewed(false);
    try { await call(body); await load(); }
    catch (e) { setSettings(null); setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const save = () => {
    // US state-license expiry dates are recorded conservatively at the start
    // of the stated date in UTC; no residency or area-code inference occurs.
    if (!expires || !Number.isFinite(Date.parse(`${expires}T00:00:00Z`))) { setError("Choose the license expiration date from the evidence."); return; }
    void change({ action: "save_scope", state, license_evidence_ref: licenseRef.trim(), license_expires_at: `${expires}T00:00:00Z`, ethos_evidence_ref: ethosRef.trim() || null, evidence_reviewed: reviewed });
  };
  return <section className="rounded-lg border border-border p-3">
    <Button type="button" variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => { setSettings(null); setError(null); setOpen((v) => !v); }} aria-expanded={open}>Licensed states and sending settings</Button>
    {open ? <div className="mt-3 space-y-4">
      <p className="text-xs text-muted-foreground">Only the campaign owner can record evidence or change sending. These are owner-recorded verifications; a home state or dropdown choice is not evidence.</p>
      {error ? <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" disabled={busy} onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry state evidence</Button></div> : null}
      {settings ? <>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Sending {settings.campaign.sends_enabled ? "enabled" : "disabled"}</p><Button type="button" variant="outline" disabled={busy} onClick={() => void change({ action: "set_enabled", enabled: !settings.campaign.sends_enabled })}>{settings.campaign.sends_enabled ? "Disable sending" : "Enable reviewed sends"}</Button></div>
        <p className="text-xs text-muted-foreground">Enabling sending does not send a message. Each send uses the recipients selected from a current batch preview.</p>
        {settings.scope.length ? <ul className="space-y-2">{settings.scope.map((s) => <li key={s.state} className="rounded-md border border-border p-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{s.state}: {s.license_status !== "active" ? "Inactive" : !s.license_expires_at || Date.parse(s.license_expires_at) <= Date.now() ? "License evidence expired" : s.ethos_eligible ? "License and Ethos evidence recorded" : "Ethos eligibility evidence missing"}</span><Button type="button" variant="ghost" size="sm" disabled={busy || s.license_status !== "active"} onClick={() => void change({ action: "deactivate_scope", state: s.state })}>Deactivate {s.state}</Button></div><p className="mt-1 break-words text-xs text-muted-foreground">License: {s.license_evidence_ref ?? "Missing"}{s.license_expires_at ? ` · Expires ${s.license_expires_at.slice(0, 10)}` : ""}</p><p className="break-words text-xs text-muted-foreground">Ethos: {s.ethos_evidence_ref ?? "Not recorded"}</p></li>)}</ul> : <p className="text-sm">No states recorded. Consumer emails remain blocked.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="ethos-scope-state">Licensed state code</Label><Input id="ethos-scope-state" maxLength={2} value={state} onChange={(e) => { setState(e.target.value.toUpperCase()); setReviewed(false); }} placeholder="WI" /></div>
          <div className="space-y-1"><Label htmlFor="ethos-scope-expiry">License expiration date</Label><Input id="ethos-scope-expiry" type="date" value={expires} onChange={(e) => { setExpires(e.target.value); setReviewed(false); }} /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="ethos-scope-license">Active life-license evidence reference</Label><Input id="ethos-scope-license" value={licenseRef} onChange={(e) => { setLicenseRef(e.target.value); setReviewed(false); }} placeholder="Regulator record or verified license document" /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="ethos-scope-eligibility">Ethos state/product eligibility evidence reference</Label><Input id="ethos-scope-eligibility" value={ethosRef} onChange={(e) => { setEthosRef(e.target.value); setReviewed(false); }} placeholder="Verified carrier record; leave blank to keep this state blocked" /></div>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I checked the named evidence and its expiration for this state.</label>
        <Button type="button" disabled={busy || !reviewed || state.length !== 2 || !licenseRef.trim() || !expires} onClick={save}>Save state evidence</Button>
      </> : busy ? <p role="status" className="text-sm">Loading state evidence…</p> : null}
    </div> : null}
  </section>;
}
