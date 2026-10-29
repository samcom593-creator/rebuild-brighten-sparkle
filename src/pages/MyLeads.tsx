// MyLeads: the leads Sam or Aisha gave you to work (MP-310 wave 3, 2026-10-29).
//
// my_lead_bundles() returns only the caller's live leads in bundles they hold, with the dialer's do-not-call numbers
// already removed. One tap records what happened (lead_bundle_item_set). Do not call takes the Call link away for
// good, and the number never goes into another bundle.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Phone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { dispositionLabel } from "@/lib/readymodeDispositions";
import { LEAD_STATUS_BUTTONS, canDial, formatLabel, isOpenLead, leadStatusLabel, tierLabel } from "@/lib/leadBundles";

interface MyLead {
  item_id: string;
  bundle_id: string;
  bundle_name: string;
  format: string;
  phone10: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  quality_tier: string | null;
  quality_reason: string | null;
  attempts: number | null;
  last_dialed_at: string | null;
  last_disposition: string | null;
  status: string;
  status_note: string | null;
  status_at: string | null;
  granted_at: string | null;
}
type Show = "open" | "done" | "all";
const SHOW: ReadonlyArray<{ key: Show; label: string }> = [
  { key: "open", label: "To call" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
];
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

async function fetchMine(): Promise<MyLead[]> {
  const { data, error } = await supabase.rpc("my_lead_bundles" as never);
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as MyLead[];
}

export default function MyLeads() {
  usePageTitle("My Leads");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-leads"], queryFn: fetchMine, staleTime: 30_000 });
  const [show, setShow] = useState<Show>("open");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const set = useMutation({
    mutationFn: async ({ item, status }: { item: string; status: string }) => {
      const { error } = await supabase.rpc("lead_bundle_item_set" as never, { p_item: item, p_status: status, p_note: (notes[item] ?? "").trim() || null } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_r, v) => {
      toast.success(`Marked ${leadStatusLabel(v.status).toLowerCase()}.`);
      setNotes((n) => ({ ...n, [v.item]: "" }));
      void qc.invalidateQueries({ queryKey: ["my-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = q.data ?? [];
  const count = (s: Show) => rows.filter((r) => s === "all" || (s === "open" ? isOpenLead(r.status) : !isOpenLead(r.status))).length;
  const visible = rows.filter((r) => show === "all" || (show === "open" ? isOpenLead(r.status) : !isOpenLead(r.status)));
  const groups: Array<{ id: string; name: string; format: string; leads: MyLead[] }> = [];
  for (const r of visible) {
    const g = groups.find((x) => x.id === r.bundle_id);
    if (g) g.leads.push(r);
    else groups.push({ id: r.bundle_id, name: r.bundle_name, format: r.format, leads: [r] });
  }
  return (
    <div className="space-y-6">
      <PageHeader title="My Leads" subtitle="Leads given to you to work. Call, then tap what happened." />
      {q.isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((n) => <Skeleton key={`lead-sk-${n}`} className="h-20 w-full" />)}</div>
      ) : q.isError ? (
        <EmptyState icon={<Inbox className="h-6 w-6" />} title="Your leads did not load" description={(q.error as Error).message} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Inbox className="h-6 w-6" />} title="No leads assigned to you yet." description="When Sam or Aisha gives you a bundle, it shows here." />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {SHOW.map((s) => (
              <Button key={s.key} type="button" size="sm" variant={show === s.key ? "default" : "outline"} onClick={() => setShow(s.key)}>{s.label} ({count(s.key)})</Button>
            ))}
          </div>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing in this view.</p>
          ) : (
            groups.map((g) => (
              <GlassCard key={g.id} className="p-0">
                <p className="px-4 py-3 text-sm font-semibold">
                  {g.name} <Badge variant="outline" className="ml-1 font-normal">{formatLabel(g.format)}</Badge>
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{g.leads.length} lead{g.leads.length === 1 ? "" : "s"}</span>
                </p>
                <ul className="divide-y divide-border/60 border-t border-border/60 text-sm">
                  {g.leads.map((l) => {
                    const href = canDial(l.status) ? phoneHref(l.phone10) : null;
                    return (
                      <li key={l.item_id} className="space-y-2 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-medium">{[l.first_name, l.last_name].filter(Boolean).join(" ") || "Name not on file"}</span>
                          {href ? (
                            <a href={href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Phone className="h-3.5 w-3.5" />{formatPhoneDisplay(l.phone10)}</a>
                          ) : (
                            <span className="text-muted-foreground">{formatPhoneDisplay(l.phone10)} · do not call</span>
                          )}
                          <Badge variant="outline" className="font-normal">{tierLabel(l.quality_tier)}</Badge>
                          <span className="text-muted-foreground">{leadStatusLabel(l.status)}{l.status_note ? `: ${l.status_note}` : ""}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {l.quality_reason}
                          {l.last_dialed_at ? ` · last dialed ${shortDate(l.last_dialed_at)}` : ""}
                          {l.last_disposition ? ` (${dispositionLabel(l.last_disposition)})` : ""}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {LEAD_STATUS_BUTTONS.map((b) => (
                            <Button key={b.key} type="button" size="sm" variant={l.status === b.key ? "default" : "outline"} disabled={set.isPending} onClick={() => set.mutate({ item: l.item_id, status: b.key })}>{b.label}</Button>
                          ))}
                          <Input value={notes[l.item_id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [l.item_id]: e.target.value }))} placeholder="Note (saved with the next tap)" className="h-8 min-w-[12rem] flex-1" maxLength={300} aria-label="Note" />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </GlassCard>
            ))
          )}
        </>
      )}
    </div>
  );
}
