// XcelIngestDialog — paste-in tool for the XCEL Solutions daily email.
//
// Admin opens this from the PreLicensing page, pastes the email HTML
// body, gets a parsed preview, and one-click confirms ingest. Writes
// to xcel_pre_licensing_reports + xcel_pre_licensing_students and
// calls fn_match_xcel_students() so applications.license_progress
// stays in sync automatically.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Sparkles, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { parseXcelReport, type XcelParseResult } from "@/lib/parseXcelReport";
import { supabase } from "@/integrations/supabase/client";

const SECTION_LABEL: Record<string, string> = {
  code_and_ethics:  "Code & Ethics",
  life_only:        "Life Only",
  life_and_health:  "Life & Health",
  other:            "Other",
};

interface Props { trigger?: React.ReactNode; }

export function XcelIngestDialog({ trigger }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState("");
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [parsed, setParsed] = useState<XcelParseResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<"paste" | "preview">("paste");

  function handleParse() {
    if (!html.trim()) { toast.error("Paste the email HTML first"); return; }
    try {
      const result = parseXcelReport(html, reportDate);
      if (result.students.length === 0) {
        toast.error("No student rows found — paste the full email HTML body");
        return;
      }
      setParsed(result);
      setView("preview");
    } catch (e: any) {
      toast.error(`Parse failed: ${e?.message ?? e}`);
    }
  }

  async function handleIngest() {
    if (!parsed) return;
    setSubmitting(true);
    try {
      // 1. Upsert the report header
      const { data: reportRow, error: e1 } = await supabase
        .from("xcel_pre_licensing_reports" as any)
        .upsert({
          report_date: parsed.report_date,
          enrolled_last_30d: parsed.summary.enrolled_last_30d,
          enrolled_last_7d:  parsed.summary.enrolled_last_7d,
          active_last_10d:   parsed.summary.active_last_10d,
          active_pipeline:   parsed.summary.active_pipeline,
          pct_completed:     parsed.summary.pct_completed,
          raw_html:          html,
          raw_payload:       { source: "paste_dialog", student_count: parsed.students.length },
          received_at:       new Date().toISOString(),
        }, { onConflict: "report_date" })
        .select("id")
        .maybeSingle();
      if (e1) throw e1;
      const reportId = (reportRow as any)?.id;
      if (!reportId) throw new Error("No report ID returned");

      // 2. Wipe the day's students if re-ingesting, then bulk insert
      await supabase.from("xcel_pre_licensing_students" as any).delete().eq("report_id", reportId);
      const studentsPayload = parsed.students.map((s) => ({ ...s, report_id: reportId }));
      const { error: e2 } = await supabase
        .from("xcel_pre_licensing_students" as any)
        .insert(studentsPayload);
      if (e2) throw e2;

      // 3. Match to applications + propagate progress
      const { data: matchCount, error: e3 } = await supabase.rpc("fn_match_xcel_students" as any);
      if (e3) throw e3;

      toast.success(
        `Ingested ${parsed.students.length} students · matched ${matchCount ?? 0} to applications`,
        { duration: 5000 },
      );

      // Reset + refresh
      setOpen(false);
      setHtml("");
      setParsed(null);
      setView("paste");
      qc.invalidateQueries({ queryKey: ["xcel-report-latest"] });
      qc.invalidateQueries({ queryKey: ["xcel-students-latest"] });
    } catch (e: any) {
      toast.error(`Ingest failed: ${e?.message ?? e}`);
    } finally {
      setSubmitting(false);
    }
  }

  const sectionCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of parsed?.students ?? []) {
      map[s.course_section] = (map[s.course_section] ?? 0) + 1;
    }
    return map;
  }, [parsed]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-1.5" /> Ingest today's XCEL email
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Ingest XCEL daily report
          </DialogTitle>
        </DialogHeader>

        <Tabs value={view} onValueChange={(v) => setView(v as any)}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="paste">1. Paste email</TabsTrigger>
            <TabsTrigger value="preview" disabled={!parsed}>2. Preview & ingest</TabsTrigger>
          </TabsList>

          {/* Step 1 — paste */}
          <TabsContent value="paste" className="space-y-3 mt-3">
            <div>
              <Label className="text-xs uppercase tracking-wider">Report date</Label>
              <Input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider">Email HTML body</Label>
              <p className="text-xs text-muted-foreground mt-1 mb-2">
                In Gmail: open the XCEL email → ⋮ menu → <em>Show original</em> → copy the entire HTML body
                and paste below. Or right-click the rendered email body → <em>Inspect</em> → copy the outer
                HTML. The parser handles either.
              </p>
              <Textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                placeholder="<html>...the XCEL email body..."
                rows={12}
                className="font-mono text-xs"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleParse} disabled={!html.trim()}>
                Parse → preview
              </Button>
            </DialogFooter>
          </TabsContent>

          {/* Step 2 — preview & ingest */}
          <TabsContent value="preview" className="space-y-3 mt-3">
            {parsed && (
              <>
                <div className="rounded-md border border-border/60 p-3 bg-card/60">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                    Pipeline summary
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                    <Stat label="Enrolled 30d" value={parsed.summary.enrolled_last_30d} />
                    <Stat label="Enrolled 7d"  value={parsed.summary.enrolled_last_7d} />
                    <Stat label="Active 10d"   value={parsed.summary.active_last_10d} />
                    <Stat label="Pipeline"     value={parsed.summary.active_pipeline} />
                    <Stat label="% Completed"  value={parsed.summary.pct_completed != null ? `${parsed.summary.pct_completed}%` : null} />
                  </div>
                </div>

                <div className="rounded-md border border-border/60 p-3 bg-card/60">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                    Parsed students · {parsed.students.length}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {Object.entries(sectionCounts).map(([k, n]) => (
                      <Badge key={k} variant="outline" className="text-xs">
                        {SECTION_LABEL[k] ?? k}: {n}
                      </Badge>
                    ))}
                  </div>
                  <div className="max-h-64 overflow-y-auto text-xs space-y-1.5 pr-1">
                    {parsed.students.map((s, i) => (
                      <div key={`${s.email ?? ""}|${s.first_name ?? ""}|${s.last_name ?? ""}|${i}`} className="rounded border border-border/40 px-2 py-1 flex items-center justify-between gap-2">
                        <span className="truncate">
                          <span className="font-semibold">{s.first_name} {s.last_name}</span>
                          {" · "}
                          <span className="text-muted-foreground">{s.email ?? "no email"}</span>
                        </span>
                        <span className="shrink-0 flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {SECTION_LABEL[s.course_section] ?? s.course_section}
                          </Badge>
                          <span className={`tabular-nums font-bold ${
                            (s.pct_complete ?? 0) >= 100 ? "text-emerald-400" :
                            (s.pct_complete ?? 0) >= 50  ? "text-cyan-400" : "text-amber-400"
                          }`}>
                            {s.pct_complete ?? 0}%
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p>
                    Ingest will <strong>replace</strong> any existing student rows for{" "}
                    <span className="font-mono">{parsed.report_date}</span> and then re-match every row
                    to existing applications by email + phone.
                  </p>
                </div>
              </>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setView("paste")}>← Back</Button>
              <Button onClick={handleIngest} disabled={submitting} className="bg-primary">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                {submitting ? "Ingesting…" : `Ingest ${parsed?.students.length ?? 0} students`}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number | string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value ?? "—"}</p>
    </div>
  );
}
