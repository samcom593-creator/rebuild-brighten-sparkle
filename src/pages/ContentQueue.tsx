import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clapperboard, Pencil, Play, RotateCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * ContentQueue — Sam's phone surface for the content pipeline (MP-CONTENT-1).
 *
 * The Mac tool (~/projects/content-ops) scans Dropbox, hashes every clip and
 * mirrors its CSV queue into public.content_queue with `cops sync`. This page
 * is the only place a human touches that table: approve, send back, edit the
 * hook/caption/CTA, review compliance flags, and play the clip. RLS admits
 * admins only (apex_is_admin) and a BEFORE UPDATE trigger refuses any status
 * other than APPROVED/REWORK from here — publishing is recorded by the Mac
 * `archive` command with real post URLs, never by a tap. Edits stamp
 * edited_at so the next `cops sync --pull` carries them back to the CSV.
 */

const SLOTS: { slot: string; pillars: string[]; brand: string; job: string }[] = [
  { slot: "LIFESTYLE", pillars: ["LIFESTYLE", "CARS"], brand: "SFD", job: "reach" },
  { slot: "MINDSET", pillars: ["PERSONALITY", "LEADERSHIP"], brand: "SFD", job: "reach" },
  { slot: "FITNESS", pillars: ["FITNESS"], brand: "SFD", job: "reach" },
  { slot: "AUTHORITY", pillars: ["INSURANCE", "SALES", "SYSTEMS"], brand: "IMS", job: "authority" },
  { slot: "CTA", pillars: ["RECRUITING", "TESTIMONIAL"], brand: "SFD", job: "conversion" },
];
const DAILY_TARGET = 5;
const OPEN_STATUSES = ["INBOX", "EDITING", "NEEDS_REVIEW", "APPROVED", "READY"];
const MEDIA_BUCKET = "content-media";

interface QueueRow {
  content_id: string;
  original_filename: string | null;
  current_filename: string | null;
  media_type: string | null;
  duration_seconds: string | null;
  brand: string | null;
  pillar: string | null;
  status: string | null;
  hook: string | null;
  caption: string | null;
  cta: string | null;
  priority: string | null;
  privacy_risk: string | null;
  earnings_claim_risk: string | null;
  approved_by: string | null;
  notes: string | null;
  thumbnail_url: string | null;
  media_path: string | null;
  updated_at: string;
}

type Patch = Partial<Pick<QueueRow, "status" | "hook" | "caption" | "cta" | "approved_by" | "privacy_risk" | "earnings_claim_risk">>;

const contentQueue = () => supabase.from("content_queue");

function phoenixDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Phoenix" });
}

function isFlagged(r: QueueRow): boolean {
  return (r.privacy_risk ?? "").startsWith("FLAG:") || (r.earnings_claim_risk ?? "").startsWith("FLAG:");
}

function statusTone(s: string | null): "default" | "secondary" | "outline" | "destructive" {
  if (s === "APPROVED" || s === "READY") return "default";
  if (s === "REWORK") return "destructive";
  if (s === "NEEDS_REVIEW") return "secondary";
  return "outline";
}

export default function ContentQueue() {
  usePageTitle("Content");
  const { user } = useAuth();
  const qc = useQueryClient();
  const approver = (user?.user_metadata?.display_name as string | undefined) || user?.email || "admin";
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ hook: string; caption: string; cta: string }>({ hook: "", caption: "", cta: "" });
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);

  const rowsQuery = useQuery({
    queryKey: ["content_queue"],
    queryFn: async (): Promise<QueueRow[]> => {
      const { data, error } = await contentQueue().select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as QueueRow[];
    },
    staleTime: 15_000,
  });

  const rows = rowsQuery.data ?? [];
  const today = phoenixDate(0);

  const score = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => phoenixDate(-(i + 1)));
    const counts = days.map((d) => rows.filter((r) => (r.notes ?? "").includes(`archived ${d}`)).length);
    let streak = 0;
    for (const c of counts) {
      if (c < DAILY_TARGET) break;
      streak += 1;
    }
    return { yesterday: counts[0], streak, week: counts.reduce((a, b) => a + b, 0) };
  }, [rows]);

  const slate = useMemo(
    () => SLOTS.map((s) => ({ ...s, row: rows.find((r) => (r.notes ?? "").includes(`slated ${today} ${s.slot}`)) ?? null })),
    [rows, today],
  );

  const queue = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!OPEN_STATUSES.includes(r.status ?? "")) return false;
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (!q) return true;
      return [r.content_id, r.original_filename, r.current_filename, r.hook, r.pillar, r.brand].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, search, statusFilter]);

  const patch = useMutation({
    mutationFn: async ({ id, fields }: { id: string; fields: Patch }) => {
      const { error } = await contentQueue().update(fields).eq("content_id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["content_queue"] });
      toast.success(`${v.id} saved`);
    },
    onError: (e: Error) => toast.error(e.message || "Save failed"),
  });

  const approve = (r: QueueRow) => patch.mutate({ id: r.content_id, fields: { status: "APPROVED", approved_by: approver } });
  const rework = (r: QueueRow) => patch.mutate({ id: r.content_id, fields: { status: "REWORK" } });
  const markReviewed = (r: QueueRow) => {
    const stamp = `REVIEWED by ${approver} ${today}: `;
    const fields: Patch = {};
    if ((r.privacy_risk ?? "").startsWith("FLAG:")) fields.privacy_risk = stamp + (r.privacy_risk ?? "").slice(6);
    if ((r.earnings_claim_risk ?? "").startsWith("FLAG:")) fields.earnings_claim_risk = stamp + (r.earnings_claim_risk ?? "").slice(6);
    patch.mutate({ id: r.content_id, fields });
  };
  const startEdit = (r: QueueRow) => {
    setEditing(r.content_id);
    setDraft({ hook: r.hook ?? "", caption: r.caption ?? "", cta: r.cta ?? "" });
  };
  const saveEdit = (r: QueueRow) => {
    patch.mutate({ id: r.content_id, fields: { hook: draft.hook, caption: draft.caption, cta: draft.cta } }, { onSuccess: () => setEditing(null) });
  };
  const play = async (r: QueueRow) => {
    if (!r.media_path) {
      toast.error("No playable copy uploaded yet — run `cops sync` on the Mac after autocut/prepare.");
      return;
    }
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(r.media_path, 900);
    if (error || !data?.signedUrl) {
      toast.error(error?.message || "Could not open the clip");
      return;
    }
    setPlaying({ id: r.content_id, url: data.signedUrl });
  };

  const renderControls = (r: QueueRow) => {
    const flagged = isFlagged(r);
    return (
      <div className="flex flex-wrap gap-2 pt-2">
        <Button size="sm" onClick={() => void play(r)} variant="secondary" disabled={!r.media_path && !r.thumbnail_url}>
          <Play className="mr-1 h-4 w-4" aria-hidden /> {r.media_path ? "Play" : "No clip yet"}
        </Button>
        {flagged ? (
          <Button size="sm" variant="outline" onClick={() => markReviewed(r)} disabled={patch.isPending}>
            <ShieldAlert className="mr-1 h-4 w-4" aria-hidden /> Reviewed
          </Button>
        ) : (
          <Button size="sm" onClick={() => approve(r)} disabled={patch.isPending || r.status === "APPROVED" || r.status === "READY"}>
            <Check className="mr-1 h-4 w-4" aria-hidden /> Approve
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => rework(r)} disabled={patch.isPending || r.status === "REWORK"}>
          <RotateCcw className="mr-1 h-4 w-4" aria-hidden /> Needs work
        </Button>
        <Button size="sm" variant="ghost" onClick={() => (editing === r.content_id ? setEditing(null) : startEdit(r))}>
          <Pencil className="mr-1 h-4 w-4" aria-hidden /> {editing === r.content_id ? "Cancel" : "Edit"}
        </Button>
      </div>
    );
  };

  const renderRow = (r: QueueRow) => (
    <Card key={r.content_id}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{r.content_id} · {r.current_filename || r.original_filename || "(unnamed)"}</p>
            <p className="text-xs text-muted-foreground">
              {[r.brand, r.pillar, r.media_type, r.duration_seconds ? `${r.duration_seconds}s` : null].filter(Boolean).join(" · ") || "no brand / pillar yet"}
            </p>
          </div>
          <Badge variant={statusTone(r.status)}>{r.status || "?"}</Badge>
        </div>
        {playing?.id === r.content_id ? (
          <video controls playsInline autoPlay src={playing.url} poster={r.thumbnail_url ?? undefined} className="w-full rounded-md bg-black" />
        ) : r.thumbnail_url ? (
          <img src={r.thumbnail_url} alt="" className="w-full rounded-md" loading="lazy" />
        ) : null}
        {isFlagged(r) ? (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {[r.earnings_claim_risk, r.privacy_risk].filter((v) => (v ?? "").startsWith("FLAG:")).join(" · ")}
          </p>
        ) : null}
        {editing === r.content_id ? (
          <div className="space-y-2">
            <Input value={draft.hook} onChange={(e) => setDraft({ ...draft, hook: e.target.value })} placeholder="Hook (first line on screen)" />
            <Textarea value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} placeholder="Caption" rows={4} />
            <Input value={draft.cta} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} placeholder="CTA" />
            <Button size="sm" onClick={() => saveEdit(r)} disabled={patch.isPending}>Save</Button>
          </div>
        ) : (
          <div className="text-sm">
            <p className="font-medium">{r.hook || <span className="text-muted-foreground">no hook yet</span>}</p>
            {r.caption ? <p className="whitespace-pre-wrap text-muted-foreground">{r.caption}</p> : null}
            {r.cta ? <p className="text-xs">CTA: {r.cta}</p> : null}
          </div>
        )}
        {renderControls(r)}
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <PageHeader
        eyebrow="Content"
        eyebrowIcon={<Clapperboard className="h-3.5 w-3.5" aria-hidden />}
        title="Content Queue"
        subtitle={`Yesterday ${score.yesterday}/${DAILY_TARGET} posted · streak ${score.streak} · last 7 days ${score.week}/${7 * DAILY_TARGET}. Only clips archived with a post URL count.`}
      />

      {rowsQuery.isError ? (
        <Card><CardContent className="p-4 text-sm text-destructive">Could not load the queue: {(rowsQuery.error as Error).message}</CardContent></Card>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Today&apos;s slate · {today}</h2>
        {rowsQuery.isLoading ? (
          <div className="space-y-2">{SLOTS.map((s) => <Skeleton key={s.slot} className="h-16 w-full" />)}</div>
        ) : (
          slate.map((s) => (
            <div key={s.slot} className="space-y-2">
              <p className="text-xs font-semibold">{s.slot} <span className="font-normal text-muted-foreground">· {s.job} · {s.brand}</span></p>
              {s.row ? renderRow(s.row) : (
                <Card><CardContent className="p-4 text-sm text-muted-foreground">Nothing slated. Record today: {s.pillars.join(" / ").toLowerCase()}. The 06:00 slate push carries the hook.</CardContent></Card>
              )}
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Queue · {queue.length}</h2>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search id, file, hook, pillar" />
        <div className="flex flex-wrap gap-2">
          {["ALL", ...OPEN_STATUSES].map((s) => (
            <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>{s}</Button>
          ))}
        </div>
        {rowsQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : queue.length === 0 ? (
          <Card><CardContent className="p-4 text-sm text-muted-foreground">Queue is empty. Drop clips into SAM CONTENT / 01 INBOX on the Mac; the scan and sync run every 30 minutes.</CardContent></Card>
        ) : (
          queue.map(renderRow)
        )}
      </section>
    </div>
  );
}
