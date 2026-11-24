import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileText,
  GraduationCap,
  Headphones,
  Library,
  ListChecks,
  MessageCircleQuestion,
  Mic,
  Play,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  Star,
  Users,
  Video,
  X,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { TrainingWorkspaceNav } from "@/components/training/TrainingWorkspaceNav";
import { TrainingPathPanel } from "@/components/training/TrainingPathPanel";
import { TrainingLeaderPanel } from "@/components/training/TrainingLeaderPanel";
import { RequiredOnboardingResources } from "@/components/training/RequiredOnboardingResources";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TRAINING_ROUTES } from "@/lib/trainingRoutes";
import {
  HUB_ORIGIN,
  HubResource,
  hubCourseCounts,
  hubCourseItems,
  useHubData,
} from "@/lib/apexResourcesHub";
import { TopCallsTab } from "@/components/training/TopCallsTab";
import { ObjectionsTab } from "@/components/training/ObjectionsTab";
import { TrainingRecordings } from "@/components/training/TrainingRecordings";

/**
 * TrainingHub — the apex-resources.vercel.app agent hub, rebuilt inside the
 * authenticated app. Live content (courses / recordings / library / quick
 * links) straight from the apex-resources API; course progress lives in
 * hub_course_progress instead of the legacy site's localStorage-by-typed-email.
 */

type HubTab = "path" | "calls" | "objections" | "recordings" | "library" | "team";

const LIBRARY_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pdf", label: "PDFs" },
  { key: "guide", label: "Guides" },
  { key: "video", label: "Videos" },
  { key: "training", label: "Trainings" },
];

// Category tone mapped onto the brand's semantic tokens so the chips read on the
// black+gold palette instead of arbitrary raw Tailwind hues.
const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  pdf: { label: "PDF", className: "bg-info/15 text-info border-info/30" },
  guide: { label: "Guide", className: "bg-success/15 text-success border-success/30" },
  video: { label: "Video", className: "bg-destructive/15 text-destructive border-destructive/30" },
  training: { label: "Training", className: "bg-warning/15 text-warning border-warning/30" },
  course: { label: "Course", className: "bg-primary/15 text-primary border-primary/30" },
};

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function parseHubDate(d: string): number {
  const t = Date.parse(d);
  return Number.isNaN(t) ? 0 : t;
}

/* Small KPI stat tile — value over label, matching the AC control-room look. */
function StatTile({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className={cn("text-2xl font-bold tabular-nums", tone)}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/* Loading + failure states for the three tabs that depend on the EXTERNAL
   content library. Kept separate from the Supabase-backed tabs so one
   origin's outage can never be mistaken for the other's emptiness. */
function HubSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {["a", "b", "c"].map((k) => (
        <Skeleton key={k} className="h-48 rounded-md" />
      ))}
    </div>
  );
}

function HubUnreachable({
  refetch,
  isRefetching,
}: {
  refetch: () => void;
  isRefetching: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-8 pt-8 text-center">
        <p className="mb-1 text-lg font-bold">Couldn't reach the content library</p>
        <p className="mb-4 text-sm text-muted-foreground">
          The live library didn't respond, so nothing here is confirmed empty — it's unread.
          Retry, or open the library directly.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => refetch()} disabled={isRefetching} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
            Retry
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <a href={HUB_ORIGIN} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open the library
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TrainingHub() {
  usePageTitle("Training Hub · Galaxy Financial");
  const { user, isAdmin, isManager, isVaManager, isVa } = useAuth();
  const { data, isLoading, isError, refetch, isRefetching } = useHubData();

  const [searchParams, setSearchParams] = useSearchParams();
  // Mirror the SERVER's gate exactly. Read from pg_get_functiondef, both
  // apex_training_rollup and apex_training_needs_nudge grant
  // has_role(admin) OR has_role(va_manager) OR has_role(manager) — va_manager
  // is folded into the admin branch, so it even gets agency-wide scope. A
  // client gate of (isAdmin || isManager) hid the tab from the 2 accounts
  // holding va_manager while the RPC would have answered them in full.
  // If the gate here is ever narrower than the function's, the UI silently
  // withholds data the caller is entitled to; if it is wider, the panel
  // renders nothing because the RPC fails closed. Keep them identical.
  const isLeader = isAdmin || isVaManager || isManager;
  // "team" is only a legal tab for a leader. A non-leader who lands on
  // ?tab=team falls back to their own path instead of an empty pane — the RPC
  // behind that view fails closed server-side, so this is only the UI half.
  // "courses" was its own tab; courses now sit under My training, so old links land there.
  const rawTab = searchParams.get("tab") || "";
  const requestedTab = rawTab === "courses" ? "path" : rawTab;
  const legalTabs = ["path", "calls", "objections", "recordings", "library", ...(isLeader ? ["team"] : [])];
  const tab = (legalTabs.includes(requestedTab) ? requestedTab : "path") as HubTab;
  const setTab = (next: string) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", next);
      return p;
    }, { replace: true });
  };

  // One query for all of this user's hub course progress — powers the
  // per-course completion bars on the Courses tab. RLS scopes to auth.uid().
  const { data: progressRows } = useQuery({
    queryKey: ["hub-course-progress", user?.id],
    queryFn: async () => {
      // Scope to this user explicitly. RLS alone is NOT enough here: the
      // hub_progress_select_admin policy is OR'ed with select_own, so an
      // unfiltered select would hand an admin every agent's rows and compute
      // Sam's own progress from other people's completions.
      const { data: rows, error } = await supabase
        .from("hub_course_progress")
        .select("course_id, item_id, kind, passed")
        .eq("user_id", user!.id);
      if (error) throw error;
      return rows ?? [];
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  // WP6: a licensed agent's "start training" lands on the REQUIRED course
  // (TRAINING_ROUTES.fieldCourse, where onboarding_progress lives). The course
  // email used to send them to the library instead, and the library hero had
  // no way through to the required modules. Unlicensed agents are not sent to
  // the sales course (MP-357: wrong material before the licence).
  const { data: isLicensedAgent = false } = useQuery({
    queryKey: ["training-hub-licensed", user?.id],
    enabled: !!user?.id && !isLeader,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const client = supabase as unknown as {
        rpc: (fn: string) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
      const { data: rows, error } = await client.rpc("my_activation_state");
      if (error) return false;
      const row = (Array.isArray(rows) ? rows[0] : rows) as { license_status?: string | null } | undefined;
      return row?.license_status === "licensed";
    },
  });

  const courses = useMemo(
    () => (data?.resources ?? []).filter((r) => r.type === "course" && r.course),
    [data],
  );
  const libraryItems = useMemo(
    () => (data?.resources ?? []).filter((r) => r.type !== "course"),
    [data],
  );

  const courseCompletion = useMemo(() => {
    const byCourse: Record<string, number> = {};
    for (const c of courses) {
      const items = hubCourseItems(c.course!);
      if (items.length === 0) continue;
      const doneIds = new Set(
        (progressRows ?? [])
          .filter((p) => p.course_id === c.id && (p.kind === "lesson" || p.passed))
          .map((p) => p.item_id),
      );
      const done = items.filter((it) => doneIds.has(it.id)).length;
      byCourse[c.id] = Math.round((done / items.length) * 100);
    }
    return byCourse;
  }, [courses, progressRows]);

  const completedCourses = useMemo(
    () => Object.values(courseCompletion).filter((v) => v === 100).length,
    [courseCompletion],
  );

  const quickLinks = useMemo(
    () =>
      (data?.quickLinks ?? []).filter(
        (l) => !/\/admin\/?$/.test(l.href) || isAdmin || isManager,
      ),
    [data, isAdmin, isManager],
  );

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-6 px-4 pb-24 sm:px-6">
      {/* Staff run six training views; an agent has one center, so the second strip of links is noise for them. */}
      {(isLeader || isVa) && <TrainingWorkspaceNav />}
      <PageHeader
        eyebrow="Learn · Practice · Progress"
        eyebrowIcon={<Library className="h-3 w-3" />}
        title="Training center"
        subtitle="Finish the Field Course, then learn from the best calls on the team: top calls, the objections they turned, and the scripts."
        accent="primary"
        actions={
          (isAdmin || isManager) ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" className="gap-2">
                <Link to="/dashboard/call-training">
                  <Headphones className="h-4 w-4" />
                  Coach calls
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-2">
                <a href={`${HUB_ORIGIN}/admin/`} target="_blank" rel="noopener noreferrer">
                  <Settings className="h-4 w-4" />
                  Manage content
                </a>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {isLicensedAgent && (
                <Button asChild size="sm" className="gap-2">
                  <Link to={TRAINING_ROUTES.fieldCourse}>
                    <Play className="h-4 w-4" />
                    Continue Field Course
                  </Link>
                </Button>
              )}
              <Button asChild variant="outline" size="sm" className="gap-2">
                <Link to="/dashboard/call-lab">
                  <Mic className="h-4 w-4" />
                  Practice a call
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to={TRAINING_ROUTES.annuities}>Annuities</Link>
              </Button>
            </div>
          )
        }
      />

      {/* The tab shell is OUTSIDE the `data &&` guard on purpose. "Your path"
          and the leader view read Supabase, not the external content library —
          an outage at apex-resources.vercel.app must not take an agent's own
          training path off the page with it. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 w-full justify-start overflow-x-auto">
          <TabsTrigger value="path" className="gap-1.5">
            <ListChecks className="h-4 w-4" />
            My training
          </TabsTrigger>
          <TabsTrigger value="calls" className="gap-1.5">
            <Star className="h-4 w-4" />
            Top calls
          </TabsTrigger>
          <TabsTrigger value="objections" className="gap-1.5">
            <MessageCircleQuestion className="h-4 w-4" />
            Objections
          </TabsTrigger>
          <TabsTrigger value="recordings" className="gap-1.5">
            <Headphones className="h-4 w-4" />
            Recordings
          </TabsTrigger>
          <TabsTrigger value="library" className="gap-1.5">
            <BookOpen className="h-4 w-4" />
            Scripts &amp; guides
          </TabsTrigger>
          {isLeader && (
            <TabsTrigger value="team" className="gap-1.5">
              <Users className="h-4 w-4" />
              Who's stalled
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="path">
          <div className="space-y-6">
            <TrainingPathPanel />
            <RequiredOnboardingResources />
            {/* Courses read the external content library; an outage there must not take the path above with it. */}
            {isLoading ? (
              <HubSkeleton />
            ) : isError ? (
              <HubUnreachable refetch={refetch} isRefetching={isRefetching} />
            ) : courses.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Courses</h2>
                <CoursesTab courses={courses} completion={courseCompletion} />
              </section>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="calls">
          <TopCallsTab />
        </TabsContent>
        <TabsContent value="objections">
          <ObjectionsTab />
        </TabsContent>
        <TabsContent value="recordings">
          <TrainingRecordings />
        </TabsContent>
        <TabsContent value="library">
          {isLoading ? (
            <HubSkeleton />
          ) : isError ? (
            <HubUnreachable refetch={refetch} isRefetching={isRefetching} />
          ) : (
            <LibraryTab items={libraryItems} />
          )}
        </TabsContent>
        {isLeader && (
          <TabsContent value="team">
            <TrainingLeaderPanel />
          </TabsContent>
        )}
      </Tabs>

      {data && quickLinks.length > 0 && tab === "library" && (
        <section>
          <div className="mb-3 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Quick links
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickLinks.map((l) => (
              <a
                key={l.id ?? l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group"
              >
                <Card className="flex h-full cursor-pointer flex-col gap-1 p-4 hover:border-primary/40">
                  <span className="flex items-center justify-between text-sm font-semibold">
                    {l.label}
                    <ExternalLink className="h-3.5 w-3.5 text-primary" />
                  </span>
                  <span className="text-xs text-muted-foreground">{l.sub}</span>
                </Card>
              </a>
            ))}
          </div>
        </section>
      )}

      <p className="pt-4 text-center text-xs text-muted-foreground">
        Galaxy Financial · Internal agent resources · Confidential — do not distribute.
      </p>
    </div>
  );
}

/* ── Courses ────────────────────────────────────────────────────────────── */

function CoursesTab({
  courses,
  completion,
}: {
  courses: HubResource[];
  completion: Record<string, number>;
}) {
  if (courses.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 pt-8 text-center">
          <p className="text-lg font-bold">Nothing here yet — no courses published</p>
          <p className="text-sm text-muted-foreground">
            Courses added in the content library will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }
  const ordered = [...courses].sort(
    (a, b) => Number(b.featured ?? false) - Number(a.featured ?? false),
  );
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {ordered.map((c) => {
        const counts = hubCourseCounts(c.course!);
        const pct = completion[c.id] ?? 0;
        return (
          <Link key={c.id} to={`${TRAINING_ROUTES.home}/course/${c.id}`}>
            <Card className="flex h-full cursor-pointer flex-col gap-3 p-5 hover:border-primary/40">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className={TYPE_BADGE.course.className}>
                  {c.course!.level}
                </Badge>
                {c.isNew && (
                  <Badge className="border-primary bg-primary text-primary-foreground hover:bg-primary">
                    New
                  </Badge>
                )}
              </div>
              <div>
                <h3 className="text-lg font-bold leading-tight">{c.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.course!.instructor} · {c.course!.instructorRole}
                </p>
              </div>
              <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">{c.desc}</p>
              <div className="text-xs text-muted-foreground">
                {counts.lessons} lesson{counts.lessons === 1 ? "" : "s"}
                {counts.quizzes > 0 &&
                  ` · ${counts.quizzes} quiz${counts.quizzes === 1 ? "" : "zes"}`}
                {c.duration ? ` · ${c.duration}` : ""}
              </div>
              <div className="flex items-center gap-3 border-t border-border pt-3">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                  {pct === 100 ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Done
                    </span>
                  ) : (
                    `${pct}%`
                  )}
                </span>
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

/* ── Library ────────────────────────────────────────────────────────────── */

function LibraryTab({ items }: { items: HubResource[] }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const filterCounts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const f of LIBRARY_FILTERS) {
      if (f.key !== "all") c[f.key] = items.filter((r) => r.type === f.key).length;
    }
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      if (filter !== "all" && r.type !== filter) return false;
      if (!q) return true;
      const hay = `${r.title} ${r.desc} ${(r.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, filter, query]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {LIBRARY_FILTERS.filter((f) => f.key === "all" || filterCounts[f.key] > 0).map(
            (f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors",
                  filter === f.key
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}{" "}
                <span className="text-xs tabular-nums opacity-70">{filterCounts[f.key]}</span>
              </button>
            ),
          )}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search resources…"
            className="pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="p-8 pt-8 text-center">
            <p className="text-lg font-bold">Nothing here yet — no resources found</p>
            <p className="text-sm text-muted-foreground">Try a different search or filter.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((r) => {
            const badge = TYPE_BADGE[r.type] ?? TYPE_BADGE.guide;
            const card = (
              <Card className={cn("flex h-full flex-col gap-3 p-5", r.url && "cursor-pointer hover:border-primary/40")}>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className={badge.className}>
                    {badge.label}
                  </Badge>
                  <span className="flex items-center gap-2">
                    {r.isNew && (
                      <Badge className="border-primary bg-primary text-primary-foreground hover:bg-primary">
                        New
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{r.date}</span>
                  </span>
                </div>
                <h3 className="text-lg font-bold leading-tight">{r.title}</h3>
                <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">{r.desc}</p>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="text-xs text-muted-foreground">{r.meta}</span>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                    {r.type === "pdf" ? (
                      <FileText className="h-4 w-4" />
                    ) : (
                      <ScrollText className="h-4 w-4" />
                    )}
                    {r.cta ?? "Open"}
                  </span>
                </div>
              </Card>
            );
            return r.url ? (
              <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer">
                {card}
              </a>
            ) : (
              <div key={r.id}>{card}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
