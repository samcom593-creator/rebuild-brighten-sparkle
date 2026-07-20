// PL-046: Per-client drilldown — every field Sam asked for on one page.
//
// Renders one agentlink_clients row + its beneficiaries + contracts in a
// 14-section layout matching the AgentLink pipeline detail screen so agents
// stay in Apex instead of bouncing to AgentLink.
//
// Sections: Header · Status & Owner · Policies · Financials · Needs Analysis ·
// Beneficiaries · Referrals · Schedule · Notes · Communication preferences ·
// Email · SMS · Lead source · Raw payload (admin only).

import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft, BookMarked, Building2, CalendarClock, CheckCircle2,
  CircleDollarSign, Heart, Mail, MapPin, PhoneCall, ShieldAlert, Sparkles,
  StickyNote, User, UserPlus, Users, Wallet, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ClientRow {
  id: string;
  insuracloud_pipeline_client_id: string | null;
  agent_id: string | null;
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
  needs_analysis_data: any;
  objectives: string | null;
  communication_notes: string | null;
  reminder_notes: string | null;
  beneficiary_first_name: string | null;
  beneficiary_last_name: string | null;
  beneficiary_count: number | null;
  referred_from_client_id: string | null;
  referred_from_client_first_name: string | null;
  referred_from_client_last_name: string | null;
  lead_vendor_name: string | null;
  lead_product_name: string | null;
  imported_at: string | null;
  external_source: string | null;
  raw_payload: any;
}

interface Beneficiary {
  id: string;
  first_name: string | null;
  last_name: string | null;
  relationship: string | null;
  percentage: number | string | null;
  date_of_birth: string | null;
}

interface Contract {
  id: string;
  carrier_name: string | null;
  product_name: string | null;
  face_amount: number | string | null;
  monthly_premium: number | string | null;
  status: string | null;
  effective_date: string | null;
}

function fmtMoney(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try { return format(new Date(d), "MMM d, yyyy"); } catch { return d; }
}

function Field({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value ?? "—"}</dd>
      {hint && <p className="text-[10px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

function Section({ icon: Icon, title, children, accent }: { icon: React.ElementType; title: string; children: React.ReactNode; accent?: string }) {
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={cn("rounded-md p-1.5", accent ?? "bg-primary/10")}>
          <Icon className={cn("h-4 w-4", accent ? "text-foreground" : "text-primary")} />
        </div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{title}</h3>
      </div>
      <div>{children}</div>
    </GlassCard>
  );
}

export default function ClientDetail() {
  const { clientId } = useParams<{ clientId: string }>();
  usePageTitle("Client · APEX");
  const { isAdmin } = useAuth();

  const client = useQuery<ClientRow | null>({
    queryKey: ["client-detail", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agentlink_clients")
        .select("*")
        .eq("id", clientId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ClientRow | null;
    },
  });

  // Beneficiaries linked via insuracloud_pipeline_client_id
  const beneficiaries = useQuery<Beneficiary[]>({
    queryKey: ["client-beneficiaries", client.data?.insuracloud_pipeline_client_id],
    enabled: !!client.data?.insuracloud_pipeline_client_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("agentlink_beneficiaries")
        .select("id, first_name, last_name, relationship, percentage, date_of_birth")
        .eq("insuracloud_pipeline_client_id", client.data!.insuracloud_pipeline_client_id!);
      return (data ?? []) as unknown as Beneficiary[];
    },
  });

  const contracts = useQuery<Contract[]>({
    queryKey: ["client-contracts", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase
        .from("agentlink_contracts")
        .select("id, carrier_name, product_name, face_amount, monthly_premium, status, effective_date")
        .eq("client_id", clientId!)
        .order("effective_date", { ascending: false });
      return (data ?? []) as unknown as Contract[];
    },
  });

  const c = client.data;
  const displayName = useMemo(() => {
    const parts = [c?.first_name, c?.last_name].filter(Boolean);
    return parts.join(" ") || "—";
  }, [c]);

  if (client.isLoading) {
    return (
      <div className="page-enter px-4 sm:px-6 pb-24 space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-3 lg:grid-cols-2">
          {/* stable-key-allow:skeleton */}
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      </div>
    );
  }

  if (!c) {
    return (
      <div className="page-enter px-4 sm:px-6 pb-24 space-y-4">
        <PageHeader
          eyebrow="Client not found"
          title="No client at this ID"
          subtitle="The client may have been deleted or you may not have access."
        />
        <Button asChild variant="outline">
          <Link to="/dashboard/agent-pipeline"><ArrowLeft className="h-4 w-4 mr-1.5" /> Back to client pipeline</Link>
        </Button>
      </div>
    );
  }

  const dncFlags = [c.do_not_call && "DNC", c.do_not_email && "DNE", c.do_not_text && "DNT"].filter(Boolean) as string[];
  const stageLabel = (c.pipeline_stage ?? "—").replaceAll("_", " ");

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-4">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link to="/dashboard/agent-pipeline"><ArrowLeft className="h-4 w-4 mr-1.5" /> Back to pipeline</Link>
      </Button>

      <PageHeader
        eyebrow={c.insuracloud_pipeline_client_id ? `Client · AgentLink #${c.insuracloud_pipeline_client_id}` : "Client"}
        eyebrowIcon={<User className="h-3 w-3" />}
        title={displayName}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge variant="secondary" className="capitalize">{stageLabel}</Badge>
            {c.policy_number && <span className="text-xs">Policy <span className="font-medium text-foreground">{c.policy_number}</span></span>}
            {c.pitch_carrier && <span className="text-xs">Carrier <span className="font-medium text-foreground">{c.pitch_carrier}</span></span>}
            {c.face_amount && <span className="text-xs text-emerald-500 dark:text-emerald-400">{fmtMoney(c.face_amount)} face</span>}
            {dncFlags.length > 0 && <Badge variant="destructive" className="text-[10px]">{dncFlags.join(" · ")}</Badge>}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {c.phone && (
              <Button size="sm" asChild>
                <a href={`tel:${c.phone}`}><PhoneCall className="h-4 w-4 mr-1.5" /> {c.phone}</a>
              </Button>
            )}
            {c.email && (
              <Button size="sm" variant="outline" asChild>
                <a href={`mailto:${c.email}`}><Mail className="h-4 w-4 mr-1.5" /> Email</a>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Status & Owner */}
        <Section icon={ShieldAlert} title="Status & owner">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Pipeline stage" value={<span className="capitalize">{stageLabel}</span>} />
            <Field label="Stage changed" value={fmtDate(c.stage_changed_at)} />
            <Field label="Last contact" value={fmtDate(c.last_contact_date)} />
            <Field label="Next action" value={fmtDate(c.next_action_date)} />
            <Field label="Health score" value={c.client_health_score != null ? `${c.client_health_score}/100` : "—"} />
            <Field label="Lead source" value={c.lead_vendor_name ?? c.external_source} />
          </dl>
        </Section>

        {/* Policies */}
        <Section icon={BookMarked} title="Policies">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Carrier (pitched)" value={c.pitch_carrier} />
            <Field label="Product sold" value={c.product_sold} />
            <Field label="Policy #" value={c.policy_number} />
            <Field label="Face amount" value={fmtMoney(c.face_amount)} />
            <Field label="Monthly premium (pitch)" value={fmtMoney(c.pitch_price)} />
            <Field label="Policy start" value={fmtDate(c.policy_start_date)} />
            <Field label="Policy review" value={fmtDate(c.policy_review_date)} />
            <Field label="Smoker" value={c.is_smoker == null ? "—" : c.is_smoker ? "Yes" : "No"} />
          </dl>
          {(contracts.data?.length ?? 0) > 0 && (
            <div className="mt-3 pt-3 border-t border-border/40">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">All carrier contracts</p>
              <ul className="space-y-1.5">
                {contracts.data!.map((k) => (
                  <li key={k.id} className="flex items-center justify-between text-xs rounded border border-border/40 px-2.5 py-1.5">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{k.carrier_name ?? "—"} · {k.product_name ?? "—"}</p>
                      <p className="text-[10px] text-muted-foreground">{k.status ?? "—"} · {fmtDate(k.effective_date)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold tabular-nums">{fmtMoney(k.face_amount)}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">{fmtMoney(k.monthly_premium)}/mo</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {/* Financials */}
        <Section icon={Wallet} title="Financials">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Earned income" value={fmtMoney(c.earned_income)} />
            <Field label="Pension" value={fmtMoney(c.pension_income)} />
            <Field label="Social Security" value={fmtMoney(c.social_security_income)} />
            <Field label="Other income" value={fmtMoney(c.other_monthly_income)} />
            <Field label="Monthly income" value={<span className="text-emerald-500 dark:text-emerald-400 font-bold">{fmtMoney(c.total_monthly_income)}</span>} />
            <Field label="Monthly expenses" value={<span className="text-rose-500 dark:text-rose-400 font-bold">{fmtMoney(c.total_monthly_expenses)}</span>} />
            <Field label="Monthly surplus" value={<span className="font-bold">{fmtMoney(c.monthly_surplus)}</span>} />
            <Field label="Qualified $" value={fmtMoney(c.qualified_accounts)} />
            <Field label="Non-qualified $" value={fmtMoney(c.non_qualified_accounts)} />
            <Field label="Bank" value={c.bank_name ? `${c.bank_name} (${c.bank_account_type ?? "—"})` : "—"} hint={c.ssn_last4 ? `SSN ****${c.ssn_last4}` : undefined} />
          </div>
        </Section>

        {/* Needs analysis */}
        <Section icon={Sparkles} title="Needs analysis">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Completed" value={fmtDate(c.needs_analysis_completed_at)} />
            <Field label="Retirement goal age" value={c.retirement_age_goal != null ? `${c.retirement_age_goal}` : "—"} />
            <Field label="Retirement year" value={c.retirement_year != null ? `${c.retirement_year}` : "—"} />
            <Field label="Legacy estate goal" value={fmtMoney(c.legacy_estate)} />
            {c.objectives && (
              <div className="col-span-2">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Objectives</dt>
                <dd className="text-sm whitespace-pre-wrap">{c.objectives}</dd>
              </div>
            )}
          </dl>
        </Section>

        {/* Beneficiaries */}
        <Section icon={Users} title={`Beneficiaries${c.beneficiary_count ? ` (${c.beneficiary_count})` : ""}`}>
          {beneficiaries.data && beneficiaries.data.length > 0 ? (
            <ul className="space-y-2">
              {beneficiaries.data.map((b) => (
                <li key={b.id} className="rounded border border-border/40 p-2.5">
                  <p className="font-semibold text-sm">{[b.first_name, b.last_name].filter(Boolean).join(" ") || "—"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {b.relationship ?? "—"}{b.percentage ? ` · ${b.percentage}%` : ""}{b.date_of_birth ? ` · DOB ${fmtDate(b.date_of_birth)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : c.beneficiary_first_name || c.beneficiary_last_name ? (
            <p className="text-sm">{[c.beneficiary_first_name, c.beneficiary_last_name].filter(Boolean).join(" ")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No beneficiaries on file.</p>
          )}
        </Section>

        {/* Referrals */}
        <Section icon={UserPlus} title="Referral source">
          {c.referred_from_client_id ? (
            <p className="text-sm">
              Referred by{" "}
              <Link to={`/dashboard/clients/${c.referred_from_client_id}`} className="text-primary hover:underline font-medium">
                {[c.referred_from_client_first_name, c.referred_from_client_last_name].filter(Boolean).join(" ") || "client"}
              </Link>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Direct lead (no referral on file).</p>
          )}
          {c.lead_vendor_name && (
            <p className="text-xs text-muted-foreground mt-2">Lead vendor: <span className="text-foreground">{c.lead_vendor_name}</span>{c.lead_product_name ? ` · ${c.lead_product_name}` : ""}</p>
          )}
        </Section>

        {/* Schedule */}
        <Section icon={CalendarClock} title="Schedule">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Callback date" value={fmtDate(c.callback_date)} hint={c.callback_time ?? undefined} />
            <Field label="Next action" value={fmtDate(c.next_action_date)} />
            <Field label="Best time to call" value={c.best_time_to_call} />
            <Field label="Timezone" value={c.client_timezone} />
            <Field label="Last contact" value={fmtDate(c.last_contact_date)} />
            <Field label="Preferred channel" value={c.preferred_contact_method ?? "—"} hint={dncFlags.length > 0 ? `Blocked: ${dncFlags.join(", ")}` : undefined} />
          </dl>
        </Section>

        {/* Client care */}
        <Section icon={Heart} title="Client care">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Occupation" value={c.employer_occupation} />
            <Field label="Employment status" value={c.employment_status} />
            <Field label="Address" value={[c.street_address, c.city, c.state, c.zip_code].filter(Boolean).join(", ")} />
            <Field label="Date of birth" value={fmtDate(c.date_of_birth)} />
            <Field label="Physician" value={c.physician_name} hint={c.physician_phone ?? undefined} />
            <Field label="Medical notes" value={c.medical_notes} />
          </dl>
        </Section>
      </div>

      {/* Notes (full width) */}
      {(c.communication_notes || c.reminder_notes) && (
        <Section icon={StickyNote} title="Notes">
          {c.communication_notes && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Communication</p>
              <p className="text-sm whitespace-pre-wrap">{c.communication_notes}</p>
            </div>
          )}
          {c.reminder_notes && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Reminders</p>
              <p className="text-sm whitespace-pre-wrap">{c.reminder_notes}</p>
            </div>
          )}
        </Section>
      )}

      {isAdmin && c.raw_payload && (
        <Section icon={CheckCircle2} title="Raw AgentLink payload (admin)">
          <pre className="text-[10px] bg-muted/30 rounded p-3 overflow-x-auto max-h-64">
{JSON.stringify(c.raw_payload, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  );
}
