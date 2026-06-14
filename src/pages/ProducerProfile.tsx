// ProducerProfile · mirrors AgentLink's "Producer Profile" sidebar item
//
// Agent-facing self-edit view. Loads from `profiles` (joined on user_id)
// + `agents` (read-only stats panel). User edits name/phone/bio/city/state/
// instagram_handle/avatar_url; SAVE updates `profiles`. Agents stats are
// read-only (license_status, license_states, start_date, total_premium, etc).

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  User as UserIcon, Save, MapPin, Phone, Mail, Instagram, FileText,
  Image as ImageIcon, Calendar, Shield, TrendingUp, RefreshCw,
  GraduationCap, CheckCircle2, PlayCircle, ArrowRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
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

export default function ProducerProfile() {
  usePageTitle("Producer Profile · APEX");
  const { user } = useAuth();
  const qc = useQueryClient();
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

      {/* PREMIUM GRADIENT HERO · v6 §31 · amber */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">PRODUCER · LIVE</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">LICENSE</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{ag?.license_status ?? "—"}</p>
              <p className="text-[10px] text-white/40 tabular-nums">{ag?.agent_code ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">STATES</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{(ag?.license_states ?? []).length}</p>
              <p className="text-[10px] text-white/40 tabular-nums">licensed</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">PREMIUM</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{fmtUsd(ag?.total_premium ?? 0)}</p>
              <p className="text-[10px] text-white/40 tabular-nums">total written</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">EARNINGS</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{fmtUsd(ag?.total_earnings ?? 0)}</p>
              <p className="text-[10px] text-white/40 tabular-nums">lifetime</p>
            </div>
          </div>
        </div>
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
                            <PlayCircle className="h-4 w-4 text-blue-500 shrink-0" />
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
                      <span className="tabular-nums font-bold">{ag.total_policies ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Premium</span>
                      <span className="tabular-nums font-bold text-emerald-600 dark:text-emerald-400">{fmtUsd(ag.total_premium)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Earnings</span>
                      <span className="tabular-nums font-bold text-emerald-600 dark:text-emerald-400">{fmtUsd(ag.total_earnings)}</span>
                    </div>
                  </div>
                  {ag.performance_tier && (
                    <div className="flex justify-between pt-1">
                      <span className="text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Tier</span>
                      <Badge variant="outline" className="text-11 bg-amber-500/10 border-amber-500/30">{ag.performance_tier}</Badge>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-12 text-muted-foreground">Production stats unlock once your manager links your AgentLink record. Ping your upline to wire it up.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
