/**
 * Client Pipeline — the real Agent Pipeline.
 *
 * Where the existing /agent-pipeline page handles recruiting/applicants,
 * THIS page handles client/policy servicing: every client an agent sold,
 * is selling, or needs to follow up with. Sourced from agentlink_clients
 * (the AgentLink mirror) joined with deals for policy status.
 *
 * RLS does the visibility:
 *   admin   → every client in the agency
 *   manager → every client owned by their downline agents
 *   agent   → only their own clients
 *
 * No role logic needed in JSX — the supabase select returns what the
 * viewer is allowed to see.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Search,
  Phone,
  Mail,
  CalendarClock,
  DollarSign,
  Flame,
  ShieldCheck,
  AlertTriangle,
  ChevronRight,
  X,
  TrendingUp,
  Banknote,
  HeartPulse,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";

type AnyRow = Record<string, unknown>;

const STAGES = [
  { key: "ALL", label: "All", color: "bg-slate-500" },
  { key: "NEW_INITIAL", label: "New", color: "bg-blue-500" },
  { key: "WORKING", label: "Working", color: "bg-purple-500" },
  { key: "PITCHED", label: "Pitched", color: "bg-amber-500" },
  { key: "SOLD", label: "Sold", color: "bg-emerald-500" },
  { key: "FOLLOW_UP", label: "Follow Up", color: "bg-rose-500" },
  { key: "INACTIVE", label: "Inactive", color: "bg-slate-400" },
];

function fmtMoney(n: unknown): string {
  const v = Number(n ?? 0);
  if (!v) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtDate(s: unknown): string {
  if (!s || typeof s !== "string") return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
function fmtAge(s: unknown): string {
  if (!s || typeof s !== "string") return "—";
  const ms = Date.now() - new Date(s).getTime();
  if (!Number.isFinite(ms)) return "—";
  const days = Math.round(ms / 86_400_000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}
function matches(haystack: unknown, q: string): boolean {
  return !q || String(haystack ?? "").toLowerCase().includes(q.toLowerCase());
}
function stageColor(stage: string | null | undefined): string {
  const s = STAGES.find((x) => x.key === stage);
  return s?.color ?? "bg-muted";
}

// ─── Detail Drawer ────────────────────────────────────────────────────────
function ClientDetailDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["client-detail", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("agentlink_clients" as any)
        .select("*")
        .eq("insuracloud_pipeline_client_id", id)
        .maybeSingle();
      return data as AnyRow | null;
    },
  });
  if (isLoading) {
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur"><PageLoadingSkeleton /></div>;
  }
  if (!data) return null;

  const Section = ({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) => (
    <div className="bg-card/40 rounded-lg border border-border/40 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">{children}</div>
    </div>
  );
  const Row = ({ label, value }: { label: string; value: unknown }) => {
    if (value === null || value === undefined || value === "" || value === false) return null;
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="font-mono text-xs sm:text-sm break-all">{String(value)}</div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full bg-background border-l shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Client #{id}</div>
            <h2 className="text-xl font-bold">{String(data.first_name ?? "")} {String(data.last_name ?? "")}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={`${stageColor(String(data.pipeline_stage))} text-white border-0`}>{String(data.pipeline_stage ?? "—")}</Badge>
              {data.do_not_call && <Badge variant="destructive" className="text-[10px]">DO NOT CALL</Badge>}
              {data.do_not_email && <Badge variant="destructive" className="text-[10px]">DO NOT EMAIL</Badge>}
              {data.do_not_text && <Badge variant="destructive" className="text-[10px]">DO NOT TEXT</Badge>}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="p-4 space-y-4">
          <Section icon={Phone} title="Contact">
            <Row label="Phone" value={data.phone} />
            <Row label="Phone Type" value={data.phone_type} />
            <Row label="Email" value={data.email} />
            <Row label="Preferred Contact" value={data.preferred_contact_method} />
            <Row label="Best Time to Call" value={data.best_time_to_call} />
            <Row label="Timezone" value={data.client_timezone} />
            <Row label="Address" value={data.street_address} />
            <Row label="City/State/Zip" value={`${data.city ?? ""} ${data.state ?? ""} ${data.zip_code ?? ""}`.trim() || null} />
          </Section>

          <Section icon={HeartPulse} title="Health & Personal">
            <Row label="DOB" value={fmtDate(data.date_of_birth)} />
            <Row label="SSN last 4" value={data.ssn_last4 ? `***-**-${data.ssn_last4}` : null} />
            <Row label="Born In" value={data.born_location} />
            <Row label="Smoker" value={data.is_smoker ? "Yes" : null} />
            <Row label="Height" value={data.height} />
            <Row label="Weight" value={data.weight} />
            <Row label="Medical Notes" value={data.medical_notes} />
            <Row label="Physician" value={data.physician_name} />
            <Row label="Physician Phone" value={data.physician_phone} />
            <Row label="Physician Address" value={data.physician_address} />
            <Row label="Occupation" value={data.employer_occupation} />
            <Row label="Employment Status" value={data.employment_status} />
          </Section>

          {(data.bank_name || data.bank_account_number) && isAdmin && (
            <Section icon={Banknote} title="Banking (admin only)">
              <Row label="Bank Name" value={data.bank_name} />
              <Row label="Account Type" value={data.bank_account_type} />
              <Row label="Account Number" value={data.bank_account_number} />
              <Row label="Routing Number" value={data.bank_routing_number} />
            </Section>
          )}

          <Section icon={TrendingUp} title="Financial Profile">
            <Row label="Total Monthly Income" value={fmtMoney(data.total_monthly_income)} />
            <Row label="Total Monthly Expenses" value={fmtMoney(data.total_monthly_expenses)} />
            <Row label="Monthly Surplus" value={fmtMoney(data.monthly_surplus)} />
            <Row label="Earned Income" value={fmtMoney(data.earned_income)} />
            <Row label="Pension Income" value={fmtMoney(data.pension_income)} />
            <Row label="Social Security" value={fmtMoney(data.social_security_income)} />
            <Row label="Qualified Accounts" value={fmtMoney(data.qualified_accounts)} />
            <Row label="Non-Qualified Accounts" value={fmtMoney(data.non_qualified_accounts)} />
            <Row label="Total Investable" value={fmtMoney(data.total_investable)} />
            <Row label="Retirement Age Goal" value={data.retirement_age_goal} />
            <Row label="Legacy Estate" value={fmtMoney(data.legacy_estate)} />
          </Section>

          <Section icon={ShieldCheck} title="Policy & Pitch">
            <Row label="Pitch Carrier" value={data.pitch_carrier} />
            <Row label="Pitch Price" value={fmtMoney(data.pitch_price)} />
            <Row label="Product Sold" value={data.product_sold} />
            <Row label="Policy Number" value={data.policy_number} />
            <Row label="Face Amount" value={fmtMoney(data.face_amount)} />
            <Row label="Policy Start" value={fmtDate(data.policy_start_date)} />
            <Row label="Policy Review" value={fmtDate(data.policy_review_date)} />
          </Section>

          {(data.beneficiary_first_name || data.beneficiary_count) && (
            <Section icon={Users} title="Beneficiary">
              <Row label="First Name" value={data.beneficiary_first_name} />
              <Row label="Last Name" value={data.beneficiary_last_name} />
              <Row label="Phone" value={data.beneficiary_number} />
              <Row label="Total Beneficiaries" value={data.beneficiary_count} />
            </Section>
          )}

          <Section icon={CalendarClock} title="Activity & Engagement">
            <Row label="Stage Changed" value={fmtAge(data.stage_changed_at)} />
            <Row label="Last Contact" value={fmtAge(data.last_contact_date)} />
            <Row label="Next Action" value={fmtDate(data.next_action_date)} />
            <Row label="Next Action Notes" value={data.next_action_notes} />
            <Row label="Callback Date" value={fmtDate(data.callback_date)} />
            <Row label="Callback Time" value={data.callback_time} />
            <Row label="Client Health Score" value={data.client_health_score} />
            <Row label="Objectives" value={data.objectives} />
            <Row label="Communication Notes" value={data.communication_notes} />
            <Row label="Reminder Notes" value={data.reminder_notes} />
            <Row label="Lead Source" value={data.lead_vendor_name} />
            <Row label="Lead Product" value={data.lead_product_name} />
            <Row label="Imported" value={fmtAge(data.imported_at)} />
            <Row label="Hostile Language Flag" value={data.hostile_language_detected ? "⚠ Yes" : null} />
          </Section>
        </div>
      </div>
    </div>
  );
}

// ─── Stat row ─────────────────────────────────────────────────────────────
function StatRow({ rows }: { rows: AnyRow[] }) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach((r) => {
      const k = String(r.pipeline_stage ?? "—");
      c[k] = (c[k] ?? 0) + 1;
    });
    return c;
  }, [rows]);
  const followUps = rows.filter((r) => r.callback_date || (r.next_action_date && new Date(String(r.next_action_date)) <= new Date())).length;
  const sold = rows.filter((r) => r.policy_number).length;
  const sumAlp = rows.reduce((s, r) => s + Number(r.face_amount ?? 0), 0);

  const items = [
    { label: "Total clients", value: rows.length.toLocaleString(), icon: Users, gradient: "from-blue-500/20 to-cyan-500/10" },
    { label: "Sold", value: sold.toLocaleString(), icon: ShieldCheck, gradient: "from-emerald-500/20 to-teal-500/10" },
    { label: "Follow-ups due", value: followUps.toLocaleString(), icon: AlertTriangle, gradient: "from-amber-500/20 to-orange-500/10" },
    { label: "Total face amount", value: fmtMoney(sumAlp), icon: DollarSign, gradient: "from-purple-500/20 to-fuchsia-500/10" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((it) => (
        <Card key={it.label} className={`bg-gradient-to-br ${it.gradient} border-border/40`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><it.icon className="h-3.5 w-3.5" />{it.label}</div>
            <div className="text-2xl font-bold mt-1">{it.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────
export default function ClientPipeline() {
  usePageTitle("Agent Pipeline · APEX");
  const { user, isLoading: authLoading } = useAuth();
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<string>("ALL");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["client-pipeline", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // RLS does the role scoping server-side — we just SELECT
      const { data } = await supabase
        .from("agentlink_clients" as any)
        .select("insuracloud_pipeline_client_id, first_name, last_name, phone, email, date_of_birth, pipeline_stage, last_contact_date, next_action_date, callback_date, policy_number, product_sold, face_amount, pitch_carrier, pitch_price, lead_vendor_name, stage_changed_at, client_health_score, do_not_call, do_not_email, do_not_text, agent_id")
        .order("stage_changed_at", { ascending: false, nullsFirst: false })
        .limit(5000);
      return (data as AnyRow[] | null) ?? [];
    },
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    return (data ?? []).filter((r) => {
      if (stage !== "ALL" && r.pipeline_stage !== stage) return false;
      return matches(r.first_name, q) || matches(r.last_name, q) || matches(r.phone, q) || matches(r.email, q) || matches(r.policy_number, q);
    });
  }, [data, q, stage]);

  if (authLoading || isLoading) return <PageLoadingSkeleton />;
  if (!user) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card><CardContent className="p-8 text-center text-sm">Sign in to view your pipeline.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Flame className="h-5 w-5" />
            <span className="text-xs uppercase tracking-wider">Pipeline · Clients & policies</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold">Agent Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Every client you sold, are selling, or need to follow up with. Synced from AgentLink every minute.
          </p>
        </div>
      </div>

      <StatRow rows={data ?? []} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by name, phone, email, policy #…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {STAGES.map((s) => (
            <Button
              key={s.key}
              size="sm"
              variant={stage === s.key ? "default" : "outline"}
              className={stage === s.key ? "" : "hover:bg-muted"}
              onClick={() => setStage(s.key)}
            >
              <span className={`mr-1.5 h-2 w-2 rounded-full ${s.color}`} />
              {s.label}
            </Button>
          ))}
        </div>
        <Badge variant="outline" className="ml-auto">{filtered.length} of {data?.length ?? 0}</Badge>
      </div>

      <div className="border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left p-3">Client</th>
                <th className="text-left p-3">Contact</th>
                <th className="text-left p-3">Stage</th>
                <th className="text-left p-3">Policy</th>
                <th className="text-right p-3">Face Amount</th>
                <th className="text-left p-3">Next Action</th>
                <th className="text-left p-3">Last Contact</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {filtered.slice(0, 500).map((r) => (
                <tr
                  key={String(r.insuracloud_pipeline_client_id)}
                  className="hover:bg-muted/30 cursor-pointer"
                  onClick={() => setSelectedId(Number(r.insuracloud_pipeline_client_id))}
                >
                  <td className="p-3">
                    <div className="font-medium">{String(r.first_name ?? "")} {String(r.last_name ?? "")}</div>
                    <div className="text-[11px] text-muted-foreground">DOB {fmtDate(r.date_of_birth)}</div>
                  </td>
                  <td className="p-3 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3 text-muted-foreground" />{String(r.phone ?? "—")}
                      {r.do_not_call && <span className="text-[9px] text-rose-500">DNC</span>}
                    </div>
                    {r.email && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        <span className="truncate max-w-[200px]">{String(r.email)}</span>
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <Badge className={`${stageColor(String(r.pipeline_stage))} text-white border-0 text-[10px]`}>
                      {String(r.pipeline_stage ?? "—")}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs">
                    <div className="font-mono">{String(r.policy_number ?? "—")}</div>
                    <div className="text-muted-foreground">{String(r.product_sold ?? r.pitch_carrier ?? "")}</div>
                  </td>
                  <td className="p-3 text-right text-xs">{fmtMoney(r.face_amount)}</td>
                  <td className="p-3 text-xs">
                    {r.callback_date ? <span className="text-amber-500">{fmtDate(r.callback_date)}</span> : fmtDate(r.next_action_date)}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{fmtAge(r.last_contact_date)}</td>
                  <td className="p-3 text-right">
                    <ChevronRight className="h-4 w-4 text-muted-foreground inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && (
          <div className="p-3 text-xs text-muted-foreground text-center border-t">
            Showing first 500 of {filtered.length}. Refine search to see more.
          </div>
        )}
        {filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No clients in this view yet. RLS shows only what you're authorized to see.
          </div>
        )}
      </div>

      {selectedId !== null && <ClientDetailDrawer id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
