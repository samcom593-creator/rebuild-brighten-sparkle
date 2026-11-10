// CourseProofReviewPanel — WP1 (onboarding audit 2026-11-10).
//
// The course-purchase gate on the application status page saves a screenshot
// to the private licensing-proofs bucket and a row in licensing_course_proofs,
// and until now nothing read either. This panel lists proofs waiting for a
// human, shows each image through a 5-minute signed URL, and records Verify or
// Reject through public.admin_review_course_proof. A verify stamps
// applications.course_purchased_at forward-only (that RPC and the Xcel match are
// the only paths allowed to). A proof whose applicant shows up in the Xcel feed is
// auto-verified by the write-back and drops off this list on its own.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Image as ImageIcon, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// New relations/RPCs are not in the generated types until the integrator
// regenerates them, so this file talks to the client through a narrow untyped
// facade instead of `any` (same pattern as useRecruitingWorklist).
type DbError = { message: string; code?: string | null };
type QueryResult<T> = { data: T | null; error: DbError | null };
interface UntypedQuery<T> extends PromiseLike<QueryResult<T>> {
  select(columns: string): UntypedQuery<T>;
  in(column: string, values: readonly unknown[]): UntypedQuery<T>;
  order(column: string, options?: { ascending?: boolean }): UntypedQuery<T>;
  limit(n: number): UntypedQuery<T>;
}
interface UntypedClient {
  from(relation: string): UntypedQuery<unknown[]>;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<QueryResult<unknown>>;
}
const db = supabase as unknown as UntypedClient;

export const PROOF_SIGNED_URL_SECONDS = 300;

export interface CourseProofRow {
  id: string;
  application_id: string | null;
  screenshot_path: string | null;
  content_type: string | null;
  status: string | null;
  submitted_at: string | null;
}

interface ApplicantName {
  id: string;
  first_name: string | null;
}

export function CourseProofReviewPanel() {
  const qc = useQueryClient();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const proofsQ = useQuery({
    queryKey: ["course-proofs-to-review"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("licensing_course_proofs")
        .select("id, application_id, screenshot_path, content_type, status, submitted_at")
        .in("status", ["submitted", "pending"])
        .order("submitted_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      const proofs = (data ?? []) as CourseProofRow[];
      const ids = Array.from(new Set(proofs.map((p) => p.application_id).filter(Boolean))) as string[];
      let names: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: apps, error: appErr } = await supabase
          .from("applications")
          .select("id, first_name")
          .in("id", ids);
        if (appErr) throw appErr;
        names = Object.fromEntries(((apps ?? []) as ApplicantName[]).map((a) => [a.id, (a.first_name ?? "").trim()]));
      }
      return { proofs, names };
    },
  });

  async function view(p: CourseProofRow) {
    if (!p.screenshot_path) return;
    const { data, error } = await supabase.storage
      .from("licensing-proofs")
      .createSignedUrl(p.screenshot_path, PROOF_SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) {
      toast.error(`Could not open the screenshot: ${error?.message ?? "no URL returned"}`);
      return;
    }
    setUrls((u) => ({ ...u, [p.id]: data.signedUrl }));
  }

  async function decide(p: CourseProofRow, decision: "verified" | "rejected") {
    setBusy(p.id);
    try {
      const { error } = await db.rpc("admin_review_course_proof", {
        p_proof_id: p.id,
        p_decision: decision,
      });
      if (error) throw error;
      toast.success(decision === "verified" ? "Verified. Course purchase recorded on the application." : "Rejected.");
      qc.invalidateQueries({ queryKey: ["course-proofs-to-review"] });
    } catch (e) {
      toast.error(`Review failed: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const proofs = proofsQ.data?.proofs ?? [];
  const names = proofsQ.data?.names ?? {};

  return (
    <GlassCard className="p-4 space-y-3" data-testid="course-proof-review-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] uppercase tracking-widest text-muted-foreground font-semibold">Course purchase</p>
          <h3 className="text-lg font-bold">Course proofs to review</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Screenshots applicants uploaded to unlock the licensing call. Verify to record the course purchase; proofs that match the Xcel feed verify themselves.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">{proofsQ.isLoading ? "…" : proofs.length} waiting</Badge>
      </div>

      {proofsQ.isError ? (
        <p className="text-sm text-rose-400">Could not load proofs: {(proofsQ.error as Error)?.message}</p>
      ) : proofsQ.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : proofs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No course proofs are waiting for review.</p>
      ) : (
        <ul className="space-y-2">
          {proofs.map((p) => {
            const first = (p.application_id && names[p.application_id]) || "—";
            return (
              <li key={p.id} className="rounded-lg border border-border/50 p-3 space-y-2">
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <div className="flex-1 min-w-0 text-sm">
                    <span className="font-semibold">{first}</span>
                    <span className="text-muted-foreground"> · submitted {p.submitted_at ? p.submitted_at.slice(0, 16).replace("T", " ") : "—"}</span>
                    {p.application_id && (
                      <Link to={`/dashboard/applicants?id=${p.application_id}`} className="ml-2 inline-flex items-center text-xs underline underline-offset-2">
                        <ExternalLink className="h-3 w-3 mr-0.5" /> application
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => view(p)} disabled={!p.screenshot_path}>
                      <ImageIcon className="h-3.5 w-3.5 mr-1" /> View
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => decide(p, "verified")}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Verify
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => decide(p, "rejected")}>
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
                {urls[p.id] && (
                  <img
                    src={urls[p.id]}
                    alt={`Course purchase proof submitted by ${first}`}
                    className="max-h-80 rounded-md border border-border/40"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}

export default CourseProofReviewPanel;
