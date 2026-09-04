import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "email" | "tel";
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email";
  maxLength?: number;
};

const CORE_FIELDS: Field[] = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "email", label: "Email", type: "email" },
  { key: "date_of_birth", label: "Date of birth", type: "date" },
  { key: "state", label: "State", placeholder: "TX", maxLength: 2 },
  { key: "height", label: "Height", placeholder: "5' 10\"" },
  { key: "weight", label: "Weight (lb)", inputMode: "numeric" },
  { key: "total_monthly_income", label: "Monthly income", type: "number" },
  { key: "monthly_surplus", label: "Comfortable monthly budget", type: "number" },
  { key: "face_amount", label: "Coverage goal", type: "number" },
  { key: "beneficiary_first_name", label: "Beneficiary first name" },
  { key: "beneficiary_last_name", label: "Beneficiary last name" },
];

const CONTACT_FIELDS: Field[] = [
  { key: "street_address", label: "Street address" },
  { key: "city", label: "City" },
  { key: "zip_code", label: "ZIP", inputMode: "numeric" },
  { key: "preferred_contact_method", label: "Preferred contact" },
  { key: "best_time_to_call", label: "Best time to call" },
  { key: "client_timezone", label: "Timezone" },
];

const UNDERWRITING_FIELDS: Field[] = [
  { key: "born_location", label: "Birth state / country" },
  { key: "ssn_last4", label: "SSN last 4", inputMode: "numeric", maxLength: 4 },
  { key: "employer_occupation", label: "Occupation" },
  { key: "employment_status", label: "Employment status" },
  { key: "physician_name", label: "Primary physician" },
  { key: "physician_phone", label: "Physician phone", type: "tel" },
  { key: "physician_address", label: "Physician address" },
  { key: "retirement_age_goal", label: "Retirement goal age", type: "number" },
  { key: "legacy_estate", label: "Legacy goal", type: "number" },
];

const FINANCIAL_FIELDS: Field[] = [
  { key: "earned_income", label: "Earned income", type: "number" },
  { key: "pension_income", label: "Pension", type: "number" },
  { key: "social_security_income", label: "Social Security income", type: "number" },
  { key: "other_monthly_income", label: "Other monthly income", type: "number" },
  { key: "total_monthly_expenses", label: "Total monthly expenses", type: "number" },
  { key: "mortgage_payment", label: "Mortgage", type: "number" },
  { key: "rent_payment", label: "Rent", type: "number" },
  { key: "transportation_expense", label: "Transportation", type: "number" },
  { key: "utilities_expense", label: "Utilities", type: "number" },
  { key: "insurance_expense", label: "Insurance", type: "number" },
  { key: "other_monthly_expenses", label: "Other expenses", type: "number" },
  { key: "qualified_accounts", label: "Qualified accounts", type: "number" },
  { key: "non_qualified_accounts", label: "Non-qualified accounts", type: "number" },
  { key: "non_qualified_assets", label: "Other assets", type: "number" },
  { key: "total_investable", label: "Total investable", type: "number" },
  { key: "retirement_savings_qualified", label: "Retirement savings", type: "number" },
  { key: "bank_name", label: "Bank name" },
  { key: "bank_account_type", label: "Account type" },
];

const POLICY_FIELDS: Field[] = [
  { key: "pitch_carrier", label: "Quoted carrier" },
  { key: "product_sold", label: "Product" },
  { key: "pitch_price", label: "Monthly premium", type: "number" },
  { key: "policy_number", label: "Policy number" },
  { key: "policy_start_date", label: "Effective date", type: "date" },
  { key: "policy_review_date", label: "Review date", type: "date" },
  { key: "beneficiary_count", label: "Beneficiary count", type: "number" },
];

const ALL_FIELDS = [...CORE_FIELDS, ...CONTACT_FIELDS, ...UNDERWRITING_FIELDS, ...FINANCIAL_FIELDS, ...POLICY_FIELDS];
const REQUIRED_KEYS = ["first_name", "last_name", "phone", "date_of_birth", "state", "height", "weight", "is_smoker", "total_monthly_income", "monthly_surplus"];

function valueForInput(value: unknown, type?: string): string {
  if (value === null || value === undefined) return "";
  if (type === "date") return String(value).slice(0, 10);
  return String(value);
}

function rpc<T>(name: string, args: Record<string, unknown>) {
  return (supabase.rpc as unknown as (fn: string, values: Record<string, unknown>) => Promise<{ data: T | null; error: { message?: string } | null }>)(name, args);
}

export function ClientCallWorkspace({ clientId, values }: { clientId: string; values: Record<string, unknown> }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState({ callbackDate: "", callbackTime: "", nextAction: "" });
  const [notes, setNotes] = useState({ communication: "", reminder: "", objectives: "", medical: "" });

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const field of ALL_FIELDS) next[field.key] = valueForInput(values[field.key], field.type);
    next.is_smoker = valueForInput(values.is_smoker);
    setDraft(next);
    setSchedule({
      callbackDate: valueForInput(values.callback_date, "date"),
      callbackTime: valueForInput(values.callback_time),
      nextAction: valueForInput(values.next_action_date, "date"),
    });
    setNotes({
      communication: valueForInput(values.communication_notes),
      reminder: valueForInput(values.reminder_notes),
      objectives: valueForInput(values.objectives),
      medical: valueForInput(values.medical_notes),
    });
  }, [clientId, values]);

  const completed = useMemo(() => REQUIRED_KEYS.filter((key) => (draft[key] ?? "").trim() !== "").length, [draft]);
  const completion = Math.round((completed / REQUIRED_KEYS.length) * 100);

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, string> = {};
      for (const field of ALL_FIELDS) {
        const before = valueForInput(values[field.key], field.type);
        const after = (draft[field.key] ?? "").trim();
        if (before !== after) patch[field.key] = after;
      }
      const smokerBefore = valueForInput(values.is_smoker);
      if ((draft.is_smoker ?? "") !== smokerBefore) patch.is_smoker = draft.is_smoker ?? "";
      if (notes.objectives.trim() !== valueForInput(values.objectives)) patch.objectives = notes.objectives.trim();
      if (notes.medical.trim() !== valueForInput(values.medical_notes)) patch.medical_notes = notes.medical.trim();

      let changed = Object.keys(patch).length;
      if (changed > 0) {
        const { error } = await rpc("fn_client_pipeline_update", { p_client_id: clientId, p_patch: patch });
        if (error) throw new Error(error.message || "Client details could not be saved");
      }

      const workflowChanged =
        schedule.callbackDate !== valueForInput(values.callback_date, "date") ||
        schedule.callbackTime !== valueForInput(values.callback_time) ||
        schedule.nextAction !== valueForInput(values.next_action_date, "date") ||
        notes.communication.trim() !== valueForInput(values.communication_notes) ||
        notes.reminder.trim() !== valueForInput(values.reminder_notes);

      if (workflowChanged) {
        const { error } = await rpc("fn_client_pipeline_action", {
          p_client_id: clientId,
          p_callback_date: schedule.callbackDate || null,
          p_callback_time: schedule.callbackTime || null,
          p_next_action_date: schedule.nextAction || null,
          p_replace_schedule: true,
          p_communication_notes: notes.communication.trim(),
          p_reminder_notes: notes.reminder.trim(),
          p_replace_notes: true,
          p_activity_type: "call_progress_saved",
          p_activity_body: "Call sheet and next action saved",
        });
        if (error) throw new Error(error.message || "Call follow-up could not be saved");
        changed += 1;
      }
      return changed;
    },
    onSuccess: async (changed) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["client-detail", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["client-detail-override", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["client-pipeline-activity", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["client-pipeline"] }),
      ]);
      toast.success(changed ? "Call progress saved" : "Everything is already saved");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Call progress could not be saved"),
  });

  const update = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const renderFields = (fields: Field[]) => (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={`call-${field.key}`} className="text-xs">{field.label}</Label>
          <Input
            id={`call-${field.key}`}
            type={field.type ?? "text"}
            value={draft[field.key] ?? ""}
            inputMode={field.inputMode}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            autoComplete="off"
            onChange={(event) => update(field.key, field.key === "state" ? event.target.value.toUpperCase() : event.target.value)}
          />
        </div>
      ))}
    </div>
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-primary/30 bg-card">
        <div className="border-b border-border bg-primary/5 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">Fast Call Sheet</h2>
                <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">one save</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Capture the sale in order. Expand deeper details only when you need them.</p>
            </div>
            <div className="min-w-44">
              <div className="flex items-center justify-between text-xs"><span>Application readiness</span><strong>{completed}/{REQUIRED_KEYS.length}</strong></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${completion}%` }} /></div>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-4 sm:p-5">
          <section>
            <div className="mb-3 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span><h3 className="font-semibold">Confirm the client</h3></div>
            {renderFields(CORE_FIELDS.slice(0, 6))}
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span><h3 className="font-semibold">Qualify and protect the budget</h3></div>
            {renderFields(CORE_FIELDS.slice(6))}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="call-is-smoker" className="text-xs">Nicotine use</Label>
                <select id="call-is-smoker" value={draft.is_smoker ?? ""} onChange={(event) => update("is_smoker", event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">Select</option><option value="false">No</option><option value="true">Yes</option>
                </select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="call-objectives" className="text-xs">What are they protecting?</Label><Textarea id="call-objectives" value={notes.objectives} onChange={(event) => setNotes((current) => ({ ...current, objectives: event.target.value }))} rows={2} placeholder="Mortgage, income, burial, legacy…" /></div>
            </div>
            <div className="mt-3 space-y-1.5"><Label htmlFor="call-medical" className="text-xs">Health, medications, and conditions</Label><Textarea id="call-medical" value={notes.medical} onChange={(event) => setNotes((current) => ({ ...current, medical: event.target.value }))} rows={3} placeholder="Capture the underwriting facts while the client is answering." /></div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span><h3 className="font-semibold">Lock the next action</h3></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5"><Label htmlFor="call-callback-date" className="text-xs">Callback date</Label><Input id="call-callback-date" type="date" value={schedule.callbackDate} onChange={(event) => setSchedule((current) => ({ ...current, callbackDate: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label htmlFor="call-callback-time" className="text-xs">Callback time</Label><Input id="call-callback-time" type="time" value={schedule.callbackTime} onChange={(event) => setSchedule((current) => ({ ...current, callbackTime: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label htmlFor="call-next-action" className="text-xs">Next action date</Label><Input id="call-next-action" type="date" value={schedule.nextAction} onChange={(event) => setSchedule((current) => ({ ...current, nextAction: event.target.value }))} /></div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="call-notes" className="text-xs">Call notes</Label><Textarea id="call-notes" value={notes.communication} onChange={(event) => setNotes((current) => ({ ...current, communication: event.target.value }))} rows={3} placeholder="Objections, preferences, family context…" /></div>
              <div className="space-y-1.5"><Label htmlFor="call-reminder" className="text-xs">Exact next step</Label><Textarea id="call-reminder" value={notes.reminder} onChange={(event) => setNotes((current) => ({ ...current, reminder: event.target.value }))} rows={3} placeholder="What must happen next?" /></div>
            </div>
          </section>

          <Accordion type="multiple" className="rounded-lg border border-border px-4">
            <AccordionItem value="contact"><AccordionTrigger className="text-sm">Address and communication details</AccordionTrigger><AccordionContent>{renderFields(CONTACT_FIELDS)}</AccordionContent></AccordionItem>
            <AccordionItem value="underwriting"><AccordionTrigger className="text-sm">Full underwriting details</AccordionTrigger><AccordionContent><p className="mb-3 text-xs text-muted-foreground">Store only the last four digits of SSN here. Enter the full SSN only inside the carrier's secure application.</p>{renderFields(UNDERWRITING_FIELDS)}</AccordionContent></AccordionItem>
            <AccordionItem value="financial"><AccordionTrigger className="text-sm">Full financial picture and banking</AccordionTrigger><AccordionContent>{renderFields(FINANCIAL_FIELDS)}</AccordionContent></AccordionItem>
            <AccordionItem value="policy"><AccordionTrigger className="text-sm">Quote, policy, and beneficiary details</AccordionTrigger><AccordionContent>{renderFields(POLICY_FIELDS)}</AccordionContent></AccordionItem>
          </Accordion>
        </div>
      </section>

      <div className="sticky bottom-3 z-20 rounded-xl border border-border bg-background/95 p-2 shadow-lg backdrop-blur">
        <Button type="submit" size="lg" className={cn("w-full font-bold", completion === 100 && "bg-emerald-600 hover:bg-emerald-600/90")} disabled={save.isPending}>
          {completion === 100 ? <CheckCircle2 className="mr-2 h-5 w-5" /> : <Save className="mr-2 h-5 w-5" />}
          {save.isPending ? "Saving everything…" : "Save all call progress"}
        </Button>
      </div>
    </form>
  );
}
