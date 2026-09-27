import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatTimeAgo } from "@/lib/dateUtils";
// phoneHref/smsHref route desktop through Google Voice (a bare tel: is a dead click
// for a VA on a laptop) and contactLinkProps opens that https href in a new tab so
// the dashboard is never navigated away — the MP-392 contract this repo guards.
import { phoneHref, smsHref, contactLinkProps } from "@/lib/phone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * BrandLeadsPanel — /dashboard/team (2026-09-26), admin-only.
 *
 * Sam: "the full funnel system is wired… making sure you can track and grab
 * candidates from all angles." Every form on sell4daddy.com (mentorship ×3,
 * fitness ×2, car rental, AI, collaboration) lands in public.brand_leads; this is
 * the one place to see them, tap to call/email, and move a status. Reads the
 * admin view v_brand_leads (Phoenix time); non-admins get zero rows via RLS, so
 * the panel renders nothing for them.
 */

type Lead = {
  id: string;
  created_phx: string | null;
  source: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  income_range: string | null;
  fit_reason: string | null;
  rental_start: string | null;
  rental_end: string | null;
  status: string | null;
  page: string | null;
};

const LANE: Record<string, string> = {
  mentorship_car_rentals: "Mentorship · Car rentals",
  mentorship_run_team: "Mentorship · Run a team",
  mentorship_fitness: "Mentorship · Fitness",
  fitness_plan_300: "Fitness · $300 plan",
  fitness_high_ticket: "Fitness · 1-on-1",
  rental_inquiry: "Car rental",
  ai_incorporation: "AI for business",
  collaboration: "Collaboration",
  join_team: "Join team",
};
const STATUSES = ["new", "contacted", "booked", "won", "lost"];
const CLOSED = new Set(["won", "lost"]);

export function BrandLeadsPanel() {
  const qc = useQueryClient();
  const [source, setSource] = useState<string>("all");
  const [openOnly, setOpenOnly] = useState(true);

  const query = useQuery({
    queryKey: ["brand-leads"],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Lead[]> => {
      const { data, error } = await supabase
        .from("v_brand_leads")
        .select("*")
        .order("created_phx", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Lead[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("brand_leads").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brand-leads"] }),
  });

  const leads = query.data ?? [];
  const sources = useMemo(() => Array.from(new Set(leads.map((l) => l.source ?? ""))).filter(Boolean).sort(), [leads]);
  const visible = useMemo(
    () => leads.filter((l) => (source === "all" || l.source === source) && (!openOnly || !CLOSED.has(l.status ?? ""))),
    [leads, source, openOnly],
  );
  const newCount = leads.filter((l) => (l.status ?? "new") === "new").length;

  // Zero rows = not an admin (RLS) or no leads yet; either way nothing to show.
  if (!query.isLoading && !query.error && leads.length === 0) return null;

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="text-base sm:text-lg">Brand funnel leads</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Everyone who filled a form on sell4daddy.com — tap to call or email, then move the status. {newCount} new.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpenOnly((v) => !v)}>
            {openOnly ? "Show won/lost" : "Hide won/lost"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.error && <p className="text-sm text-amber-500">Couldn’t load leads: {(query.error as Error).message}</p>}
        {setStatus.error && <p className="text-sm text-amber-500">Status not saved: {(setStatus.error as Error).message}</p>}
        {query.isLoading && <p className="text-sm text-muted-foreground">Loading leads…</p>}

        {leads.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              {["all", ...sources].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    source === s ? "border-amber-500 bg-amber-500/10" : "border-border hover:border-amber-500/50"
                  }`}
                >
                  {s === "all" ? "All" : LANE[s] ?? s}
                  <span className="ml-1 text-muted-foreground">{s === "all" ? leads.length : leads.filter((l) => l.source === s).length}</span>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Lane</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatTimeAgo(l.created_phx)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant="outline">{LANE[l.source ?? ""] ?? l.source ?? "—"}</Badge>
                      </TableCell>
                      <TableCell className="min-w-[170px]">
                        <div className="font-medium">{l.name ?? "—"}</div>
                        <div className="text-xs flex flex-wrap items-center gap-x-2">
                          {phoneHref(l.phone) && (
                            <a className="text-amber-400 hover:underline" href={phoneHref(l.phone)!} {...contactLinkProps(phoneHref(l.phone))}>Call {l.phone}</a>
                          )}
                          {smsHref(l.phone) && (
                            <a className="text-amber-400 hover:underline" href={smsHref(l.phone)!} {...contactLinkProps(smsHref(l.phone))}>Text</a>
                          )}
                          {l.email && <a className="text-amber-400 hover:underline" href={`mailto:${l.email}`}>{l.email}</a>}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[360px] text-xs text-muted-foreground">
                        {l.income_range && <div>Income: {l.income_range}</div>}
                        {l.rental_start && <div>Dates: {l.rental_start} → {l.rental_end ?? "?"}</div>}
                        {l.fit_reason && <div className="line-clamp-2" title={l.fit_reason}>{l.fit_reason}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <select
                          aria-label={`Status for ${l.name ?? "lead"}`}
                          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                          value={l.status ?? "new"}
                          disabled={setStatus.isPending}
                          onChange={(e) => setStatus.mutate({ id: l.id, status: e.target.value })}
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default BrandLeadsPanel;
