// ProducerProfile · mirrors AgentLink's "Producer Profile" sidebar item
//
// Agent-facing self-edit view. Loads from `profiles` (joined on user_id)
// + `agents` (read-only stats panel). User edits name/phone/bio/city/state/
// instagram_handle/avatar_url; SAVE updates `profiles`. Agents stats are
// read-only (license_status, license_states, start_date, total_premium, etc).

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  User as UserIcon, Save, MapPin, Phone, Mail, Instagram, FileText,
  Image as ImageIcon, Calendar, Shield, TrendingUp, RefreshCw,
  GraduationCap, CheckCircle2, PlayCircle, ArrowRight, ArrowLeft,
  Network, Briefcase, Building2, AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AgentDocuments } from "@/components/profile/AgentDocuments";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ContractingReadinessCard } from "@/components/contracting/ContractingReadinessCard";
import { EmptyState } from "@/components/ui/empty-state";
import { AgentAvatar, getAvatarUrl } from "@/components/ui/AgentAvatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface ProfileForm {
  full_name: string;
  phone: string;
  avatar_url: string;
  bio: string;
  city: string;
  state: string;
  instagram_handle: string;
}

interface AgentStat {
  id: string;
  agent_code: string | null;
  license_status: string | null;
  license_states: string[] | null;
  start_date: string | null;
  total_policies: number | null;
  total_premium: number | null;
  total_earnings: number | null;
  performance_tier: string | null;
  attendance_status: string | null;
  has_training_course: boolean | null;
  onboarding_stage: string | null;
}

interface CourseModule {
  id: string;
  title: string;
  order_index: number;
}

interface CourseModuleProgress {
  module_id: string;
  passed: boolean | null;
  completed_at: string | null;
  video_watched_percent: number | null;
  score: number | null;
}

interface CourseAccessSnapshot {
  hasAccess: boolean;
  licensedAt: string | null;
  modules: CourseModule[];
  progressByModule: Map<string, CourseModuleProgress>;
  completedCount: number;
  totalCount: number;
  percentComplete: number;
  lastActivity: string | null;
}

function fmtUsd(n: number | null): string {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

/* ────────────────────────────────────────────────────────────────────────────
   ANY-AGENT PRODUCER PROFILE  ·  /dashboard/profile?agentId=<uuid>
   ────────────────────────────────────────────────────────────────────────────
   Without the param this page is what it has always been: the signed-in agent's
   own editable record. With it, it renders the canonical read-only producer
   record for ANY agent on the roster, straight out of producer_profile_detail().

   That is the second half of "fix profiles and crm to have all agents" — before
   this, an agent name on the CRM had nowhere to go, so 180 of 181 producers had
   no profile a leader could open. Read-only by design: this view must never
   become a second write path onto someone else's record.
──────────────────────────────────────────────────────────────────────────── */

interface ProducerDetail {
  agent: {
    agent_id: string; full_name: string | null; email: string | null; phone: string | null;
    avatar_url: string | null; agent_code: string | null; status: string | null;
    license_status: string | null; license_progress: string | null;
    onboarding_stage: string | null; training_stage: string | null;
    manager_id: string | null; manager_name: string | null; downline_count: number | null;
    contracts_total: number | null; contracts_active: number | null;
    mtd_alp: number | null; mtd_deals: number | null; l30_alp: number | null; l30_deals: number | null;
    lifetime_alp: number | null; lifetime_deals: number | null;
    first_posted_date: string | null; last_posted_date: string | null;
    last_contacted_at: string | null; created_at: string | null; tenure_days: number | null;
    is_deactivated: boolean | null; is_inactive: boolean | null; is_sync_only: boolean | null;
  } | null;
  upline: { agent_id: string; name: string | null; status: string | null } | null;
  monthly: Array<{ month: string; alp: number; deals: number }>;
  carriers: Array<{ carrier: string; alp: number; deals: number }>;
  downline: Array<{ agent_id: string; name: string | null; status: string | null; mtd_alp?: number | null; lifetime_alp?: number | null }>;
  contracts: Array<{ carrier?: string | null; status?: string | null; [k: string]: unknown }>;
  training: { modules_total: number | null; modules_passed: number | null; last_activity: string | null } | null;
  recent_deals: Array<{ posted_date: string | null; carrier: string | null; product: string | null; annual_premium?: number | null; status: string | null }>;
}

/** Compact USD that returns null instead of a fake "$0" when nothing is on file. */
function usdOrNull(v: number | string | null | undefined): string | null {
  const n = Number(v ?? 0) || 0;
  if (n <= 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

/** agents.performance_tier stores machine tokens ("below_10k", "top_producer").
 *  They were rendered straight onto the profile, so the badge on Sam's own page
 *  read "below_10k". Known tokens get a written label; anything new is
 *  title-cased rather than shown raw. */
const PERFORMANCE_TIER_LABEL: Record<string, string> = {
  below_10k: "Under $10K",
  top_producer: "Top Producer",
};

function performanceTierLabel(tier: string): string {
  return PERFORMANCE_TIER_LABEL[tier]
    ?? tier.replace(/[_-]+/g, " ").trim()
      .split(/\s+/)
      .map((w) => (/^\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(" ");
}

function NotOnFile({ label = "not on file" }: { label?: string }) {
  return <span className="text-xs italic text-muted-foreground">{label}</span>;
}

function StatCard({ label, value, note, tone }: { label: string; value: string | null; note?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        {value ? (
          <p className={cn("mt-1 truncate text-xl font-semibold tabular-nums", tone ?? "text-foreground")}>{value}</p>
        ) : (
          <p className="mt-1"><NotOnFile /></p>
        )}
        {note && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{note}</p>}
      </CardContent>
    </Card>
  );
}

function AgentProducerView({ agentId }: { agentId: string }) {
  const detail = useQuery({
    queryKey: ["producer-profile-detail", agentId],
    queryFn: async (): Promise<ProducerDetail | null> => {
      const { data, error } = await supabase.rpc("producer_profile_detail" as never, { p_agent_id: agentId } as never);
      if (error) throw error;
      return (data as ProducerDetail) ?? null;
    },
  });

  if (detail.isLoading) {
    return (
      <div className="page-enter space-y-5 px-4 pb-24 sm:px-6">
        <Skeleton className="h-24" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {/* stable-key-allow:skeleton-static-array */}
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  // producer_profile_detail() returns SQL NULL for an id that is not on the
  // roster — including one Sam removed via roster_exclusions. Say so plainly
  // rather than rendering an empty shell that reads like a broken page.
  if (detail.isError || !detail.data?.agent) {
    return (
      <div className="page-enter space-y-5 px-4 pb-24 sm:px-6">
        <PageHeader
          eyebrow="Account"
          eyebrowIcon={<UserIcon className="h-3 w-3" />}
          title="Producer Profile"
          subtitle="Canonical producer record."
          actions={<Button asChild variant="outline" size="sm"><Link to="/dashboard/team"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to Team</Link></Button>}
        />
        <EmptyState
          icon={<AlertTriangle className="h-7 w-7" />}
          variant="warning"
          title={detail.isError ? "That profile could not be read" : "No producer on the roster with that id"}
          description={
            detail.isError
              ? "producer_profile_detail() did not answer for this agent. Nothing is being shown in its place."
              : "The roster has no agent under this id. They may have been removed from the roster, in which case this is the correct answer."
          }
          actions={<Button asChild variant="outline" size="sm"><Link to="/dashboard/team">Back to Team</Link></Button>}
        />
      </div>
    );
  }

  const d = detail.data;
  const a = d.agent!;
  const monthly = d.monthly ?? [];
  const peakMonth = monthly.reduce((m, r) => Math.max(m, Number(r.alp) || 0), 0);
  const carriers = d.carriers ?? [];
  const downline = d.downline ?? [];
  const deals = d.recent_deals ?? [];
  const contracts = d.contracts ?? [];

  return (
    <div className="page-enter space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Agency · Producer"
        eyebrowIcon={<UserIcon className="h-3 w-3" />}
        title={a.full_name ?? "Name not on file"}
        subtitle={
          [a.agent_code, a.manager_name ? `Upline ${a.manager_name}` : null, a.tenure_days != null ? `${a.tenure_days}d on the roster` : null]
            .filter(Boolean).join(" · ") || "Canonical producer record."
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard/team"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to Team</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => detail.refetch()}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", detail.isFetching && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <AgentAvatar avatarUrl={getAvatarUrl(a.avatar_url ?? undefined)} name={a.full_name ?? "—"} size="lg" className="shrink-0 ring-2 ring-primary/30" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn(
                "text-[10px] font-bold uppercase tracking-wide",
                a.status === "active" ? "border-success/30 bg-success/15 text-success"
                  : a.status === "terminated" ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground",
              )}>{a.status ?? "status unknown"}</Badge>
              <Badge variant="outline" className={cn(
                "text-[10px] font-bold uppercase tracking-wide",
                a.license_status === "licensed" ? "border-success/30 bg-success/15 text-success" : "bg-muted text-muted-foreground",
              )}>{a.license_status ?? "license unknown"}</Badge>
              {a.training_stage && <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wide">{a.training_stage}</Badge>}
              {a.is_sync_only && <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wide">sync only</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{a.email ?? <NotOnFile label="no email" />}</span>
              <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{a.phone ?? <NotOnFile label="no phone" />}</span>
              <span className="inline-flex items-center gap-1"><Network className="h-3 w-3" />{a.manager_name ?? <NotOnFile label="no upline" />}</span>
              <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{a.last_contacted_at ? `contacted ${new Date(a.last_contacted_at).toLocaleDateString()}` : <NotOnFile label="never contacted" />}</span>
            </div>
          </div>
          {a.email && (
            <Button asChild variant="outline" size="sm"><a href={`mailto:${a.email}`}><Mail className="mr-1.5 h-3.5 w-3.5" /> Email</a></Button>
          )}
          {a.phone && (
            <Button asChild variant="outline" size="sm"><a href={`tel:${a.phone}`}><Phone className="mr-1.5 h-3.5 w-3.5" /> Call</a></Button>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Month to date" value={usdOrNull(a.mtd_alp)} note={`${a.mtd_deals ?? 0} deals posted`} tone="text-success" />
        <StatCard label="Last 30 days" value={usdOrNull(a.l30_alp)} note={`${a.l30_deals ?? 0} deals posted`} />
        <StatCard label="Lifetime ALP" value={usdOrNull(a.lifetime_alp)} note={`${a.lifetime_deals ?? 0} deals · ${a.first_posted_date ? `since ${a.first_posted_date}` : "never sold"}`} />
        <StatCard
          label="Downline"
          value={(a.downline_count ?? 0) > 0 ? String(a.downline_count) : null}
          note={`${a.contracts_active ?? 0} of ${a.contracts_total ?? 0} carrier contracts active`}
        />
      </div>

      <ContractingReadinessCard />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardContent className="p-5">
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-muted-foreground" /> Production by month</h3>
              <p className="mb-3 text-xs text-muted-foreground">Posted ALP per month from the production book.</p>
              {monthly.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">No production on file for this producer.</p>
              ) : (
                <div className="space-y-2">
                  {monthly.map((m) => (
                    <div key={m.month} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">{m.month}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
                        <div className="h-full rounded-full bg-primary" style={{ width: peakMonth > 0 ? `${Math.max(2, (Number(m.alp) / peakMonth) * 100)}%` : "0%" }} />
                      </div>
                      <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums">{usdOrNull(m.alp) ?? "—"}</span>
                      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">×{m.deals}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><FileText className="h-4 w-4 text-muted-foreground" /> Recent deals</h3>
              <p className="mb-3 text-xs text-muted-foreground">Newest posted business first.</p>
              {deals.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">This producer has no posted deals on file.</p>
              ) : (
                <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
                  <Table className="min-w-[560px]">
                    <TableHeader>
                      <TableRow className="border-b border-border hover:bg-transparent [&_th]:h-9 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                        <TableHead className="px-2">Posted</TableHead>
                        <TableHead className="px-2">Carrier</TableHead>
                        <TableHead className="px-2">Product</TableHead>
                        <TableHead className="px-2">Status</TableHead>
                        <TableHead className="px-2 text-right">Premium</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deals.slice(0, 25).map((dl, i) => (
                        <TableRow key={`${dl.posted_date ?? "nodate"}-${dl.carrier ?? "nocarrier"}-${dl.product ?? "noproduct"}-${i}`} className="border-b border-border/60">
                          <TableCell className="px-2 py-2 text-xs tabular-nums">{dl.posted_date ?? "—"}</TableCell>
                          <TableCell className="px-2 py-2 text-xs">{dl.carrier ?? "—"}</TableCell>
                          <TableCell className="max-w-[220px] truncate px-2 py-2 text-xs">{dl.product ?? "—"}</TableCell>
                          <TableCell className="px-2 py-2"><Badge variant="outline" className="text-[10px] uppercase tracking-wide">{dl.status ?? "unknown"}</Badge></TableCell>
                          <TableCell className="px-2 py-2 text-right text-xs font-semibold tabular-nums">{usdOrNull(dl.annual_premium) ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardContent className="p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Building2 className="h-4 w-4 text-muted-foreground" /> Carrier mix</h3>
              {carriers.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">No carrier production on file.</p>
              ) : (
                <div className="space-y-2">
                  {carriers.map((c) => (
                    <div key={c.carrier} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">{c.carrier}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">×{c.deals}</span>
                      <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{usdOrNull(c.alp) ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Network className="h-4 w-4 text-muted-foreground" /> Hierarchy</h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Upline</span>
                  {d.upline?.agent_id ? (
                    <Link to={`/dashboard/profile?agentId=${d.upline.agent_id}`} className="truncate font-medium underline-offset-2 decoration-dotted hover:text-primary hover:underline">
                      {d.upline.name ?? "—"}
                    </Link>
                  ) : <NotOnFile label="no upline" />}
                </div>
                <div className="border-t border-border/40 pt-2">
                  <p className="mb-1.5 text-muted-foreground">Downline ({downline.length})</p>
                  {downline.length === 0 ? (
                    <NotOnFile label="no agents beneath this producer" />
                  ) : (
                    <div className="space-y-1">
                      {downline.slice(0, 12).map((dn) => (
                        <Link key={dn.agent_id} to={`/dashboard/profile?agentId=${dn.agent_id}`}
                          className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted/40">
                          <span className="min-w-0 truncate">{dn.name ?? "—"}</span>
                          <Badge variant="outline" className="shrink-0 text-[10px] uppercase">{dn.status ?? "—"}</Badge>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Briefcase className="h-4 w-4 text-muted-foreground" /> Contracting &amp; training</h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Carrier contracts</span>
                  <span className="tabular-nums">{a.contracts_active ?? 0} active / {a.contracts_total ?? 0} total</span>
                </div>
                {contracts.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {contracts.slice(0, 12).map((c, i) => (
                      <Badge key={`${String(c.carrier ?? "carrier")}-${i}`} variant="outline" className="text-[10px]">
                        {String(c.carrier ?? "—")}{c.status ? ` · ${String(c.status)}` : ""}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border/40 pt-2">
                  <span className="text-muted-foreground">Course modules</span>
                  <span className="tabular-nums">{d.training?.modules_passed ?? 0} / {d.training?.modules_total ?? 0} passed</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last training activity</span>
                  {d.training?.last_activity
                    ? <span className="tabular-nums">{new Date(d.training.last_activity).toLocaleDateString()}</span>
                    : <NotOnFile />}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Onboarding stage</span>
                  {a.onboarding_stage ? <span>{a.onboarding_stage.replace(/_/g, " ")}</span> : <NotOnFile />}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function ProducerProfile() {
  usePageTitle("Producer Profile · APEX");
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const viewAgentId = searchParams.get("agentId");
  const userId = (user as any)?.id ?? null;

  const profile = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles" as any)
        .select("id, user_id, email, full_name, phone, avatar_url, bio, city, state, instagram_handle, photo_url")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const agent = useQuery({
    queryKey: ["agent", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents" as any)
        .select("id, agent_code, license_status, license_states, start_date, total_policies, total_premium, total_earnings, performance_tier, attendance_status, has_training_course, onboarding_stage")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
      return row as unknown as AgentStat | null;
    },
  });

  // Course access · audit: applications.licensed_at NOT NULL OR agents.has_training_course=true grants access
  // Linkage: profiles.email -> applications.email (applicant identity), agents.user_id -> profiles.user_id
  const userEmail: string | null = (profile.data?.email ?? null) || ((user as any)?.email ?? null);
  const agentId: string | null = (agent.data?.id ?? null) || null;

  // Dead cached totals are intentionally ignored. This is the same unified,
  // deduped production + resolved-comp truth used by Finances and Leaderboard.
  const bookRollup = useQuery({
    queryKey: ["producer-book-rollup", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data } = await supabase.from("v_production_comp_truth" as any)
        .select("annual_premium, direct_estimate").eq("agent_id", agentId);
      const rows = (data ?? []) as unknown as Array<{ annual_premium: number | string | null; direct_estimate: number | string | null }>;
      const premium = rows.reduce((s, r) => s + Number(r.annual_premium ?? 0), 0);
      const estEarnings = rows.reduce((sum, row) => sum + Number(row.direct_estimate ?? 0), 0);
      return { premium, policies: rows.length, estEarnings: Math.round(estEarnings) };
    },
  });

  const course = useQuery<CourseAccessSnapshot>({
    queryKey: ["producer-course-access", agentId, userEmail],
    enabled: !!userId,
    queryFn: async (): Promise<CourseAccessSnapshot> => {
      // Most recent licensed_at for this email (may be null if applicant not licensed)
      let licensedAt: string | null = null;
      if (userEmail) {
        const { data: appRows, error: appErr } = await supabase
          .from("applications" as any)
          .select("licensed_at")
          .eq("email", userEmail)
          .not("licensed_at", "is", null)
          .order("licensed_at", { ascending: false })
          .limit(1);
        if (appErr) throw appErr;
        const arr = (appRows as unknown as Array<{ licensed_at: string | null }>) ?? [];
        licensedAt = arr.length > 0 ? arr[0].licensed_at : null;
      }

      const hasAccess = !!licensedAt || agent.data?.has_training_course === true;

      // Active modules (load even if no agent yet, so the panel can preview)
      const { data: moduleRows, error: modErr } = await supabase
        .from("onboarding_modules" as any)
        .select("id, title, order_index")
        .eq("is_active", true)
        .order("order_index");
      if (modErr) throw modErr;
      const modules = ((moduleRows as unknown as CourseModule[]) ?? []).map((m) => ({
        id: m.id,
        title: m.title,
        order_index: m.order_index,
      }));

      const progressByModule = new Map<string, CourseModuleProgress>();
      let lastActivity: string | null = null;
      if (agentId) {
        const { data: progRows, error: progErr } = await supabase
          .from("onboarding_progress" as any)
          .select("module_id, passed, completed_at, video_watched_percent, score")
          .eq("agent_id", agentId);
        if (progErr) throw progErr;
        const rows = (progRows as unknown as CourseModuleProgress[]) ?? [];
        rows.forEach((r) => {
          progressByModule.set(r.module_id, r);
          if (r.completed_at && (!lastActivity || r.completed_at > lastActivity)) {
            lastActivity = r.completed_at;
          }
        });
      }

      const totalCount = modules.length;
      let completedCount = 0;
      modules.forEach((m) => {
        const p = progressByModule.get(m.id);
        if (p?.passed) completedCount += 1;
      });
      const percentComplete = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

      return {
        hasAccess,
        licensedAt,
        modules,
        progressByModule,
        completedCount,
        totalCount,
        percentComplete,
        lastActivity,
      };
    },
  });

  const [form, setForm] = useState<ProfileForm>({
    full_name: "", phone: "", avatar_url: "", bio: "",
    city: "", state: "", instagram_handle: "",
  });

  useEffect(() => {
    if (profile.data) {
      setForm({
        full_name: profile.data.full_name ?? "",
        phone: profile.data.phone ?? "",
        avatar_url: profile.data.avatar_url ?? profile.data.photo_url ?? "",
        bio: profile.data.bio ?? "",
        city: profile.data.city ?? "",
        state: profile.data.state ?? "",
        instagram_handle: profile.data.instagram_handle ?? "",
      });
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not logged in");
      const { error } = await supabase
        .from("profiles" as any)
        .update({
          full_name: form.full_name.trim() || null,
          phone: form.phone.trim() || null,
          avatar_url: form.avatar_url.trim() || null,
          bio: form.bio.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() || null,
          instagram_handle: form.instagram_handle.trim() || null,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile saved");
      qc.invalidateQueries({ queryKey: ["profile", userId] });
    },
    onError: (e: any) => toast.error(e?.message || "Save failed"),
  });

  const ag = agent.data;

  // Branch placed AFTER every hook above so the hook order is identical on both
  // paths — the self-edit queries are all `enabled: !!userId` and stay cheap.
  if (viewAgentId) return <AgentProducerView agentId={viewAgentId} />;

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Account"
        eyebrowIcon={<UserIcon className="h-3 w-3" />}
        title="Producer Profile"
        subtitle="Your contact info, bio, and license stats. Save changes below."
        actions={
          <Button variant="outline" size="sm" onClick={() => { profile.refetch(); agent.refetch(); }}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${profile.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />
      <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Producer profile sections">
        <Button variant="ghost" className="rounded-none border-b-2 border-primary">Personal info</Button>
        <Button asChild variant="ghost" className="rounded-none border-b-2 border-transparent text-muted-foreground"><Link to="/dashboard/contracting/carriers">Carriers</Link></Button>
        <Button asChild variant="ghost" className="rounded-none border-b-2 border-transparent text-muted-foreground"><Link to="/dashboard/contracting/contracts">Contracts</Link></Button>
        <Button asChild variant="ghost" className="rounded-none border-b-2 border-transparent text-muted-foreground"><Link to="/dashboard/settings/security">Background</Link></Button>
        <Button asChild variant="ghost" className="rounded-none border-b-2 border-transparent text-muted-foreground"><Link to="/dashboard/contracting/documents">Documents</Link></Button>
      </nav>

      <ContractingReadinessCard />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[{ label: "License", value: ag?.license_status ?? "—", note: ag?.agent_code ?? "No agent code" }, { label: "States", value: ag?.license_states?.length ?? "—", note: ag?.license_states?.length ? "licensed" : "not on file" }, { label: "Premium", value: fmtUsd(bookRollup.data?.premium ?? 0), note: `${bookRollup.data?.policies ?? 0} policies written` }, { label: "Est. earnings", value: fmtUsd(bookRollup.data?.estEarnings ?? 0), note: "contract estimate" }].map((metric) => <Card key={metric.label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{metric.label}</p><p className="mt-1 truncate text-xl font-semibold tabular-nums capitalize">{metric.value}</p><p className="text-xs text-muted-foreground">{metric.note}</p></CardContent></Card>)}
      </div>

      {/* COURSE ACCESS / TRAINING · audit: every applicant with licensed_at IS NOT NULL gets course access */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                <GraduationCap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="text-13 font-bold">Prelicensing Course</h3>
                <p className="text-11 text-muted-foreground">Your training modules and progress</p>
              </div>
            </div>
            {course.data?.hasAccess ? (
              <Badge variant="outline" className="text-11 bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Access granted
              </Badge>
            ) : (
              <Badge variant="outline" className="text-11">No access yet</Badge>
            )}
          </div>

          {course.isLoading ? (
            <div className="space-y-2">
              {/* stable-key-allow:skeleton-static-array */}
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : course.isError ? (
            <p className="text-12 text-red-500">
              Failed to load course state: {(course.error as Error)?.message ?? "—"}
            </p>
          ) : course.data && course.data.hasAccess ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-12">
                <div>
                  <p className="text-11 text-muted-foreground">Modules complete</p>
                  <p className="text-18 font-bold tabular-nums">{course.data.completedCount}/{course.data.totalCount}</p>
                </div>
                <div>
                  <p className="text-11 text-muted-foreground">Progress</p>
                  <p className="text-18 font-bold tabular-nums">{course.data.percentComplete}%</p>
                </div>
                <div>
                  <p className="text-11 text-muted-foreground">Licensed</p>
                  <p className="text-12 font-medium">
                    {course.data.licensedAt
                      ? new Date(course.data.licensedAt).toLocaleDateString()
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-11 text-muted-foreground">Last activity</p>
                  <p className="text-12 font-medium">
                    {course.data.lastActivity
                      ? new Date(course.data.lastActivity).toLocaleDateString()
                      : "—"}
                  </p>
                </div>
              </div>

              <Progress value={course.data.percentComplete} className="h-2" />

              {course.data.modules.length > 0 && (
                <div className="space-y-1.5">
                  {course.data.modules.map((m) => {
                    const p = course.data!.progressByModule.get(m.id);
                    const passed = p?.passed === true;
                    const watched = p?.video_watched_percent ?? 0;
                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {passed ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          ) : watched > 0 ? (
                            <PlayCircle className="h-4 w-4 text-info shrink-0" />
                          ) : (
                            <PlayCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-12 truncate">{m.title}</span>
                        </div>
                        <span className="text-11 tabular-nums text-muted-foreground shrink-0">
                          {passed ? `Passed${p?.score != null ? ` · ${p.score}%` : ""}` : watched > 0 ? `${watched}% watched` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end">
                <Button asChild size="sm">
                  <Link to="/onboarding-course">
                    {course.data.percentComplete >= 100 ? "Review course" : "Resume course"}
                    <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-12 text-muted-foreground">
              Course unlocks once your application is marked licensed or your manager grants access. Talk to your upline if you believe this is wrong.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* EDITABLE PROFILE */}
        <div className="lg:col-span-2 space-y-3">
          <Card>
            <CardContent className="p-5 space-y-4">
              {profile.isLoading ? (
                <div className="space-y-3">
                  {/* stable-key-allow:skeleton-static-array */}
                  {Array.from({length:5}).map((_,i) => <Skeleton key={i} className="h-9" />)}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4">
                    {form.avatar_url ? (
                      <img src={form.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-amber-500/40" />
                    ) : (
                      <div className="h-16 w-16 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-18 font-bold flex items-center justify-center">
                        {(form.full_name || profile.data?.email || "?").slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 space-y-2">
                      <div>
                        <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><UserIcon className="h-3 w-3" /> Full Name</label>
                        <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Your full name" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><ImageIcon className="h-3 w-3" /> Avatar URL</label>
                    <Input value={form.avatar_url} onChange={(e) => setForm({ ...form, avatar_url: e.target.value })} placeholder="https://…" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><Phone className="h-3 w-3" /> Phone</label>
                      <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 555 5555" />
                    </div>
                    <div>
                      <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><Instagram className="h-3 w-3" /> Instagram</label>
                      <Input value={form.instagram_handle} onChange={(e) => setForm({ ...form, instagram_handle: e.target.value })} placeholder="@yourhandle" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><MapPin className="h-3 w-3" /> City</label>
                      <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" />
                    </div>
                    <div>
                      <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><MapPin className="h-3 w-3" /> State</label>
                      <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="ST" maxLength={2} />
                    </div>
                  </div>

                  <div>
                    <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><FileText className="h-3 w-3" /> Bio</label>
                    <Textarea
                      value={form.bio}
                      onChange={(e) => setForm({ ...form, bio: e.target.value })}
                      placeholder="A short bio agents/clients see on your profile…"
                      rows={4}
                    />
                  </div>

                  <div>
                    <label className="text-11 text-muted-foreground flex items-center gap-1.5 mb-1"><Mail className="h-3 w-3" /> Email (read-only)</label>
                    <Input value={profile.data?.email ?? ""} disabled className="opacity-70" />
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button onClick={() => save.mutate()} disabled={save.isPending}>
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      {save.isPending ? "Saving…" : "Save Changes"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* READ-ONLY AGENT STATS */}
        <div className="space-y-3">
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="text-13 font-bold flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-emerald-500" /> Production</h3>
              {agent.isLoading ? (
                // stable-key-allow:skeleton-static-array
                <div className="space-y-2">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-6" />)}</div>
              ) : ag ? (
                <div className="space-y-2 text-12">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Agent Code</span>
                    <span className="tabular-nums">{ag.agent_code ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">License Status</span>
                    <Badge variant="outline" className="text-11">{ag.license_status ?? "—"}</Badge>
                  </div>
                  {(ag.license_states ?? []).length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Licensed States</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ag.license_states!.map((s) => (
                          <Badge key={s} variant="outline" className="text-11 bg-emerald-500/10 border-emerald-500/30">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Start Date</span>
                    <span>{ag.start_date ?? "—"}</span>
                  </div>
                  <div className="border-t border-border/40 pt-2 mt-2 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Policies</span>
                      <span className="tabular-nums font-bold">{bookRollup.data?.policies ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Premium</span>
                      <span className="tabular-nums font-bold text-emerald-600 dark:text-emerald-400">{fmtUsd(bookRollup.data?.premium ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Earnings</span>
                      <span className="tabular-nums font-bold text-emerald-600 dark:text-emerald-400">{fmtUsd(bookRollup.data?.estEarnings ?? 0)}</span>
                    </div>
                  </div>
                  {ag.performance_tier && (
                    <div className="flex justify-between pt-1">
                      <span className="text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Tier</span>
                      <Badge variant="outline" className="text-11 bg-primary/10 border-primary/30 text-primary">
                        {performanceTierLabel(ag.performance_tier)}
                      </Badge>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-12 text-muted-foreground">Production stats unlock once your manager links your AgentLink record. Ping your upline to wire it up.</p>
              )}
            </CardContent>
          </Card>

          {/* An agent's own paperwork — license, E&O, voided check, ID,
              contracting forms. Private bucket, per-agent RLS: only the agent
              and their upline can read it. */}
          <AgentDocuments agentId={ag?.id ?? null} />
        </div>
      </div>
    </div>
  );
}
