import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Clock3, FilePlus2, FileCheck2, Loader2, Plus, Search, Trash2, UserCheck, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyDownline } from "@/hooks/useMyDownline";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { invalidateOperationalTruth } from "@/lib/invalidateOperationalTruth";
import { announcePostedDealReceipt } from "@/lib/dealCelebrations";
import { WinActionButton } from "@/components/celebrations/WinActionButton";
import { normalizePolicyNumber, sanitizePolicyInput, isWithinPolicyNumberGrace, policyNumberGrade } from "@/lib/policyNumber";
import { parseFinancePolicyBook, policyNameKey } from "@/lib/financePolicyBook";
import { LEAD_TYPES } from "@/lib/leadTypes";
import { enqueue, isOffline, isTransportError } from "@/lib/offlineQueue";
import { TeamLookupError } from "@/components/shared/TeamLookupError";
import { COVERAGE_REVIEW_QUERY_KEY, readCoverageHold, type CoverageHold } from "@/lib/dealCoverageReview";

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

interface OfflineReceipt {
  localId: string;
  label: string;
}

type RpcError = { message?: string; code?: string; status?: number };

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

type PolicyCheck = { state: "idle" | "checking" | "unused" | "duplicate" | "error"; message?: string };

// A recovered draft that already used the optional fields opens them, so nothing
// a person typed is hidden behind the fold.
function usesOptionalDetails(payload: Partial<DealForm> | null | undefined): boolean {
  if (!payload || typeof payload !== "object") return false;
  return Boolean(
    payload.effectiveDate ||
    payload.paymentMethod ||
    payload.draftDay ||
    payload.notes ||
    (payload.beneficiaries && payload.beneficiaries.length > 0) ||
    (payload.policyStatus && payload.policyStatus !== EMPTY_FORM.policyStatus) ||
    (payload.applicationDate && payload.applicationDate !== TODAY),
  );
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

function rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; error: RpcError | null }> {
  return (supabase.rpc as unknown as (fn: string, values: Record<string, unknown>) => Promise<{ data: T | null; error: RpcError | null }>)(name, args);
}

interface InitialDealClient {
  firstName: string;
  lastName: string;
  phone: string;
  dob: string;
}

// Mark Sold on a client hands the pitch the agent already recorded (carrier,
// product, monthly price, policy number, face, start date) into the post so
// nothing is typed twice. Carrier arrives as a NAME because the CRM stores
// text; it is resolved against the live carriers list once that loads.
export interface InitialDealDetails {
  carrierName?: string | null;
  product?: string | null;
  policyNumber?: string | null;
  monthlyPremium?: number | string | null;
  faceAmount?: number | string | null;
  effectiveDate?: string | null;
}

export interface PostedDealReceipt {
  dealId: string;
  status: string;
  annualPaid: number;
  policyNumber: string;
}

export function SubmitDealDialog({ trigger, initialClient, initialDeal, title, description, onPosted, secondaryAction }: {
  trigger?: ReactNode;
  initialClient?: InitialDealClient;
  initialDeal?: InitialDealDetails;
  title?: string;
  description?: string;
  onPosted?: (receipt: PostedDealReceipt) => void;
  secondaryAction?: { label: string; onClick: () => void };
}) {
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
  const [policyCheck, setPolicyCheck] = useState<PolicyCheck>({ state: "idle" });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [offlineReceipt, setOfflineReceipt] = useState<OfflineReceipt | null>(null);
  const [coverageHold, setCoverageHold] = useState<CoverageHold | null>(null);

  // One draft slot per client a dialog was opened for. A Resold dialog prefilled for one client
  // used to share the user's single slot, so it could recover another client's unfinished draft
  // and post that client's details while marking this one resold. Plain Post a Deal keeps the
  // shared slot it always had.
  const clientSlot = initialClient
    ? `${initialClient.firstName} ${initialClient.lastName}`.toLowerCase().replace(/[^a-z0-9]/g, "") || (initialClient.phone ?? "").replace(/\D/g, "")
    : "";
  const storageKey = user?.id ? `apex.native-deal-draft.${user.id}${clientSlot ? `.client.${clientSlot}` : ""}` : "";

  const carriers = useQuery({
    queryKey: ["native-deal-carriers"],
    enabled: open,
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

  useEffect(() => {
    const wanted = initialDeal?.carrierName?.trim().toLowerCase();
    if (!open || !wanted || form.carrierId || !carriers.data?.length) return;
    const list = carriers.data;
    const hit = list.find((c) => c.name.trim().toLowerCase() === wanted)
      ?? list.find((c) => c.name.toLowerCase().includes(wanted) || wanted.includes(c.name.toLowerCase()));
    if (hit) setForm((current) => (current.carrierId ? current : { ...current, carrierId: hit.id }));
  }, [open, initialDeal?.carrierName, form.carrierId, carriers.data]);

  const carrierName = carriers.data?.find(option => option.id === form.carrierId)?.name;
  const carrierBook = useQuery({
    queryKey: ["agent-carrier-book", selectedAgentId, user?.id],
    enabled: Boolean(open && user?.id && selectedAgentId && carrierName),
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await rpc<unknown>("agent_carrier_book", { p_agent_id: selectedAgentId });
      if (error) throw error;
      return parseFinancePolicyBook(data, selectedAgentId);
    },
  });
  const fullName = policyNameKey(form.clientFirstName + " " + form.clientLastName);
  const previousPolicies = carrierBook.data?.policies.filter(policy =>
    policy.client && form.clientFirstName.trim() && form.clientLastName.trim() &&
    policyNameKey(policy.client) === fullName &&
    policy.carrier.toLowerCase() === carrierName?.toLowerCase()
  ) ?? [];
  const carrierProducts = useQuery({
    queryKey: ["native-deal-carrier-products", form.carrierId],
    enabled: open && Boolean(form.carrierId),
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
    queryKey: ["native-deal-client-search", user?.id, clientQuery],
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
        if (usesOptionalDetails(draft.payload)) setDetailsOpen(true);
        const recoveredStep = Math.max(0, SECTIONS.findIndex((section) => section.key === draft.current_section));
        setStep(recoveredStep);
        setRecovered(true);
        const { data: rows } = await supabase
          .from("deal_attachments" as never)
          .select("id, draft_id, object_path, original_file_name, size_bytes, scan_status")
          .eq("draft_id", draft.id)
          .order("created_at");
        if (active) setEvidence((rows ?? []) as unknown as EvidenceRow[]);
        if (active && (rows ?? []).length > 0) setDetailsOpen(true);
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
      if (!form.carrierId || !form.product.trim()) return "Carrier and product are required.";
      if (!form.applicationDate) return "Application date is required.";
      if (!normalizePolicyNumber(form.policyNumber) && !isWithinPolicyNumberGrace(form.applicationDate)) return "An application or policy number is required more than 30 days after the sale date.";
      // A made-up number (12345678910, 1234, 00000) gets past the required field and then blocks the real one.
      // Blank is honest and allowed; the deal comes back to the agent's leads if it is still missing later.
      if (policyNumberGrade(form.policyNumber) === "placeholder" && normalizePolicyNumber(form.policyNumber)) return "That looks like a placeholder, not a real policy number. Leave it blank if the carrier has not given it yet. It comes back to your leads if it is still missing in 14 days.";
    }
    if (index === 2) {
      if (!form.leadSource.trim()) return "Tap the lead type: POS, Veteran, FEX, Mortgage, Aged, Referral or Other.";
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

  const saveSection = async (
    section: DealSection,
    showError = false,
  ): Promise<{ draftId: string | null; error: RpcError | null }> => {
    const { data, error } = await rpc<{ draftId?: string }>("save_apex_deal_draft", {
      p_idempotency_key: idempotencyKey,
      p_section: section,
      p_payload: payload,
    });
    if (error) {
      if (showError) toast.error(error.message || "The draft could not be saved.");
      return { draftId: null, error };
    }
    const savedDraftId = data?.draftId ?? draftId;
    if (savedDraftId) setDraftId(savedDraftId);
    if (storageKey) localStorage.setItem(storageKey, idempotencyKey);
    return { draftId: savedDraftId ?? null, error: null };
  };

  // The duplicate check runs the moment the agent leaves the policy-number field,
  // so a number already on a deal is called out under the field instead of
  // surfacing as a 23505 after Post. It asks about the normalized string, because
  // that is what submit_apex_deal stores, and the server still refuses the
  // duplicate on its own.
  const checkPolicyNumber = async () => {
    const policyNumber = normalizePolicyNumber(form.policyNumber);
    if (!policyNumber) { setPolicyCheck({ state: "idle" }); return; }
    setPolicyCheck({ state: "checking" });
    const { count, error } = await supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .ilike("policy_number", likeLiteral(policyNumber));
    if (error) { setPolicyCheck({ state: "error", message: `The duplicate check could not run: ${error.message}` }); return; }
    setPolicyCheck((count ?? 0) > 0
      ? { state: "duplicate", message: `${policyNumber} is already on a deal. Change it before posting.` }
      : { state: "unused", message: "Not on any deal yet." });
  };

  // What still blocks Post, in the order the form asks for it. Shown live in the
  // footer so the agent never has to hunt for the field a toast named.
  const missing = useMemo(() => {
    const out: string[] = [];
    if (!form.clientFirstName.trim()) out.push("first name");
    if (!form.clientLastName.trim()) out.push("last name");
    if (form.clientPhone.replace(/\D/g, "").length < 10) out.push("phone");
    if (!form.clientDob) out.push("date of birth");
    if (!form.carrierId) out.push("carrier");
    if (!form.product.trim()) out.push("product");
    if (safeNumber(form.modalPremium) <= 0) out.push("premium");
    if (factor === null && safeNumber(form.annualizedPaidPremium) <= 0) out.push("annual paid premium");
    if (safeNumber(form.faceAmount) <= 0) out.push("face amount");
    if (!form.leadSource.trim()) out.push("lead type");
    return out;
  }, [factor, form]);

  const uploadEvidence = async (file: File | undefined) => {
    if (!file || !user?.id) return;
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) { toast.error("Upload a JPG, PNG, WebP, or PDF file."); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Evidence must be 10 MB or smaller."); return; }

    setUploading(true);
    const saveResult = draftId
      ? { draftId, error: null }
      : await saveSection("evidence", true);
    const savedDraftId = saveResult.draftId;
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
    const queuedArgs = {
      p_idempotency_key: idempotencyKey,
      p_payload: payload,
      p_agent_id: selectedAgentId || null,
    };
    const queueCurrentDeal = (): boolean => {
      if (!user?.id) return false;
      const clientName = `${form.clientFirstName} ${form.clientLastName}`.trim();
      const policyNumber = normalizePolicyNumber(form.policyNumber);
      const label = `${clientName} · ${policyNumber || "Policy number pending"}`;
      const queued = enqueue({
        ownerUserId: user.id,
        kind: "submit_apex_deal",
        idempotencyKey,
        args: queuedArgs,
        label,
      });
      if (queued.ok === false) {
        const message = queued.reason === "queue-full"
          ? "This device already has 50 deals waiting to sync. Reconnect before posting another."
          : "This deal could not be stored safely on this device. Keep the form open and reconnect.";
        toast.error(message);
        return false;
      }
      setOfflineReceipt({ localId: queued.entry.id, label });
      if (storageKey) localStorage.removeItem(storageKey);
      toast.info("Saved on this device. The deal will post automatically when internet returns.");
      return true;
    };

    if (isOffline()) {
      queueCurrentDeal();
      setSaving(false);
      return;
    }

    const saved = await saveSection("review");
    if (!saved.draftId) {
      if (saved.error && isTransportError(saved.error)) queueCurrentDeal();
      else toast.error(saved.error?.message || "The draft could not be saved.");
      setSaving(false);
      return;
    }
    const { data, error } = await rpc<{
      dealId?: string;
      status?: string;
      dealStatus?: string;
      downstreamState?: string;
      correlationId?: string;
      replayed?: boolean;
      ok?: boolean;
      reviewId?: string;
      reviewVersion?: number;
      matchCount?: number;
    }>("submit_apex_deal", queuedArgs);
    if (!error) {
      try {
        const held = readCoverageHold(data);
        if (held) {
          setCoverageHold(held);
          void queryClient.invalidateQueries({ queryKey: [COVERAGE_REVIEW_QUERY_KEY, user?.id] });
          toast.info(held.status === "review_rejected" ? "This draft needs changes after coverage review. No deal was posted." : "Draft saved for coverage review. No deal was posted.");
          setSaving(false);
          return;
        }
      } catch {
        toast.error("The review response could not be verified. Keep this draft and retry.");
        setSaving(false);
        return;
      }
    }
    if (error || !data?.dealId) {
      if (error && isTransportError(error)) queueCurrentDeal();
      else toast.error(error?.message || "The deal could not be submitted. Your draft remains saved.");
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
    setCoverageHold(null);
    if (user?.id) announcePostedDealReceipt(user.id, data);
    onPosted?.({
      dealId: data.dealId,
      status: nextReceipt.status,
      annualPaid: calculatedAnnualPaid,
      policyNumber: normalizePolicyNumber(form.policyNumber),
    });
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
    if (!receipt && !offlineReceipt) return;
    setForm(EMPTY_FORM);
    setStep(0);
    setDraftId(null);
    setEvidence([]);
    setReceipt(null);
    setOfflineReceipt(null);
    setCoverageHold(null);
    setRecovered(false);
    setPolicyCheck({ state: "idle" });
    setDetailsOpen(false);
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
    if (next && (initialClient || initialDeal) && !draftId) {
      const money = (value: number | string | null | undefined) =>
        value != null && Number(value) > 0 ? String(value) : "";
      setForm((current) => ({
        ...current,
        clientFirstName: current.clientFirstName || initialClient?.firstName || "",
        clientLastName: current.clientLastName || initialClient?.lastName || "",
        clientPhone: current.clientPhone || initialClient?.phone || "",
        clientDob: current.clientDob || initialClient?.dob || "",
        product: current.product || initialDeal?.product || "",
        policyNumber: current.policyNumber || initialDeal?.policyNumber || "",
        modalPremium: current.modalPremium || money(initialDeal?.monthlyPremium),
        premiumMode: current.modalPremium || !money(initialDeal?.monthlyPremium) ? current.premiumMode : "monthly",
        faceAmount: current.faceAmount || money(initialDeal?.faceAmount),
        effectiveDate: current.effectiveDate || initialDeal?.effectiveDate || "",
      }));
      if (initialDeal?.effectiveDate) setDetailsOpen(true);
    }
    setOpen(next);
    if (!next) resetAfterClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <WinActionButton kind="deal" />
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[96dvh] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>{receipt ? "Deal saved" : offlineReceipt ? "Deal waiting to sync" : title ?? "Post a Deal"}</DialogTitle>
          <DialogDescription>
            {receipt
              ? "The deal is durable. Integration delivery continues independently."
              : offlineReceipt
                ? "This deal is stored on this device and has not been recorded by the server yet."
              : description ?? "Who you sold to, what you sold, and what it costs. Everything else is optional."}
          </DialogDescription>
          {secondaryAction && !receipt && !offlineReceipt && (
            <button
              type="button"
              className="mt-1 w-fit text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => { secondaryAction.onClick(); setOpen(false); }}
            >
              {secondaryAction.label}
            </button>
          )}
        </DialogHeader>
        <TeamLookupError className="mx-5 mt-3 w-auto" />

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
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <Button asChild className="h-11 sm:h-10">
                  <Link to={`/dashboard/production?deal=${encodeURIComponent(receipt.dealId)}`} onClick={() => setOpen(false)}>
                    View deal
                  </Link>
                </Button>
                <Button type="button" variant="outline" className="h-11 sm:h-10" onClick={resetAfterClose}>
                  Post another deal
                </Button>
              </div>
            </div>
          </div>
        ) : offlineReceipt ? (
          <div className="overflow-y-auto px-5 py-8">
            <div className="mx-auto max-w-lg rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
              <WifiOff className="mb-3 h-8 w-8 text-amber-500" />
              <h3 className="text-lg font-semibold">Saved on this device</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Keep this device signed in. It will submit automatically when internet returns, using the same duplicate-safe key.
              </p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <ReviewItem label="Pending deal" value={offlineReceipt.label} />
                <ReviewItem label="Sync status" value="Waiting for internet" />
                <ReviewItem label="Protection" value="Duplicate-safe retry" />
                <ReviewItem label="Local receipt" value={offlineReceipt.localId} />
              </dl>
              <Button type="button" className="mt-5 h-11 w-full gap-2 sm:h-10" onClick={() => setOpen(false)}>
                <Clock3 className="h-4 w-4" /> Done — sync in background
              </Button>
            </div>
          </div>
        ) : (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
            {coverageHold && <aside role="status" className="mx-5 mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
              <h3 className="font-semibold">{coverageHold.status === "review_rejected" ? "Coverage review did not approve this draft" : "Existing coverage needs review"}</h3>
              <p className="mt-1">The saved draft matches an existing insured by date of birth and name or phone with the same carrier. A manager must verify the coverage and document the reason for another policy. A different card or policy number does not clear this review.</p>
              <p className="mt-2 font-medium">No new deal has been posted or counted as production.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Link to={`/dashboard/production?review=${encodeURIComponent(coverageHold.reviewId)}`} className="font-semibold underline" onClick={() => setOpen(false)}>Open coverage review</Link>
                <Button type="button" size="sm" variant="outline" disabled={saving || uploading} onClick={() => {
                  const nextKey = newIdempotencyKey();
                  setIdempotencyKey(nextKey); setDraftId(null); setEvidence([]); setCoverageHold(null);
                  if (storageKey) localStorage.setItem(storageKey, nextKey);
                }}>Start a corrected draft</Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Approval applies only to the exact reviewed draft. Changes are checked again before posting.</p>
            </aside>}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {recovering && <p className="text-sm text-muted-foreground">Recovering saved draft…</p>}
              {recovered && !recovering && (
                <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-sm text-info dark:text-info">
                  Your last saved draft was recovered.
                </div>
              )}

              {(isAdmin || isManager) && availableAgents.length > 1 ? (
                <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="deal-writing-agent">Writing agent</Label>
                    <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                      <SelectTrigger id="deal-writing-agent" className="h-11 sm:h-10"><SelectValue placeholder="Select writing agent" /></SelectTrigger>
                      <SelectContent>{availableAgents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.displayName}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <ReviewItem label="Manager / upline" value={writingAgent?.managerId ? manager.data || "Loading assigned manager…" : "No manager assigned"} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Posting as <span className="font-medium text-foreground">{writingAgent?.displayName || "Linking account…"}</span>
                  {writingAgent?.managerId ? <> · manager: {manager.data || "Loading assigned manager…"}</> : null}
                </p>
              )}

              <Section
                title="Who you sold to"
                description="Kept private. Client details never appear in community posts."
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9"
                    onClick={() => {
                      const mode: ClientMode = clientMode === "new" ? "existing" : "new";
                      setClientMode(mode);
                      if (mode === "new") {
                        setLinkedClient(null);
                        setClientSearch("");
                        setClientQuery("");
                      }
                    }}
                  >
                    {clientMode === "new" ? "Find an existing client" : "Enter a new client"}
                  </Button>
                }
              >
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

              <Section title="What you sold" description="Carrier, product and price. The server checks these again before the deal is created.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="deal-carrier">Carrier</Label>
                    <Select value={form.carrierId} onValueChange={(value) => update("carrierId", value)}>
                      <SelectTrigger id="deal-carrier" className="h-11 sm:h-10"><SelectValue placeholder="Select carrier…" /></SelectTrigger>
                      <SelectContent>{(carriers.data ?? []).map((carrier) => <SelectItem key={carrier.id} value={carrier.id}>{carrier.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Field label="Product sold" id="deal-product" value={form.product} onChange={(value) => update("product", value)} placeholder="Select product…" list="deal-product-options" />
                    <datalist id="deal-product-options">
                      {(carrierProducts.data ?? []).map((row) => <option key={row.product} value={row.product} />)}
                    </datalist>
                  </div>
                  <Field label={form.premiumMode === "monthly" ? "Monthly premium" : "Premium (per payment)"} id="deal-modal-premium" value={form.modalPremium} onChange={(value) => update("modalPremium", value)} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="e.g., 99.99" />
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
                  {factor === null && (
                    <Field label="Annual paid premium" id="deal-paid-premium" value={form.annualizedPaidPremium} onChange={(value) => update("annualizedPaidPremium", value)} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="Enter for this frequency" />
                  )}
                  <Field label="Face amount" id="deal-face" value={form.faceAmount} onChange={(value) => update("faceAmount", value)} type="number" min="1" step="1" inputMode="decimal" placeholder="e.g., 50000" />
                  <div className="sm:col-span-2">
                    <Field
                      label="Policy number"
                      id="deal-policy"
                      value={form.policyNumber}
                      onChange={(value) => { update("policyNumber", sanitizePolicyInput(value)); setPolicyCheck({ state: "idle" }); }}
                      onBlur={() => { void checkPolicyNumber(); }}
                      placeholder="Leave blank until the carrier issues it"
                      autoComplete="off"
                    />
                    <p
                      className={cn("mt-1 text-xs", policyCheck.state === "duplicate" || policyCheck.state === "error" ? "text-destructive" : policyCheck.state === "unused" ? "text-success" : "text-muted-foreground")}
                      role={policyCheck.state === "duplicate" ? "alert" : undefined}
                    >
                      {policyCheck.state === "checking"
                        ? "Checking for a duplicate…"
                        : policyCheck.message ?? "Optional for 30 days. If it is still missing after 14 days the deal goes back to your leads. A made-up number is refused."}
                    </p>
                  </div>
                </div>
                {carrierBook.isError && <p role="status" className="mt-3 text-sm">Carrier history could not refresh. Verify existing coverage in the carrier portal before writing.</p>}
                {previousPolicies.length > 0 && <aside role="status" className="mt-3 rounded-lg border border-border p-3 text-sm">
                  <strong>Review existing coverage before writing</strong>
                  <p>This writing agent has carrier records under the same client name. Confirm the insured’s identity, existing coverage and reason for additional coverage with your manager. A different payment card does not distinguish policies.</p>
                  <ul>{previousPolicies.map(policy => <li key={policy.key}>{policy.policyNumber || "Number unavailable"} · {policy.statusLabel} · {policy.soldOn || "Sale date unavailable"}{policy.chargeback ? " · Recorded chargeback" : ""}</li>)}</ul>
                </aside>}
                <div className="mt-4 space-y-1.5" role="group" aria-labelledby="deal-lead-type-label">
                  <Label id="deal-lead-type-label">What kind of lead was this?</Label>
                  <div className="flex flex-wrap gap-2">
                    {LEAD_TYPES.map((type) => (
                      <button
                        key={type.key}
                        type="button"
                        aria-pressed={form.leadSource === type.label}
                        title={type.hint}
                        onClick={() => update("leadSource", type.label)}
                        className={cn(
                          "min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors",
                          form.leadSource === type.label ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted",
                        )}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  Annual premium <strong className="text-base text-success">{formatMoney(calculatedAnnualPaid)}</strong> / year
                </p>
              </Section>

              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" className="h-11 w-full justify-between sm:h-10">
                    <span>{detailsOpen ? "Hide the optional details" : "More details (optional)"}</span>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", detailsOpen && "rotate-180")} aria-hidden="true" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-5 pt-5">
              <Section title="Dates and payment" description="Only if you have them now. The sale date already counts for today.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Field label="Sale date" id="deal-application-date" value={form.applicationDate} onChange={(value) => update("applicationDate", value)} type="date" max={TODAY} />
                    <p className="text-xs text-muted-foreground">Change it to log an older sale.</p>
                  </div>
                  <Field label="Effective date" id="deal-effective-date" value={form.effectiveDate} onChange={(value) => update("effectiveDate", value)} type="date" />
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
                  <Field label="Draft day" id="deal-draft-day" value={form.draftDay} onChange={(value) => update("draftDay", value)} type="number" min="1" max="28" step="1" inputMode="numeric" placeholder="1 to 28" />
                  <div className="space-y-1.5">
                    <Label htmlFor="deal-policy-status">Policy status</Label>
                    <Select value={form.policyStatus} onValueChange={(value) => update("policyStatus", value as PolicyStatus)}>
                      <SelectTrigger id="deal-policy-status" className="h-11 sm:h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(["Issued, Not Paid", "Active", "In Review", "Pending", "Approved", "Lapse Pending", "Lapsed", "Cancelled", "Withdrawn", "Not Taken", "Postponed", "Declined"] as PolicyStatus[]).map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Section>

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

                </CollapsibleContent>
              </Collapsible>
            </div>

            <DialogFooter className="flex-row items-center justify-between gap-3 border-t border-border px-5 py-4 sm:justify-between">
              <p className="min-w-0 text-xs text-muted-foreground" aria-live="polite">
                {missing.length > 0
                  ? <>Still needed: {missing.join(", ")}.</>
                  : "Everything required is filled in. The deal saves first; Discord and analytics follow on their own."}
              </p>
              <Button type="submit" className="h-11 shrink-0 gap-2 sm:h-10" disabled={saving || recovering}>
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
