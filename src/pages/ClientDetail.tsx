import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, isBefore } from "date-fns";
import {
  ArrowLeft, BookMarked, CalendarClock, CheckCircle2, Clock, Heart, Mail,
  MessageSquare, PhoneCall, ReceiptText, Save, ShieldAlert, Sparkles,
  StickyNote, User, UserPlus, Users, Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditableClientSection } from "@/components/clients/EditableClientSection";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ClientRow {
  id: string;
  insuracloud_pipeline_client_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  state: string | null;
  city: string | null;
  zip_code: string | null;
  street_address: string | null;
  date_of_birth: string | null;
  preferred_contact_method: string | null;
  best_time_to_call: string | null;
  client_timezone: string | null;
  do_not_call: boolean | null;
  do_not_email: boolean | null;
  do_not_text: boolean | null;
  is_smoker: boolean | null;
  pipeline_stage: string | null;
  stage_changed_at: string | null;
  last_contact_date: string | null;
  next_action_date: string | null;
  callback_date: string | null;
  callback_time: string | null;
  client_health_score: number | null;
  pitch_carrier: string | null;
  pitch_price: number | string | null;
  product_sold: string | null;
  policy_number: string | null;
  face_amount: number | string | null;
  policy_start_date: string | null;
  policy_review_date: string | null;
  earned_income: number | string | null;
  pension_income: number | string | null;
  social_security_income: number | string | null;
  other_monthly_income: number | string | null;
  total_monthly_income: number | string | null;
  mortgage_payment: number | string | null;
  rent_payment: number | string | null;
  transportation_expense: number | string | null;
  utilities_expense: number | string | null;
  insurance_expense: number | string | null;
  other_monthly_expenses: number | string | null;
  total_monthly_expenses: number | string | null;
  monthly_surplus: number | string | null;
  bank_name: string | null;
  bank_account_type: string | null;
  ssn_last4: string | null;
  medical_notes: string | null;
  physician_name: string | null;
  physician_phone: string | null;
  employer_occupation: string | null;
  employment_status: string | null;
  qualified_accounts: number | string | null;
  non_qualified_accounts: number | string | null;
  retirement_age_goal: number | null;
  retirement_year: number | null;
  legacy_estate: number | string | null;
  needs_analysis_completed_at: string | null;
  objectives: string | null;
  communication_notes: string | null;
  reminder_notes: string | null;
  beneficiary_first_name: string | null;
  beneficiary_last_name: string | null;
  beneficiary_count: number | null;
  referred_from_client_first_name: string | null;
  referred_from_client_last_name: string | null;
  lead_vendor_name: string | null;
  lead_product_name: string | null;
  external_source: string | null;
  created_at: string;
  raw_payload: unknown;
}

interface ClientOverride {
  stage_override: string | null;
  stage_changed_at: string | null;
  last_contact_date: string | null;
  next_action_date: string | null;
  callback_date: string | null;
  callback_time: string | null;
  schedule_overridden: boolean;
  communication_notes: string | null;
  reminder_notes: string | null;
}

interface Beneficiary { id: string; first_name: string | null; last_name: string | null; relationship: string | null; percentage: number | string | null; date_of_birth: string | null; }
interface Contract { id: string; carrier_name: string | null; product_name: string | null; face_amount: number | string | null; monthly_premium: number | string | null; status: string | null; effective_date: string | null; }
interface Activity { id: string; activity_type: string; body: string | null; metadata: Record<string, unknown>; created_at: string; }

const STAGES = [
  { value: "NEW_INITIAL", label: "New / Initial" },
  { value: "FOLLOW_UP", label: "Callback" },
  { value: "ALMOST_THERE", label: "Almost There" },
  { value: "SOLD", label: "Sold" },
] as const;

const TAB_ITEMS = [
  ["timeline", "Timeline", Clock], ["contact", "Contact", User],
  ["needs", "Needs Analysis", Sparkles], ["schedule", "Schedule", CalendarClock],
  ["beneficiaries", "Beneficiaries", Users], ["referrals", "Referrals", UserPlus],
  ["financials", "Financials", Wallet], ["policies", "Policies", BookMarked],
  ["notes", "Notes", StickyNote],
] as const;

function rpc<T>(name: string, args: Record<string, unknown>) {
  return (supabase.rpc as unknown as (fn: string, values: Record<string, unknown>) => Promise<{ data: T | null; error: { message?: string } | null }>)(name, args);
}

function fmtMoney(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  try { return format(new Date(value), "MMM d, yyyy"); } catch { return value; }
}

function dateInput(value: string | null | undefined): string {
  if (!value) return "";
  const isoDate = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  try { return format(new Date(value), "yyyy-MM-dd"); } catch { return ""; }
}

function Field({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return <div className="space-y-0.5"><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt><dd className="break-words text-sm font-medium">{value ?? "—"}</dd>{hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}</div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-md border border-border bg-card p-4"><h3 className="mb-4 text-sm font-semibold">{title}</h3>{children}</section>;
}

export default function ClientDetail() {
  const { clientId } = useParams<{ clientId: string }>();
  usePageTitle("Client Workspace · APEX");
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState({ communication: "", reminder: "" });
  const [schedule, setSchedule] = useState({ callbackDate: "", callbackTime: "", nextAction: "" });
  const [prepOpen, setPrepOpen] = useState(false);

  const client = useQuery<ClientRow | null>({
    queryKey: ["client-detail", clientId], enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase.from("agentlink_clients").select("*").eq("id", clientId!).maybeSingle();
      if (error) throw error;
      return data as unknown as ClientRow | null;
    },
  });

  const override = useQuery<ClientOverride | null>({
    queryKey: ["client-detail-override", clientId], enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase.from("client_pipeline_overrides" as never).select("stage_override, stage_changed_at, last_contact_date, next_action_date, callback_date, callback_time, schedule_overridden, communication_notes, reminder_notes").eq("client_id", clientId!).maybeSingle();
      if (error) throw error;
      return data as unknown as ClientOverride | null;
    },
  });

  const beneficiaries = useQuery<Beneficiary[]>({
    queryKey: ["client-beneficiaries", client.data?.insuracloud_pipeline_client_id], enabled: !!client.data?.insuracloud_pipeline_client_id,
    queryFn: async () => {
      const { data } = await supabase.from("agentlink_beneficiaries").select("id, first_name, last_name, relationship, percentage, date_of_birth").eq("insuracloud_pipeline_client_id", client.data!.insuracloud_pipeline_client_id!);
      return (data ?? []) as unknown as Beneficiary[];
    },
  });

  const contracts = useQuery<Contract[]>({
    queryKey: ["client-contracts", clientId], enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase.from("agentlink_contracts").select("id, carrier_name, product_name, face_amount, monthly_premium, status, effective_date").eq("client_id", clientId!).order("effective_date", { ascending: false });
      return (data ?? []) as unknown as Contract[];
    },
  });

  const activity = useQuery<Activity[]>({
    queryKey: ["client-pipeline-activity", clientId], enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase.from("client_pipeline_activity" as never).select("id, activity_type, body, metadata, created_at").eq("client_id", clientId!).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as Activity[];
    },
  });

  const c = useMemo(() => {
    if (!client.data) return null;
    const o = override.data;
    return { ...client.data,
      pipeline_stage: o?.stage_override ?? client.data.pipeline_stage,
      stage_changed_at: o?.stage_changed_at ?? client.data.stage_changed_at,
      last_contact_date: o?.last_contact_date ?? client.data.last_contact_date,
      next_action_date: o?.schedule_overridden ? o.next_action_date : client.data.next_action_date,
      callback_date: o?.schedule_overridden ? o.callback_date : client.data.callback_date,
      callback_time: o?.schedule_overridden ? o.callback_time : client.data.callback_time,
      communication_notes: o?.communication_notes ?? client.data.communication_notes,
      reminder_notes: o?.reminder_notes ?? client.data.reminder_notes,
    };
  }, [client.data, override.data]);

  useEffect(() => {
    if (!c) return;
    setNotes({ communication: c.communication_notes ?? "", reminder: c.reminder_notes ?? "" });
    setSchedule({ callbackDate: dateInput(c.callback_date), callbackTime: c.callback_time ?? "", nextAction: dateInput(c.next_action_date) });
  }, [c?.id, c?.communication_notes, c?.reminder_notes, c?.callback_date, c?.callback_time, c?.next_action_date]);

  const action = useMutation({
    mutationFn: async (args: Record<string, unknown>) => {
      const { error } = await rpc<void>("fn_client_pipeline_action", { p_client_id: clientId, ...args });
      if (error) throw new Error(error.message || "Client action failed");
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["client-detail-override", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["client-pipeline-activity", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["client-pipeline-overrides"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Client action failed"),
  });

  const saveStage = (stage: string) => {
    action.mutate(
      { p_stage: stage, p_activity_body: `Pipeline stage changed to ${stage.replaceAll("_", " ").toLowerCase()}` },
      { onSuccess: () => toast.success(stage === "SOLD" ? "Client marked sold" : "Pipeline stage updated") },
    );
  };

  if (client.isLoading) return <div className="page-enter space-y-4 px-4 pb-24 sm:px-6"><Skeleton className="h-24 w-full" /><Skeleton className="h-[620px] w-full" /></div>;
  if (!c) return <div className="page-enter space-y-4 px-4 pb-24 sm:px-6"><PageHeader eyebrow="Client not found" title="No client at this ID" subtitle="The client may have been deleted or you may not have access." /><Button asChild variant="outline"><Link to="/dashboard/clients"><ArrowLeft className="mr-1.5 h-4 w-4" /> Back to pipeline</Link></Button></div>;

  const displayName = [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
  const stage = c.pipeline_stage ?? "NEW_INITIAL";
  const activeStage = stage === "SOLD" ? 3 : stage === "ALMOST_THERE" ? 2 : ["WORKING", "PITCHED", "FOLLOW_UP"].includes(stage) ? 1 : 0;
  const dncFlags = [c.do_not_call && "DNC", c.do_not_email && "DNE", c.do_not_text && "DNT"].filter(Boolean) as string[];
  const callbackOverdue = Boolean(c.callback_date && isBefore(new Date(`${dateInput(c.callback_date)}T23:59:59`), new Date()));
  const coach = [
    !c.next_action_date ? "Set a next action before leaving this client." : `Next action is ${fmtDate(c.next_action_date)}.`,
    callbackOverdue ? `Callback is overdue from ${fmtDate(c.callback_date)}.` : c.callback_date ? `Callback is scheduled for ${fmtDate(c.callback_date)}.` : "No callback is scheduled.",
    !c.policy_number ? "Policy information is incomplete; confirm carrier, product, and policy number." : "Policy information is on file.",
  ];

  return (
    <div className="page-enter space-y-3 px-4 pb-24 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="w-fit"><Link to="/dashboard/clients"><ArrowLeft className="mr-1.5 h-4 w-4" /> Back to pipeline</Link></Button>

      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <header className="flex flex-col gap-3 border-b border-border bg-card px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{displayName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{c.phone ?? "No phone"}{c.email ? ` · ${c.email}` : ""}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dncFlags.length > 0 && <Badge variant="destructive">{dncFlags.join(" · ")}</Badge>}
            {c.phone && !c.do_not_call && <Button asChild size="sm" variant="outline"><a href={`tel:${c.phone}`} onClick={() => action.mutate({ p_activity_type: "call_opened", p_activity_body: "Call opened from client workspace" })}><PhoneCall className="mr-1.5 h-4 w-4" /> Call</a></Button>}
            {c.phone && !c.do_not_text && <Button asChild size="sm" variant="outline"><a href={`sms:${c.phone}`} onClick={() => action.mutate({ p_activity_type: "sms_opened", p_activity_body: "SMS opened from client workspace" })}><MessageSquare className="mr-1.5 h-4 w-4" /> SMS</a></Button>}
            <SubmitDealDialog initialClient={{ firstName: c.first_name ?? "", lastName: c.last_name ?? "", phone: c.phone ?? "", dob: dateInput(c.date_of_birth) }} trigger={<Button size="sm" variant="outline"><ReceiptText className="mr-1.5 h-4 w-4" /> Submit Case for Design</Button>} />
            <Button size="sm" onClick={() => saveStage("SOLD")} disabled={action.isPending}><CheckCircle2 className="mr-1.5 h-4 w-4" /> Mark Sold</Button>
          </div>
        </header>

        <div className="grid grid-cols-4 gap-1 border-b border-border px-4 py-3">
          {STAGES.map((item, index) => (
            <button key={item.value} type="button" onClick={() => saveStage(item.value)} disabled={action.isPending} className={cn("min-h-10 rounded-full border px-2 py-1 text-[11px] font-semibold leading-tight transition-colors sm:text-xs", index === activeStage ? "border-primary bg-primary text-primary-foreground" : index < activeStage ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground")}>{item.label}</button>
          ))}
        </div>

        <Tabs defaultValue="timeline">
          <TabsList className="overflow-x-auto px-2">
            {TAB_ITEMS.map(([value, label, Icon]) => <TabsTrigger key={value} value={value} className="gap-1.5 text-xs"><Icon className="h-3.5 w-3.5" />{label}</TabsTrigger>)}
          </TabsList>

          <div className="grid min-h-[520px] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_300px]">
            <main className="min-w-0">
              <TabsContent value="timeline" className="mt-0"><Panel title="Timeline">{activity.isLoading ? <Skeleton className="h-40 w-full" /> : (activity.data?.length ?? 0) === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No activity yet. Calls, texts, notes, schedules, and stage changes will appear here.</p> : <ol className="space-y-3">{activity.data!.map((item) => <li key={item.id} className="flex gap-3 border-b border-border pb-3 last:border-0"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" /><div><p className="text-sm font-medium capitalize">{item.activity_type.replaceAll("_", " ")}</p>{item.body && <p className="text-sm text-muted-foreground">{item.body}</p>}<p className="mt-1 text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</p></div></li>)}</ol>}</Panel></TabsContent>

              <TabsContent value="contact" className="mt-0"><Panel title="Contact"><EditableClientSection clientId={clientId!} values={c as unknown as Record<string, unknown>} fields={[
                { key: "first_name", label: "First name" },
                { key: "last_name", label: "Last name" },
                { key: "phone", label: "Phone", type: "tel" },
                { key: "email", label: "Email", type: "email" },
                { key: "street_address", label: "Street address" },
                { key: "city", label: "City" },
                { key: "state", label: "State" },
                { key: "zip_code", label: "ZIP" },
                { key: "date_of_birth", label: "Date of birth", type: "date" },
                { key: "preferred_contact_method", label: "Preferred channel" },
                { key: "best_time_to_call", label: "Best time to call" },
                { key: "client_timezone", label: "Timezone" },
              ]} />{isAdmin && c.raw_payload && <details className="mt-5"><summary className="cursor-pointer text-xs text-muted-foreground">Raw AgentLink payload (admin)</summary><pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-[10px]">{JSON.stringify(c.raw_payload, null, 2)}</pre></details>}</Panel></TabsContent>

              <TabsContent value="needs" className="mt-0"><Panel title="Needs Analysis"><EditableClientSection clientId={clientId!} values={c as unknown as Record<string, unknown>} fields={[
                { key: "employer_occupation", label: "Occupation" },
                { key: "employment_status", label: "Employment status" },
                { key: "retirement_age_goal", label: "Retirement goal age", type: "number" },
                { key: "retirement_year", label: "Retirement year", type: "number" },
                { key: "legacy_estate", label: "Legacy estate goal", type: "number" },
                { key: "is_smoker", label: "Smoker", hint: "true or false" },
                { key: "physician_name", label: "Physician" },
                { key: "physician_phone", label: "Physician phone", type: "tel" },
                { key: "objectives", label: "Objectives" },
                { key: "medical_notes", label: "Medical notes" },
              ]} /></Panel></TabsContent>

              <TabsContent value="schedule" className="mt-0"><Panel title="Schedule"><div className="grid gap-4 sm:grid-cols-3"><div className="space-y-1.5"><Label htmlFor="client-callback-date">Callback date</Label><Input id="client-callback-date" type="date" value={schedule.callbackDate} onChange={(event) => setSchedule((value) => ({ ...value, callbackDate: event.target.value }))} /></div><div className="space-y-1.5"><Label htmlFor="client-callback-time">Callback time</Label><Input id="client-callback-time" type="time" value={schedule.callbackTime} onChange={(event) => setSchedule((value) => ({ ...value, callbackTime: event.target.value }))} /></div><div className="space-y-1.5"><Label htmlFor="client-next-action">Next action date</Label><Input id="client-next-action" type="date" value={schedule.nextAction} onChange={(event) => setSchedule((value) => ({ ...value, nextAction: event.target.value }))} /></div></div><Button className="mt-4" disabled={action.isPending} onClick={() => action.mutate({ p_callback_date: schedule.callbackDate || null, p_callback_time: schedule.callbackTime || null, p_next_action_date: schedule.nextAction || null, p_replace_schedule: true, p_activity_type: "schedule_updated", p_activity_body: "Client follow-up schedule updated" }, { onSuccess: () => toast.success("Schedule saved") })}><Save className="mr-1.5 h-4 w-4" /> Save Schedule</Button></Panel></TabsContent>

              <TabsContent value="beneficiaries" className="mt-0"><Panel title="Beneficiaries">{(beneficiaries.data?.length ?? 0) > 0 ? <div className="space-y-2">{beneficiaries.data!.map((beneficiary) => <div key={beneficiary.id} className="rounded-md border border-border p-3"><p className="text-sm font-semibold">{[beneficiary.first_name, beneficiary.last_name].filter(Boolean).join(" ") || "—"}</p><p className="text-xs text-muted-foreground">{beneficiary.relationship ?? "—"}{beneficiary.percentage ? ` · ${beneficiary.percentage}%` : ""}{beneficiary.date_of_birth ? ` · DOB ${fmtDate(beneficiary.date_of_birth)}` : ""}</p></div>)}</div> : c.beneficiary_first_name || c.beneficiary_last_name ? <p className="text-sm">{[c.beneficiary_first_name, c.beneficiary_last_name].filter(Boolean).join(" ")}</p> : <p className="py-12 text-center text-sm text-muted-foreground">No beneficiaries on file.</p>}</Panel></TabsContent>

              <TabsContent value="referrals" className="mt-0"><Panel title="Referrals"><dl className="grid gap-4 sm:grid-cols-2"><Field label="Referred by" value={[c.referred_from_client_first_name, c.referred_from_client_last_name].filter(Boolean).join(" ") || "Direct lead"} /><Field label="Lead vendor" value={c.lead_vendor_name} /><Field label="Lead product" value={c.lead_product_name} /></dl></Panel></TabsContent>

              <TabsContent value="financials" className="mt-0"><Panel title="Financials"><EditableClientSection clientId={clientId!} values={c as unknown as Record<string, unknown>} fields={[
                { key: "total_monthly_income", label: "Monthly income", type: "number" },
                { key: "total_monthly_expenses", label: "Monthly expenses", type: "number" },
                { key: "monthly_surplus", label: "Monthly surplus", type: "number" },
                { key: "earned_income", label: "Earned income", type: "number" },
                { key: "pension_income", label: "Pension", type: "number" },
                { key: "social_security_income", label: "Social Security", type: "number" },
                { key: "mortgage_payment", label: "Mortgage payment", type: "number" },
                { key: "rent_payment", label: "Rent payment", type: "number" },
                { key: "qualified_accounts", label: "Qualified accounts", type: "number" },
                { key: "non_qualified_accounts", label: "Non-qualified accounts", type: "number" },
                { key: "bank_name", label: "Bank" },
                { key: "bank_account_type", label: "Account type" },
              ]} /></Panel></TabsContent>

              <TabsContent value="policies" className="mt-0"><Panel title="Policy Information"><EditableClientSection clientId={clientId!} values={c as unknown as Record<string, unknown>} fields={[
                { key: "pitch_carrier", label: "Carrier" },
                { key: "product_sold", label: "Product sold" },
                { key: "policy_number", label: "Policy number" },
                { key: "face_amount", label: "Face amount", type: "number" },
                { key: "pitch_price", label: "Monthly premium", type: "number" },
                { key: "policy_start_date", label: "Effective date", type: "date" },
                { key: "policy_review_date", label: "Review date", type: "date" },
              ]} />{(contracts.data?.length ?? 0) > 0 && <div className="mt-5 space-y-2 border-t border-border pt-4">{contracts.data!.map((contract) => <div key={contract.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm"><div><p className="font-semibold">{contract.carrier_name ?? "—"} · {contract.product_name ?? "—"}</p><p className="text-xs text-muted-foreground">{contract.status ?? "—"} · {fmtDate(contract.effective_date)}</p></div><div className="text-right"><p className="font-semibold">{fmtMoney(contract.face_amount)}</p><p className="text-xs text-muted-foreground">{fmtMoney(contract.monthly_premium)}/mo</p></div></div>)}</div>}<SubmitDealDialog initialClient={{ firstName: c.first_name ?? "", lastName: c.last_name ?? "", phone: c.phone ?? "", dob: dateInput(c.date_of_birth) }} trigger={<Button className="mt-4"><ReceiptText className="mr-1.5 h-4 w-4" /> Post Deal</Button>} /></Panel></TabsContent>

              <TabsContent value="notes" className="mt-0"><Panel title="Notes"><div className="space-y-4"><div className="space-y-1.5"><Label htmlFor="client-communication-notes">Communication notes</Label><Textarea id="client-communication-notes" value={notes.communication} onChange={(event) => setNotes((value) => ({ ...value, communication: event.target.value }))} rows={6} placeholder="Calls, messages, preferences, and context…" /></div><div className="space-y-1.5"><Label htmlFor="client-reminder-notes">Reminder notes</Label><Textarea id="client-reminder-notes" value={notes.reminder} onChange={(event) => setNotes((value) => ({ ...value, reminder: event.target.value }))} rows={4} placeholder="What must happen next…" /></div><Button disabled={action.isPending} onClick={() => action.mutate({ p_communication_notes: notes.communication, p_reminder_notes: notes.reminder, p_replace_notes: true, p_activity_type: "notes_updated", p_activity_body: "Client notes updated" }, { onSuccess: () => toast.success("Notes saved") })}><Save className="mr-1.5 h-4 w-4" /> Save Notes</Button></div></Panel></TabsContent>
            </main>

            <aside className="space-y-3">
              <Panel title="AI Coach"><div className="space-y-2">{coach.map((line) => <p key={line} className="rounded-md bg-muted px-3 py-2 text-sm">{line}</p>)}</div></Panel>
              <Panel title="Review Prep"><p className="text-sm text-muted-foreground">Prepare the annual-income, coverage, and servicing check before speaking with the client.</p><Button className="mt-3 w-full" variant="outline" onClick={() => setPrepOpen((value) => !value)}>{prepOpen ? "Hide checklist" : "Prepare"}</Button>{prepOpen && <ul className="mt-3 space-y-2 text-sm"><li>• Confirm contact information</li><li>• Review current policy and premium</li><li>• Recheck beneficiary details</li><li>• Set the next action before closing</li></ul>}</Panel>
              <Panel title="Client Status"><dl className="grid gap-3"><Field label="Stage" value={STAGES[activeStage].label} /><Field label="Last contact" value={fmtDate(c.last_contact_date)} /><Field label="Next action" value={fmtDate(c.next_action_date)} /><Field label="Health score" value={c.client_health_score != null ? `${c.client_health_score}/100` : "—"} /></dl></Panel>
            </aside>
          </div>
        </Tabs>
      </section>
    </div>
  );
}
