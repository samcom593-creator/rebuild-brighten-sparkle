import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FilePlus2, FileCheck2, Loader2, Plus, Search, ShieldCheck, Trash2, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyDownline } from "@/hooks/useMyDownline";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { invalidateOperationalTruth } from "@/lib/invalidateOperationalTruth";
import { normalizePolicyNumber, sanitizePolicyInput } from "@/lib/policyNumber";

type PremiumMode = "annual" | "semiannual" | "quarterly" | "monthly" | "single_pay" | "other";
type PaymentMethod = "" | "bank_draft" | "credit_card" | "debit_card" | "direct_express" | "check" | "social_security";
type PolicyStatus = "Issued, Not Paid" | "Active" | "In Review" | "Pending" | "Approved" | "Lapse Pending" | "Lapsed" | "Cancelled" | "Withdrawn" | "Not Taken" | "Postponed" | "Declined";
type DealSection = "client" | "policy" | "premium" | "evidence" | "review";
type ClientMode = "new" | "existing";

interface ClientHit {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  date_of_birth: string | null;
}

interface BeneficiaryForm {
  id: string;
  firstName: string;
  lastName: string;
  relationship: string;
  allocationPct: string;
}

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
  policyStatus: PolicyStatus;
  premiumMode: PremiumMode;
  paymentMethod: PaymentMethod;
  draftDay: string;
  modalPremium: string;
  annualizedPaidPremium: string;
  annualizedCommissionablePremium: string;
  faceAmount: string;
  calculationNeedsReview: boolean;
  communityCaption: string;
  notes: string;
  beneficiaries: BeneficiaryForm[];
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
  policyStatus: "Issued, Not Paid",
  premiumMode: "monthly",
  paymentMethod: "",
  draftDay: "",
  modalPremium: "",
  annualizedPaidPremium: "",
  annualizedCommissionablePremium: "",
  faceAmount: "",
  calculationNeedsReview: false,
  communityCaption: "",
  notes: "",
  beneficiaries: [],
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

// PostgREST hands .ilike() straight through to SQL LIKE, so an unescaped % or
// _ typed into the client search stops being a substring match and starts
// matching everything. Escape the four metacharacters PostgREST honours (it
// rewrites * to % before SQL) so the box behaves the way a person expects.
function likeLiteral(term: string): string {
  return term.replace(/[\\%_*]/g, (character) => `\\${character}`);
}

function rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; error: { message?: string } | null }> {
  return (supabase.rpc as unknown as (fn: string, values: Record<string, unknown>) => Promise<{ data: T | null; error: { message?: string } | null }>)(name, args);
}

interface InitialDealClient {
  firstName: string;
  lastName: string;
  phone: string;
  dob: string;
}

export function SubmitDealDialog({ trigger, initialClient }: { trigger?: ReactNode; initialClient?: InitialDealClient }) {
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
  const [clientMode, setClientMode] = useState<ClientMode>("new");
  const [clientSearch, setClientSearch] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [linkedClient, setLinkedClient] = useState<ClientHit | null>(null);
  const [checking, setChecking] = useState(false);
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

  const carrierProducts = useQuery({
    queryKey: ["native-deal-carrier-products", form.carrierId],
    enabled: Boolean(form.carrierId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_carrier_products" as never)
        .select("product, deals_written")
        .eq("carrier_id", form.carrierId)
        .order("deals_written", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ product: string; deals_written: number }>;
    },
    staleTime: 10 * 60_000,
  });

  // Existing Client mode reads the real client mirror. agentlink_clients is
  // role-scoped by RLS, so an agent only ever searches clients they can see.
  const clientHits = useQuery({
    queryKey: ["native-deal-client-search", clientQuery],
    enabled: open && clientMode === "existing" && clientQuery.trim().length >= 2,
    queryFn: async () => {
      const term = likeLiteral(clientQuery.trim());
      const digits = clientQuery.replace(/\D/g, "");
      const filters = [`first_name.ilike.%${term}%`, `last_name.ilike.%${term}%`];
      if (digits.length >= 4) filters.push(`phone.ilike.%${digits}%`);
      const { data, error } = await supabase
        .from("agentlink_clients" as never)
        .select("id, first_name, last_name, phone, date_of_birth")
        .or(filters.join(","))
        .order("last_name")
        .limit(25);
      if (error) throw error;
      return (data ?? []) as unknown as ClientHit[];
    },
  });

  const ownAgent = useQuery({
    queryKey: ["native-deal-own-agent", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      // agents carries no unique index on user_id. .maybeSingle() returns null
      // on a duplicated identity, which reads as "this person has no agent
      // record" and locks them out of posting — take the first row instead.
      const { data, error } = await supabase
        .from("agents")
        .select("id, display_name, manager_id")
        .eq("user_id", user!.id)
        .order("created_at")
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0];
      if (!row) return null;
      return { id: row.id, displayName: row.display_name || "My agent record", managerId: row.manager_id } as AgentOption;
    },
  });

  // Sam removed Alyjah Rowland from the roster (roster_exclusions, "GHOST_336
  // sync artifact") and he must appear nowhere. The writing-agent picker
  // filtered on status <> 'terminated', and his row is 'inactive' — so the one
  // agent who is not supposed to exist was selectable as the writer of a new
  // deal. Read the canonical exclusion table rather than inventing a second
  // roster definition.
  const excludedAgentIds = useQuery({
    queryKey: ["roster-exclusions"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("roster_exclusions" as never).select("agent_id");
      if (error) throw error;
      return new Set((data ?? []).map((row) => (row as unknown as { agent_id: string }).agent_id));
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
    const excluded = excludedAgentIds.data ?? new Set<string>();
    const base = (isAdmin || isManager)
      ? agentOptions.data ?? (ownAgent.data ? [ownAgent.data] : [])
      : ownAgent.data ? [ownAgent.data] : [];
    return base.filter((agent) => !excluded.has(agent.id));
  }, [agentOptions.data, excludedAgentIds.data, isAdmin, isManager, ownAgent.data]);

  const writingAgent = availableAgents.find((agent) => agent.id === selectedAgentId) ?? ownAgent.data ?? null;
  const manager = useQuery({
    queryKey: ["native-deal-manager", writingAgent?.managerId],
    enabled: Boolean(writingAgent?.managerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("display_name")
        .eq("id", writingAgent!.managerId!)
        .limit(1);
      if (error) throw error;
      return (data ?? [])[0]?.display_name || "Assigned manager";
    },
  });

  useEffect(() => {
    if (!selectedAgentId && ownAgent.data?.id) setSelectedAgentId(ownAgent.data.id);
  }, [ownAgent.data, selectedAgentId]);

  useEffect(() => {
    const timer = setTimeout(() => setClientQuery(clientSearch), 300);
    return () => clearTimeout(timer);
  }, [clientSearch]);

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

  const addBeneficiary = () => {
    if (form.beneficiaries.length >= 10) return;
    update("beneficiaries", [...form.beneficiaries, { id: crypto.randomUUID(), firstName: "", lastName: "", relationship: "", allocationPct: "" }]);
  };

  const updateBeneficiary = (index: number, patch: Partial<BeneficiaryForm>) => {
    update("beneficiaries", form.beneficiaries.map((beneficiary, row) => row === index ? { ...beneficiary, ...patch } : beneficiary));
  };

  const removeBeneficiary = (index: number) => {
    update("beneficiaries", form.beneficiaries.filter((_, row) => row !== index));
  };

  const validateStep = (index: number): string | null => {
    if (index === 0) {
      if (!form.clientFirstName.trim() || !form.clientLastName.trim()) return "Client first and last name are required.";
      if (form.clientPhone.replace(/\D/g, "").length < 10) return "Enter a valid client phone number.";
      if (!form.clientDob) return "Client date of birth is required.";
    }
    if (index === 1) {
      if (!selectedAgentId) return "A writing agent must be linked before the deal can be saved.";
      if (!form.carrierId || !form.product.trim() || !normalizePolicyNumber(form.policyNumber)) return "Carrier, product, and application or policy number are required.";
      if (!form.applicationDate) return "Application date is required.";
    }
    if (index === 2) {
      if (safeNumber(form.modalPremium) <= 0) return "Modal premium must be greater than zero.";
      if (calculatedAnnualPaid <= 0) return "Annualized paid premium must be greater than zero.";
      if (calculatedAlp <= 0) return "Annualized commissionable premium must be greater than zero.";
      if (safeNumber(form.faceAmount) <= 0) return "Face amount must be greater than zero.";
      if (form.draftDay && (!/^\d{1,2}$/.test(form.draftDay) || Number(form.draftDay) < 1 || Number(form.draftDay) > 28)) return "Draft day must be between 1 and 28.";
      for (const beneficiary of form.beneficiaries) {
        if (!beneficiary.firstName.trim() || !beneficiary.lastName.trim()) return "Every beneficiary needs a first and last name.";
        if (beneficiary.allocationPct && (safeNumber(beneficiary.allocationPct) < 0 || safeNumber(beneficiary.allocationPct) > 100)) return "Beneficiary allocation must be between 0 and 100%.";
      }
    }
    if (index === 3 && evidence.length === 0) return "Upload the policy image or supporting document before review.";
    return null;
  };

  const payload = useMemo(() => ({
    ...form,
    policyNumber: normalizePolicyNumber(form.policyNumber),
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

  // Pre-flight. Runs the same gates the submit runs, then asks the database the
  // one question the browser cannot answer on its own: is this application or
  // policy number already on a deal? submit_apex_deal rejects a duplicate with
  // 23505, so catching it here turns a failed post into a corrected one before
  // anything is written.
  const runCheck = async () => {
    for (let index = 0; index < 3; index += 1) {
      const validation = validateStep(index);
      if (validation) { toast.error(validation); return; }
    }
    setChecking(true);
    // Ask about the normalized string, because that is what submit_apex_deal
    // stores: a pasted tab used to make these two disagree.
    const policyNumber = normalizePolicyNumber(form.policyNumber);
    const { count, error } = await supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .ilike("policy_number", likeLiteral(policyNumber));
    setChecking(false);
    if (error) { toast.error(`The duplicate check could not run: ${error.message}`); return; }
    if ((count ?? 0) > 0) {
      toast.error(`Policy number ${policyNumber} is already on a deal. Change it before posting.`);
      return;
    }
    toast.success(`Ready to post — ${formatMoney(calculatedAnnualPaid)} annual, policy number is unused.`);
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
    // 2026-08-19 (Sam, exact Agent Cloud Post-a-Deal): single page, and evidence
    // is OPTIONAL there — validate only client / policy / premium (0,1,2), never
    // the evidence step. submit_apex_deal already accepts a deal with no files.
    for (let index = 0; index < 3; index += 1) {
      const validation = validateStep(index);
      if (validation) { toast.error(validation); return; }
    }
    setSaving(true);
    const saved = await saveSection("review");
    if (!saved) { setSaving(false); return; }
    const { data, error } = await rpc<{
      dealId?: string;
      status?: string;
      dealStatus?: string;
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
    // One receipt refreshes every view of this same deal immediately. Realtime
    // remains the cross-device safety net; this closes the same-tab delay.
    invalidateOperationalTruth(queryClient);
    if (data.status === "already_recorded") {
      toast.info("That carrier, policy number, and writing NPN are already recorded. Nothing was posted twice.");
    } else {
      toast.success("Deal saved. Delivery is queued independently.");
    }
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
    setLinkedClient(null);
    setClientMode("new");
    setClientSearch("");
    setClientQuery("");
    const nextKey = newIdempotencyKey();
    setIdempotencyKey(nextKey);
    if (storageKey) localStorage.setItem(storageKey, nextKey);
  };

  const linkClient = (hit: ClientHit) => {
    setLinkedClient(hit);
    setForm((current) => ({
      ...current,
      clientFirstName: hit.first_name ?? "",
      clientLastName: hit.last_name ?? "",
      clientPhone: hit.phone ?? "",
      clientDob: hit.date_of_birth ?? "",
    }));
    // Never invent the missing half of a record — say it is missing and make
    // the agent supply it, because DOB is required by the server.
    if (!hit.date_of_birth) toast.warning("That client has no date of birth on file — add it below before posting.");
  };

  const handleOpenChange = (next: boolean) => {
    if (next && initialClient && !draftId) {
      setForm((current) => ({
        ...current,
        clientFirstName: current.clientFirstName || initialClient.firstName,
        clientLastName: current.clientLastName || initialClient.lastName,
        clientPhone: current.clientPhone || initialClient.phone,
        clientDob: current.clientDob || initialClient.dob,
      }));
    }
    setOpen(next);
    if (!next) resetAfterClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="h-11 gap-2 sm:h-10">
            <FilePlus2 className="h-4 w-4" />
            Post a Deal
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[96dvh] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>{receipt ? "Deal saved" : "Post a Deal"}</DialogTitle>
          <DialogDescription>
            {receipt
              ? "The deal is durable. Integration delivery continues independently."
              : "Record a new policy for yourself or a downline agent."}
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
            <div className="border-b border-border px-5 py-3">
              <RadioGroup
                value={clientMode}
                onValueChange={(value) => {
                  const mode = value as ClientMode;
                  setClientMode(mode);
                  if (mode === "new") {
                    setLinkedClient(null);
                    setClientSearch("");
                    setClientQuery("");
                  }
                }}
                className="flex flex-wrap gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="new" id="deal-client-new" />
                  <Label htmlFor="deal-client-new" className="cursor-pointer font-normal">New Client</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="existing" id="deal-client-existing" />
                  <Label htmlFor="deal-client-existing" className="cursor-pointer font-normal">Existing Client</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {recovering && <p className="mb-4 text-sm text-muted-foreground">Recovering saved draft…</p>}
              {recovered && !recovering && (
                <div className="mb-4 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-sm text-info dark:text-info">
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

              {(
                <Section title="Client Information" description="Client identity is restricted operational data and is never copied into community posts.">
                  {clientMode === "existing" && (
                    <div className="mb-4 space-y-2">
                      <Label htmlFor="deal-client-search">Find the client</Label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="deal-client-search"
                          value={clientSearch}
                          onChange={(event) => setClientSearch(event.target.value)}
                          placeholder="Search by name or phone…"
                          className="h-11 pl-9 sm:h-10"
                          autoComplete="off"
                        />
                      </div>
                      {clientQuery.trim().length >= 2 && (
                        <div className="max-h-52 overflow-y-auto rounded-md border border-border">
                          {clientHits.isLoading && <p className="px-3 py-3 text-sm text-muted-foreground">Searching…</p>}
                          {!clientHits.isLoading && (clientHits.data ?? []).length === 0 && (
                            <p className="px-3 py-3 text-sm text-muted-foreground">
                              No client on file matches “{clientQuery.trim()}”. Switch to New Client to enter them by hand.
                            </p>
                          )}
                          {(clientHits.data ?? []).map((hit) => (
                            <button
                              key={hit.id}
                              type="button"
                              onClick={() => linkClient(hit)}
                              className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/40"
                            >
                              <span className="min-w-0 truncate font-medium">{hit.first_name} {hit.last_name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {hit.phone || "no phone on file"} · {hit.date_of_birth || "no DOB on file"}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      {linkedClient && (
                        <p className="flex items-center gap-2 text-sm text-success">
                          <UserCheck className="h-4 w-4" /> Linked {linkedClient.first_name} {linkedClient.last_name}. Confirm the details below.
                        </p>
                      )}
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="First name" id="deal-first-name" value={form.clientFirstName} onChange={(value) => update("clientFirstName", value)} autoComplete="given-name" />
                    <Field label="Last name" id="deal-last-name" value={form.clientLastName} onChange={(value) => update("clientLastName", value)} autoComplete="family-name" />
                    <Field label="Phone number" id="deal-phone" value={form.clientPhone} onChange={(value) => update("clientPhone", value)} type="tel" autoComplete="tel" placeholder="(XXX) XXX-XXXX" />
                    <Field label="Date of birth" id="deal-dob" value={form.clientDob} onChange={(value) => update("clientDob", value)} type="date" />
                  </div>
                </Section>
              )}

              {(
                <Section title="Policy Details" description="Carrier and application details are checked again by the server before create.">
                  <div className="space-y-1.5">
                    <Label htmlFor="deal-carrier">Carrier</Label>
                    <Select value={form.carrierId} onValueChange={(value) => update("carrierId", value)}>
                      <SelectTrigger id="deal-carrier" className="h-11 sm:h-10"><SelectValue placeholder="Select carrier…" /></SelectTrigger>
                      <SelectContent>{(carriers.data ?? []).map((carrier) => <SelectItem key={carrier.id} value={carrier.id}>{carrier.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <Field label="Product sold" id="deal-product" value={form.product} onChange={(value) => update("product", value)} placeholder="Select product…" list="deal-product-options" />
                      <datalist id="deal-product-options">
                        {(carrierProducts.data ?? []).map((row) => <option key={row.product} value={row.product} />)}
                      </datalist>
                    </div>
                    <Field label="Policy number" id="deal-policy" value={form.policyNumber} onChange={(value) => update("policyNumber", sanitizePolicyInput(value))} placeholder="e.g., POL-123456" autoComplete="off" />
                    <Field label="Effective date" id="deal-effective-date" value={form.effectiveDate} onChange={(value) => update("effectiveDate", value)} type="date" />
                    <div className="space-y-1.5">
                      <Field label="Sale date" id="deal-application-date" value={form.applicationDate} onChange={(value) => update("applicationDate", value)} type="date" max={TODAY} />
                      <p className="text-xs text-muted-foreground">Counts toward this month. Change it to log an older sale.</p>
                    </div>
                    <Field label="Face amount" id="deal-face" value={form.faceAmount} onChange={(value) => update("faceAmount", value)} type="number" min="1" step="1" inputMode="decimal" placeholder="e.g., 50000" />
                    <Field label={form.premiumMode === "monthly" ? "Monthly premium" : "Premium (per payment)"} id="deal-modal-premium" value={form.modalPremium} onChange={(value) => update("modalPremium", value)} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="e.g., 99.99" />
                    <div className="space-y-1.5">
                      <Label htmlFor="deal-payment-method">Payment method</Label>
                      <Select value={form.paymentMethod || "not_recorded"} onValueChange={(value) => update("paymentMethod", value === "not_recorded" ? "" : value as PaymentMethod)}>
                        <SelectTrigger id="deal-payment-method" className="h-11 sm:h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_recorded">Not set yet</SelectItem>
                          <SelectItem value="bank_draft">Bank draft</SelectItem>
                          <SelectItem value="credit_card">Credit card</SelectItem>
                          <SelectItem value="debit_card">Debit card</SelectItem>
                          <SelectItem value="direct_express">Direct Express</SelectItem>
                          <SelectItem value="check">Check</SelectItem>
                          <SelectItem value="social_security">Social Security</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Field label="Draft day" id="deal-draft-day" value={form.draftDay} onChange={(value) => update("draftDay", value)} type="number" min="1" max="28" step="1" inputMode="numeric" placeholder="Not set yet — 1 to 28" />
                    <div className="space-y-1.5">
                      <Label htmlFor="deal-premium-mode">Payment frequency</Label>
                      <Select value={form.premiumMode} onValueChange={(value) => update("premiumMode", value as PremiumMode)}>
                        <SelectTrigger id="deal-premium-mode" className="h-11 sm:h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem>
                          <SelectItem value="semiannual">Semiannual</SelectItem><SelectItem value="annual">Annual</SelectItem>
                          <SelectItem value="single_pay">Single Pay</SelectItem><SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Field label="Lead source" id="deal-lead-source" value={form.leadSource} onChange={(value) => update("leadSource", value)} placeholder="Optional" />
                    {factor === null && (
                      <Field label="Annual paid premium" id="deal-paid-premium" value={form.annualizedPaidPremium} onChange={(value) => update("annualizedPaidPremium", value)} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="Enter for this frequency" />
                    )}
                  </div>
                  <div className="mt-4 space-y-1.5">
                    <Label htmlFor="deal-policy-status">Policy status</Label>
                    <Select value={form.policyStatus} onValueChange={(value) => update("policyStatus", value as PolicyStatus)}>
                      <SelectTrigger id="deal-policy-status" className="h-11 sm:h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(["Issued, Not Paid", "Active", "In Review", "Pending", "Approved", "Lapse Pending", "Lapsed", "Cancelled", "Withdrawn", "Not Taken", "Postponed", "Declined"] as PolicyStatus[]).map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="mt-4 space-y-1">
                    <Label>Annual Premium</Label>
                    <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
                      <p className="text-xl font-bold text-success">{formatMoney(calculatedAnnualPaid)} <span className="text-sm font-normal text-muted-foreground">/ year</span></p>
                    </div>
                  </div>
                </Section>
              )}

              <Section
                title="Beneficiaries (Optional)"
                description="Record the beneficiaries attached to this policy. This information stays private to authorized users."
                action={
                  <Button type="button" variant="outline" size="sm" className="h-9 gap-2" onClick={addBeneficiary} disabled={form.beneficiaries.length >= 10}>
                    <Plus className="h-4 w-4" /> Add Beneficiary
                  </Button>
                }
              >
                <div className="space-y-3">
                  {form.beneficiaries.length === 0 && (
                    <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                      No beneficiaries added. This is optional — the deal posts without them.
                    </p>
                  )}
                  {form.beneficiaries.map((beneficiary, index) => (
                    <div key={beneficiary.id} className="rounded-lg border border-border bg-muted/10 p-3">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-medium">Beneficiary {index + 1}</p>
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={`Remove beneficiary ${index + 1}`} onClick={() => removeBeneficiary(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="First name" id={`deal-beneficiary-first-${index}`} value={beneficiary.firstName} onChange={(value) => updateBeneficiary(index, { firstName: value })} />
                        <Field label="Last name" id={`deal-beneficiary-last-${index}`} value={beneficiary.lastName} onChange={(value) => updateBeneficiary(index, { lastName: value })} />
                        <Field label="Relationship" id={`deal-beneficiary-relationship-${index}`} value={beneficiary.relationship} onChange={(value) => updateBeneficiary(index, { relationship: value })} placeholder="e.g., Spouse" />
                        <Field label="Allocation %" id={`deal-beneficiary-allocation-${index}`} value={beneficiary.allocationPct} onChange={(value) => updateBeneficiary(index, { allocationPct: value })} type="number" min="0" max="100" step="0.01" inputMode="decimal" placeholder="Optional" />
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              {(
                <Section title="Notes (Optional)" description="Any additional notes about this deal, client health, or application details.">
                  <Textarea id="deal-notes" value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={4} maxLength={2000} placeholder="Any additional notes about this deal, client health, or application details…" />
                  <p className="mt-1 text-right text-xs text-muted-foreground">{form.notes.length} / 2000</p>
                </Section>
              )}

              {(
                <Section title="Supporting document (Optional)" description="Private evidence stays restricted to this deal. Not required to post.">
                  <div className="rounded-lg border border-dashed border-border p-4">
                    <Input ref={fileInput} id="deal-evidence" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="h-11 pt-2 sm:h-10" onChange={(event) => uploadEvidence(event.target.files?.[0])} disabled={uploading} />
                    {uploading && <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Uploading privately…</p>}
                    <div className="mt-3 space-y-2">
                      {evidence.map((file) => (
                        <div key={file.id} className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                          <span className="min-w-0 truncate"><FileCheck2 className="mr-2 inline h-4 w-4" />{file.original_file_name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{Math.ceil(file.size_bytes / 1024)} KB · {file.scan_status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Section>
              )}

              <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm">
                <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-info" /><p><strong>The deal saves first.</strong> Discord, AgentLink, scanning and analytics delivery are queued separately and can never erase or duplicate this record. Client identity is never copied into community posts.</p></div>
              </div>
            </div>

            <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border px-5 py-4 sm:justify-between">
              {/* Agent Cloud's pre-submit review slot. runCheck() existed in this
                  file but nothing ever called it — the gates it runs and the
                  duplicate-policy-number question it asks the database were
                  dead code, so a duplicate only surfaced as a 23505 AFTER the
                  agent hit Post. Wired to a real control now. */}
              <Button type="button" variant="outline" className="h-11 gap-2 sm:h-10" onClick={runCheck} disabled={checking || saving || recovering}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Review before submit
              </Button>
              <Button type="submit" className="h-11 gap-2 sm:h-10" disabled={saving || recovering}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} Post Deal
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card/40 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, id, value, onChange, ...props }: { label: string; id: string; value: string; onChange: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, "id" | "value" | "onChange">) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input {...props} id={id} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 sm:h-10" /></div>;
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-md border border-border bg-background px-3 py-2"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium capitalize">{value || "—"}</dd></div>;
}
