import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, FileCheck2, Loader2, Save, ShieldCheck, Trophy, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyDownline } from "@/hooks/useMyDownline";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type PremiumMode = "annual" | "semiannual" | "quarterly" | "monthly" | "single_pay" | "other";
type DealSection = "client" | "policy" | "premium" | "evidence" | "review";

interface DealForm {
  clientFirstName: string;
  clientLastName: string;
  clientPhone: string;
  clientDob: string;
  carrierId: string;
  product: string;
  policyNumber: string;
  applicationDate: string;
  effectiveDate: string;
  leadSource: string;
  premiumMode: PremiumMode;
  modalPremium: string;
  annualizedPaidPremium: string;
  annualizedCommissionablePremium: string;
  faceAmount: string;
  calculationNeedsReview: boolean;
  communityCaption: string;
  notes: string;
}

interface AgentOption {
  id: string;
  displayName: string;
  managerId: string | null;
}

interface EvidenceRow {
  id: string;
  draft_id: string;
  object_path: string;
  original_file_name: string;
  size_bytes: number;
  scan_status: string;
}

interface Receipt {
  dealId: string;
  status: string;
  downstreamState: string;
  correlationId: string;
}

const SECTIONS: Array<{ key: DealSection; label: string }> = [
  { key: "client", label: "Client" },
  { key: "policy", label: "Policy & Product" },
  { key: "premium", label: "Premium" },
  { key: "evidence", label: "Evidence" },
  { key: "review", label: "Review" },
];

const TODAY = new Date().toISOString().slice(0, 10);
const EMPTY_FORM: DealForm = {
  clientFirstName: "",
  clientLastName: "",
  clientPhone: "",
  clientDob: "",
  carrierId: "",
  product: "",
  policyNumber: "",
  applicationDate: TODAY,
  effectiveDate: "",
  leadSource: "",
  premiumMode: "monthly",
  modalPremium: "",
  annualizedPaidPremium: "",
  annualizedCommissionablePremium: "",
  faceAmount: "",
  calculationNeedsReview: false,
  communityCaption: "",
  notes: "",
};

const MODE_FACTOR: Record<PremiumMode, number | null> = {
  annual: 1,
  semiannual: 2,
  quarterly: 4,
  monthly: 12,
  single_pay: 1,
  other: null,
};

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function safeNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: string | number): string {
  const amount = typeof value === "number" ? value : safeNumber(value);
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; error: { message?: string } | null }> {
  return (supabase.rpc as unknown as (fn: string, values: Record<string, unknown>) => Promise<{ data: T | null; error: { message?: string } | null }>)(name, args);
}

export function SubmitDealDialog({ trigger }: { trigger?: ReactNode }) {
  const { user, isAdmin, isManager } = useAuth();
  const downline = useMyDownline();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<DealForm>(EMPTY_FORM);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(newIdempotencyKey);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const storageKey = user?.id ? `apex.native-deal-draft.${user.id}` : "";

  const carriers = useQuery({
    queryKey: ["native-deal-carriers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("carriers" as never)
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ id: string; name: string }>;
    },
    staleTime: 10 * 60_000,
  });

  const ownAgent = useQuery({
    queryKey: ["native-deal-own-agent", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("id, display_name, manager_id")
        .eq("user_id", user!.id)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { id: data.id, displayName: data.display_name || "My agent record", managerId: data.manager_id } as AgentOption;
    },
  });

  const agentOptions = useQuery({
    queryKey: ["native-deal-agent-options", user?.id, isAdmin, isManager, downline.data?.join(",")],
    enabled: Boolean(user?.id) && (isAdmin || isManager) && (isAdmin || downline.isSuccess),
    queryFn: async () => {
      let query = supabase
        .from("agents")
        .select("id, display_name, manager_id")
        .neq("status", "terminated")
        .order("display_name")
        .limit(500);
      if (!isAdmin) query = query.in("id", downline.data ?? []);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        displayName: row.display_name || "Unnamed agent",
        managerId: row.manager_id,
      })) as AgentOption[];
    },
  });

  const availableAgents = useMemo(() => {
    if (isAdmin || isManager) return agentOptions.data ?? (ownAgent.data ? [ownAgent.data] : []);
    return ownAgent.data ? [ownAgent.data] : [];
  }, [agentOptions.data, isAdmin, isManager, ownAgent.data]);

  const writingAgent = availableAgents.find((agent) => agent.id === selectedAgentId) ?? ownAgent.data ?? null;
  const manager = useQuery({
    queryKey: ["native-deal-manager", writingAgent?.managerId],
    enabled: Boolean(writingAgent?.managerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("display_name")
        .eq("id", writingAgent!.managerId!)
        .maybeSingle();
      if (error) throw error;
      return data?.display_name || "Assigned manager";
    },
  });

  useEffect(() => {
    if (!selectedAgentId && ownAgent.data?.id) setSelectedAgentId(ownAgent.data.id);
  }, [ownAgent.data, selectedAgentId]);

  useEffect(() => {
    if (!open || !user?.id || !storageKey) return;
    let active = true;
    const recover = async () => {
      setRecovering(true);
      const storedKey = localStorage.getItem(storageKey);
      if (!storedKey) {
        localStorage.setItem(storageKey, idempotencyKey);
        setRecovering(false);
        return;
      }
      setIdempotencyKey(storedKey);
      const { data } = await supabase
        .from("deal_drafts" as never)
        .select("id, current_section, payload")
        .eq("owner_user_id", user.id)
        .eq("idempotency_key", storedKey)
        .eq("status", "draft")
        .maybeSingle();
      if (!active) return;
      const draft = data as unknown as { id: string; current_section: DealSection; payload: Partial<DealForm> } | null;
      if (draft) {
        setDraftId(draft.id);
        setForm((current) => ({ ...current, ...draft.payload }));
        const recoveredStep = Math.max(0, SECTIONS.findIndex((section) => section.key === draft.current_section));
        setStep(recoveredStep);
        setRecovered(true);
        const { data: rows } = await supabase
          .from("deal_attachments" as never)
          .select("id, draft_id, object_path, original_file_name, size_bytes, scan_status")
          .eq("draft_id", draft.id)
          .order("created_at");
        if (active) setEvidence((rows ?? []) as unknown as EvidenceRow[]);
      }
      setRecovering(false);
    };
    recover();
    return () => { active = false; };
  }, [idempotencyKey, open, storageKey, user?.id]);

  const factor = MODE_FACTOR[form.premiumMode];
  const calculatedAnnualPaid = factor === null ? safeNumber(form.annualizedPaidPremium) : safeNumber(form.modalPremium) * factor;
  const calculatedAlp = safeNumber(form.annualizedCommissionablePremium) || calculatedAnnualPaid;

  const update = <K extends keyof DealForm>(key: K, value: DealForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const validateStep = (index: number): string | null => {
    if (index === 0) {
      if (!form.clientFirstName.trim() || !form.clientLastName.trim()) return "Client first and last name are required.";
      if (form.clientPhone.replace(/\D/g, "").length < 10) return "Enter a valid client phone number.";
      if (!form.clientDob) return "Client date of birth is required.";
    }
    if (index === 1) {
      if (!selectedAgentId) return "A writing agent must be linked before the deal can be saved.";
      if (!form.carrierId || !form.product.trim() || !form.policyNumber.trim()) return "Carrier, product, and application or policy number are required.";
      if (!form.applicationDate) return "Application date is required.";
    }
    if (index === 2) {
      if (safeNumber(form.modalPremium) <= 0) return "Modal premium must be greater than zero.";
      if (calculatedAnnualPaid <= 0) return "Annualized paid premium must be greater than zero.";
      if (calculatedAlp <= 0) return "Annualized commissionable premium must be greater than zero.";
      if (safeNumber(form.faceAmount) <= 0) return "Face amount must be greater than zero.";
    }
    if (index === 3 && evidence.length === 0) return "Upload the policy image or supporting document before review.";
    return null;
  };

  const payload = useMemo(() => ({
    ...form,
    annualizedPaidPremium: calculatedAnnualPaid.toFixed(2),
    annualizedCommissionablePremium: calculatedAlp.toFixed(2),
    calculationNeedsReview: form.calculationNeedsReview || form.premiumMode === "single_pay" || form.premiumMode === "other" || evidence.some((file) => file.scan_status !== "clean"),
  }), [calculatedAlp, calculatedAnnualPaid, evidence, form]);

  const saveSection = async (section: DealSection): Promise<string | null> => {
    const { data, error } = await rpc<{ draftId?: string }>("save_apex_deal_draft", {
      p_idempotency_key: idempotencyKey,
      p_section: section,
      p_payload: payload,
    });
    if (error) {
      toast.error(error.message || "The draft could not be saved.");
      return null;
    }
    const savedDraftId = data?.draftId ?? draftId;
    if (savedDraftId) setDraftId(savedDraftId);
    if (storageKey) localStorage.setItem(storageKey, idempotencyKey);
    return savedDraftId ?? null;
  };

  const next = async () => {
    const validation = validateStep(step);
    if (validation) { toast.error(validation); return; }
    setSaving(true);
    const nextSection = SECTIONS[Math.min(step + 1, SECTIONS.length - 1)].key;
    const saved = await saveSection(nextSection);
    if (saved) setStep((current) => Math.min(current + 1, SECTIONS.length - 1));
    setSaving(false);
  };

  const uploadEvidence = async (file: File | undefined) => {
    if (!file || !user?.id) return;
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) { toast.error("Upload a JPG, PNG, WebP, or PDF file."); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Evidence must be 10 MB or smaller."); return; }

    setUploading(true);
    const savedDraftId = draftId ?? await saveSection("evidence");
    if (!savedDraftId) { setUploading(false); return; }
    const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const objectPath = `${user.id}/${idempotencyKey}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("apex-deal-evidence")
      .upload(objectPath, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      toast.error(`Evidence was not uploaded: ${uploadError.message}`);
      setUploading(false);
      return;
    }
    const { data, error } = await supabase
      .from("deal_attachments" as never)
      .insert({
        draft_id: savedDraftId,
        owner_user_id: user.id,
        object_path: objectPath,
        original_file_name: file.name.slice(0, 240),
        mime_type: file.type,
        size_bytes: file.size,
        scan_status: "pending",
      } as never)
      .select("id, draft_id, object_path, original_file_name, size_bytes, scan_status")
      .single();
    if (error) {
      await supabase.storage.from("apex-deal-evidence").remove([objectPath]);
      toast.error(`Evidence metadata was not saved: ${error.message}`);
    } else {
      setEvidence((current) => [...current, data as unknown as EvidenceRow]);
      toast.success("Evidence saved privately and queued for review.");
      if (fileInput.current) fileInput.current.value = "";
    }
    setUploading(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    for (let index = 0; index < 4; index += 1) {
      const validation = validateStep(index);
      if (validation) { setStep(index); toast.error(validation); return; }
    }
    setSaving(true);
    const saved = await saveSection("review");
    if (!saved) { setSaving(false); return; }
    const { data, error } = await rpc<{
      dealId?: string;
      status?: string;
      downstreamState?: string;
      correlationId?: string;
    }>("submit_apex_deal", {
      p_idempotency_key: idempotencyKey,
      p_payload: payload,
      p_agent_id: selectedAgentId || null,
    });
    if (error || !data?.dealId) {
      toast.error(error?.message || "The deal could not be submitted. Your draft remains saved.");
      setSaving(false);
      return;
    }
    const nextReceipt = {
      dealId: data.dealId,
      status: data.status || "submitted",
      downstreamState: data.downstreamState || "queued",
      correlationId: data.correlationId || "recorded",
    };
    setReceipt(nextReceipt);
    if (storageKey) localStorage.removeItem(storageKey);
    queryClient.invalidateQueries({ queryKey: ["deals"] });
    queryClient.invalidateQueries({ queryKey: ["news-feed"] });
    toast.success("Deal saved. Delivery is queued independently.");
    setSaving(false);
  };

  const resetAfterClose = () => {
    if (!receipt) return;
    setForm(EMPTY_FORM);
    setStep(0);
    setDraftId(null);
    setEvidence([]);
    setReceipt(null);
    setRecovered(false);
    const nextKey = newIdempotencyKey();
    setIdempotencyKey(nextKey);
    if (storageKey) localStorage.setItem(storageKey, nextKey);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) resetAfterClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="h-11 gap-2 sm:h-10">
            <Trophy className="h-4 w-4" />
            Add Deal
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[96dvh] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>{receipt ? "Deal saved" : "Add Deal"}</DialogTitle>
          <DialogDescription>
            {receipt
              ? "The deal is durable. Integration delivery continues independently."
              : "Native APEX submission with a recoverable server draft and review receipt."}
          </DialogDescription>
        </DialogHeader>

        {receipt ? (
          <div className="overflow-y-auto px-5 py-8">
            <div className="mx-auto max-w-lg rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
              <CheckCircle2 className="mb-3 h-8 w-8 text-emerald-500" />
              <h3 className="text-lg font-semibold">Safely submitted</h3>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <ReviewItem label="Deal ID" value={receipt.dealId} />
                <ReviewItem label="Saved status" value={receipt.status.replaceAll("_", " ")} />
                <ReviewItem label="Delivery" value={receipt.downstreamState} />
                <ReviewItem label="Correlation" value={receipt.correlationId} />
              </dl>
              <Button asChild className="mt-5 h-11 w-full sm:h-10">
                <Link to={`/dashboard/production?deal=${encodeURIComponent(receipt.dealId)}`} onClick={() => setOpen(false)}>
                  View deal
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
            <div className="border-b border-border px-4 py-3">
              <ol className="grid grid-cols-5 gap-1" aria-label="Deal sections">
                {SECTIONS.map((section, index) => (
                  <li key={section.key}>
                    <button
                      type="button"
                      onClick={() => { if (index <= step) setStep(index); }}
                      className={cn(
                        "min-h-11 w-full rounded-md px-1 text-[11px] font-medium transition-colors sm:text-xs",
                        index === step ? "bg-primary/15 text-primary" : index < step ? "text-emerald-500" : "text-muted-foreground",
                      )}
                      aria-current={index === step ? "step" : undefined}
                    >
                      <span className="block tabular-nums">{index + 1}</span>
                      <span className="hidden sm:block">{section.label}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {recovering && <p className="mb-4 text-sm text-muted-foreground">Recovering saved draft…</p>}
              {recovered && !recovering && (
                <div className="mb-4 rounded-md border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-sm text-sky-700 dark:text-sky-300">
                  Your last server-saved draft was recovered.
                </div>
              )}

              <div className="mb-5 grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2">
                {(isAdmin || isManager) && availableAgents.length > 1 ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="deal-writing-agent">Writing agent</Label>
                    <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                      <SelectTrigger id="deal-writing-agent" className="h-11 sm:h-10"><SelectValue placeholder="Select writing agent" /></SelectTrigger>
                      <SelectContent>{availableAgents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.displayName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                ) : <ReviewItem label="Writing agent" value={writingAgent?.displayName || "Linking account…"} />}
                <ReviewItem label="Manager / upline" value={writingAgent?.managerId ? manager.data || "Loading assigned manager…" : "No manager assigned"} />
              </div>

              {step === 0 && (
                <Section title="Client" description="Client identity is restricted operational data and is never copied into community posts.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="First name" id="deal-first-name" value={form.clientFirstName} onChange={(value) => update("clientFirstName", value)} autoComplete="given-name" />
                    <Field label="Last name" id="deal-last-name" value={form.clientLastName} onChange={(value) => update("clientLastName", value)} autoComplete="family-name" />
                    <Field label="Phone" id="deal-phone" value={form.clientPhone} onChange={(value) => update("clientPhone", value)} type="tel" autoComplete="tel" />
                    <Field label="Date of birth" id="deal-dob" value={form.clientDob} onChange={(value) => update("clientDob", value)} type="date" />
                  </div>
                </Section>
              )}

              {step === 1 && (
                <Section title="Policy & Product" description="Carrier and application details are checked again by the server before create.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="deal-carrier">Carrier</Label>
                      <Select value={form.carrierId} onValueChange={(value) => update("carrierId", value)}>
                        <SelectTrigger id="deal-carrier" className="h-11 sm:h-10"><SelectValue placeholder="Select carrier" /></SelectTrigger>
                        <SelectContent>{(carriers.data ?? []).map((carrier) => <SelectItem key={carrier.id} value={carrier.id}>{carrier.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Field label="Product" id="deal-product" value={form.product} onChange={(value) => update("product", value)} placeholder="Product or plan name" />
                    <Field label="Application or policy number" id="deal-policy" value={form.policyNumber} onChange={(value) => update("policyNumber", value)} autoComplete="off" />
                    <Field label="Application date" id="deal-application-date" value={form.applicationDate} onChange={(value) => update("applicationDate", value)} type="date" max={TODAY} />
                    <Field label="Effective date (when known)" id="deal-effective-date" value={form.effectiveDate} onChange={(value) => update("effectiveDate", value)} type="date" />
                    <Field label="Lead source" id="deal-lead-source" value={form.leadSource} onChange={(value) => update("leadSource", value)} />
                  </div>
                </Section>
              )}

              {step === 2 && (
                <Section title="Premium & Production" description="Recurring modes annualize automatically. Target, excess, single-pay, and other rules require review.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="deal-premium-mode">Premium mode</Label>
                      <Select value={form.premiumMode} onValueChange={(value) => update("premiumMode", value as PremiumMode)}>
                        <SelectTrigger id="deal-premium-mode" className="h-11 sm:h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="annual">Annual</SelectItem><SelectItem value="semiannual">Semiannual</SelectItem>
                          <SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="single_pay">Single Pay</SelectItem><SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Field label="Modal premium" id="deal-modal-premium" value={form.modalPremium} onChange={(value) => update("modalPremium", value)} type="number" min="0.01" step="0.01" inputMode="decimal" />
                    <Field label="Annualized paid premium" id="deal-paid-premium" value={factor === null ? form.annualizedPaidPremium : calculatedAnnualPaid ? calculatedAnnualPaid.toFixed(2) : ""} onChange={(value) => update("annualizedPaidPremium", value)} type="number" min="0.01" step="0.01" inputMode="decimal" readOnly={factor !== null} />
                    <Field label="Annualized commissionable premium / ALP" id="deal-alp" value={form.annualizedCommissionablePremium} onChange={(value) => update("annualizedCommissionablePremium", value)} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder={calculatedAnnualPaid ? calculatedAnnualPaid.toFixed(2) : "Carrier-provided ALP"} />
                    <Field label="Face amount / death benefit" id="deal-face" value={form.faceAmount} onChange={(value) => update("faceAmount", value)} type="number" min="1" step="1" inputMode="decimal" />
                  </div>
                  <div className="mt-4 rounded-md border border-border bg-muted/20 p-3 text-sm">
                    <p className="font-medium">Calculation preview</p>
                    <p className="mt-1 text-muted-foreground">
                      {factor === null ? "Annual paid premium is entered directly for this mode." : `${formatMoney(form.modalPremium)} × ${factor} payments = ${formatMoney(calculatedAnnualPaid)} annual paid premium.`}
                      {" "}Commissionable premium: {formatMoney(calculatedAlp)}.
                    </p>
                    <label className="mt-3 flex min-h-11 items-center gap-2">
                      <input type="checkbox" checked={form.calculationNeedsReview} onChange={(event) => update("calculationNeedsReview", event.target.checked)} className="h-4 w-4" />
                      Carrier target/excess rules require manager verification
                    </label>
                  </div>
                </Section>
              )}

              {step === 3 && (
                <Section title="Supporting Evidence" description="Private evidence is restricted to this deal and remains pending until the configured scan/review step clears it.">
                  <div className="rounded-lg border border-dashed border-border p-4">
                    <Label htmlFor="deal-evidence" className="block">Policy image or supporting document</Label>
                    <p className="mt-1 text-sm text-muted-foreground">JPG, PNG, WebP, or PDF · maximum 10 MB</p>
                    <Input ref={fileInput} id="deal-evidence" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="mt-3 h-11 pt-2 sm:h-10" onChange={(event) => uploadEvidence(event.target.files?.[0])} disabled={uploading} />
                    {uploading && <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Uploading privately…</p>}
                  </div>
                  <div className="mt-4 space-y-2">
                    {evidence.map((file) => (
                      <div key={file.id} className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                        <span className="min-w-0 truncate"><FileCheck2 className="mr-2 inline h-4 w-4" />{file.original_file_name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{Math.ceil(file.size_bytes / 1024)} KB · {file.scan_status}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-4">
                    <div className="space-y-1.5"><Label htmlFor="deal-caption">Optional privacy-safe win caption</Label><Input id="deal-caption" value={form.communityCaption} onChange={(event) => update("communityCaption", event.target.value)} maxLength={240} /></div>
                    <div className="space-y-1.5"><Label htmlFor="deal-notes">Internal notes</Label><Textarea id="deal-notes" value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={3} /></div>
                  </div>
                </Section>
              )}

              {step === 4 && (
                <Section title="Review" description="This is the exact operational record. Community delivery never includes client identity, phone, birth date, policy number, notes, or documents.">
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <ReviewItem label="Client" value={`${form.clientFirstName} ${form.clientLastName}`} />
                    <ReviewItem label="Client phone" value={form.clientPhone} />
                    <ReviewItem label="Writing agent" value={writingAgent?.displayName || "—"} />
                    <ReviewItem label="Manager / upline" value={manager.data || "No manager assigned"} />
                    <ReviewItem label="Carrier" value={carriers.data?.find((carrier) => carrier.id === form.carrierId)?.name || "—"} />
                    <ReviewItem label="Product" value={form.product} />
                    <ReviewItem label="Application / policy" value={form.policyNumber} />
                    <ReviewItem label="Application date" value={form.applicationDate} />
                    <ReviewItem label="Annual paid premium" value={formatMoney(calculatedAnnualPaid)} />
                    <ReviewItem label="Commissionable premium / ALP" value={formatMoney(calculatedAlp)} />
                    <ReviewItem label="Face amount" value={formatMoney(form.faceAmount)} />
                    <ReviewItem label="Evidence" value={`${evidence.length} private file${evidence.length === 1 ? "" : "s"} · review pending`} />
                  </dl>
                  <div className="mt-4 rounded-md border border-sky-500/25 bg-sky-500/5 p-3 text-sm">
                    <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" /><p><strong>Submission receipt:</strong> the deal saves first. Discord, Skool, AgentLink, scanning, and analytics delivery are queued separately and cannot erase or duplicate this record.</p></div>
                  </div>
                </Section>
              )}
            </div>

            <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border px-5 py-4 sm:justify-between">
              <Button type="button" variant="outline" className="h-11 sm:h-10" disabled={saving || step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              {step < SECTIONS.length - 1 ? (
                <Button type="button" className="h-11 gap-2 sm:h-10" disabled={saving || recovering} onClick={next}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save & continue <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button type="submit" className="h-11 gap-2 sm:h-10" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Submit deal
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section><h3 className="text-base font-semibold">{title}</h3><p className="mb-4 mt-1 text-sm text-muted-foreground">{description}</p>{children}</section>;
}

function Field({ label, id, value, onChange, ...props }: { label: string; id: string; value: string; onChange: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, "id" | "value" | "onChange">) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input {...props} id={id} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 sm:h-10" /></div>;
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-md border border-border bg-background px-3 py-2"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium capitalize">{value || "—"}</dd></div>;
}
