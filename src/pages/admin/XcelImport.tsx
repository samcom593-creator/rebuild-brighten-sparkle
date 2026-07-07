import { useCallback, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Upload, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  MP-250 · /admin/xcel-import
    Sam directive 2026-07-07: drop the raw Xcel DataExport CSV into the
    dashboard and let the server route rows to unlicensed_progress /
    aged_leads / upgrade any matching application to licensed.

    Client responsibilities (this file):
      1. Accept CSV via click-or-drop.
      2. Inline parser handles quoted fields, escaped quotes, BOM, CRLF.
      3. Map header row → XcelRow, preview 25, show counts.
      4. POST parsed rows to xcel-csv-ingest edge function.
      5. Render inserted/updated/invalid/applications_upgraded summary.
------------------------------------------------------------------ */

// Columns from Sam's DataExport CSV — every field optional so we survive
// partial exports and column-order changes.
interface XcelRow {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  national_producer_number: string | null;
  overall_percentage_complete: string | null;
  final_exam_score: string | null;
  sku: string | null;
  course_name: string | null;
  enrollment_date: string | null;
  completion_date: string | null;
  insurance_state_license_number: string | null;
}

interface IngestResult {
  inserted: number;
  updated: number;
  invalid: number;
  applications_upgraded: number;
  errors?: string[];
}

// Header aliases → canonical field. Sam's export is tolerant to
// small header renames (e.g. "NPN" instead of "National Producer Number").
const HEADER_MAP: Record<string, keyof XcelRow> = {
  "first name": "first_name",
  "firstname": "first_name",
  "last name": "last_name",
  "lastname": "last_name",
  "email": "email",
  "email address": "email",
  "national producer number": "national_producer_number",
  "npn": "national_producer_number",
  "overall percentage complete": "overall_percentage_complete",
  "overall %": "overall_percentage_complete",
  "final exam score": "final_exam_score",
  "sku": "sku",
  "course name": "course_name",
  "enrollment date": "enrollment_date",
  "completion date": "completion_date",
  "insurance state license number": "insurance_state_license_number",
  "state license number": "insurance_state_license_number",
  "license number": "insurance_state_license_number",
};

// Small, allocation-free CSV state machine. Handles:
//   - UTF-8 BOM at file start
//   - "quoted, values, with commas"
//   - "escaped ""quotes"" inside quotes"
//   - \r\n and \n row terminators
//   - trailing newline
function parseCsv(raw: string): string[][] {
  // Strip BOM if present.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // swallow — the \n will terminate the row
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // Flush trailing field/row (file without terminal newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop completely blank rows (all-empty strings — common at EOF).
  return rows.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
}

function normalizeHeader(h: string): keyof XcelRow | null {
  const key = h.trim().toLowerCase().replace(/[_\s]+/g, " ");
  return HEADER_MAP[key] ?? null;
}

function rowsToXcel(matrix: string[][]): { rows: XcelRow[]; unmapped: string[] } {
  if (matrix.length === 0) return { rows: [], unmapped: [] };
  const [header, ...body] = matrix;
  const unmapped: string[] = [];
  const columnKeys: (keyof XcelRow | null)[] = header.map((h) => {
    const k = normalizeHeader(h);
    if (!k) unmapped.push(h);
    return k;
  });
  const rows: XcelRow[] = body.map((cells) => {
    const obj: XcelRow = {
      first_name: null, last_name: null, email: null,
      national_producer_number: null, overall_percentage_complete: null,
      final_exam_score: null, sku: null, course_name: null,
      enrollment_date: null, completion_date: null,
      insurance_state_license_number: null,
    };
    for (let i = 0; i < columnKeys.length; i++) {
      const k = columnKeys[i];
      if (!k) continue;
      const v = (cells[i] ?? "").trim();
      obj[k] = v === "" ? null : v;
    }
    return obj;
  });
  return { rows, unmapped };
}

export default function XcelImport() {
  usePageTitle("Import XCEL · APEX");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<XcelRow[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const summary = useMemo(() => {
    const withEmail = rows.filter((r) => r.email).length;
    const withNpn = rows.filter((r) => r.national_producer_number).length;
    const passedExam = rows.filter((r) => {
      const pct = parseFloat((r.overall_percentage_complete ?? "").replace(/[%]/g, ""));
      const score = parseFloat(r.final_exam_score ?? "");
      return pct >= 100 || score >= 70;
    }).length;
    return { total: rows.length, withEmail, withNpn, passedExam };
  }, [rows]);

  const handleFile = useCallback(async (file: File) => {
    setParseError(null);
    setResult(null);
    setUploadError(null);
    setFileName(file.name);
    if (!/\.csv$/i.test(file.name) && file.type && !/csv|text/i.test(file.type)) {
      setParseError(`Not a CSV: ${file.name}`);
      setRows([]);
      setUnmapped([]);
      return;
    }
    setParsing(true);
    try {
      const text = await file.text();
      const matrix = parseCsv(text);
      if (matrix.length < 2) {
        throw new Error("CSV needs at least a header row plus one data row.");
      }
      const { rows: parsed, unmapped: extras } = rowsToXcel(matrix);
      if (!parsed.some((r) => r.email || r.national_producer_number)) {
        throw new Error(
          "No rows had an email or NPN. Check that your export includes 'Email' or 'National Producer Number' columns."
        );
      }
      setRows(parsed);
      setUnmapped(extras);
    } catch (e: any) {
      setParseError(e?.message ?? "Could not parse CSV.");
      setRows([]);
      setUnmapped([]);
    } finally {
      setParsing(false);
    }
  }, []);

  const onPickClick = () => inputRef.current?.click();

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = () => setDragOver(false);

  const reset = () => {
    setFileName(null);
    setRows([]);
    setUnmapped([]);
    setParseError(null);
    setResult(null);
    setUploadError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const confirmImport = async () => {
    if (rows.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { data, error } = await supabase.functions.invoke("xcel-csv-ingest", {
        body: { rows, source_filename: fileName },
      });
      if (error) throw error;
      const res = (data ?? {}) as IngestResult;
      setResult({
        inserted: res.inserted ?? 0,
        updated: res.updated ?? 0,
        invalid: res.invalid ?? 0,
        applications_upgraded: res.applications_upgraded ?? 0,
        errors: res.errors ?? [],
      });
      toast.success(
        `Imported ${res.inserted ?? 0} new · updated ${res.updated ?? 0} · upgraded ${res.applications_upgraded ?? 0}`
      );
    } catch (e: any) {
      const msg = e?.message ?? "Ingest failed.";
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const preview = rows.slice(0, 25);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="XCEL DATA IMPORT"
        eyebrowIcon={<FileSpreadsheet className="h-3 w-3" />}
        title="Import XCEL CSV"
        subtitle="Drop the Xcel DataExport CSV. We parse it here, sync each agent's licensing progress, seed newcomers into the aged-lead recovery queue, and auto-promote matched applicants to Licensed status."
      />

      {/* ------- drop zone ------- */}
      {!fileName && (
        <div
          onClick={onPickClick}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={cn(
            "rounded-2xl border-2 border-dashed cursor-pointer transition-colors",
            "p-8 sm:p-12 text-center bg-card",
            dragOver ? "border-emerald-500 bg-emerald-500/5" : "border-border hover:border-emerald-500/60"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onInputChange}
          />
          <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-base font-semibold mb-1">Drop CSV here or click to browse</p>
          <p className="text-xs text-muted-foreground">
            Accepts Xcel DataExport format · Columns detected automatically
          </p>
        </div>
      )}

      {/* ------- parsing skeleton ------- */}
      {parsing && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Parsing {fileName}…
            </div>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      )}

      {/* ------- parse error ------- */}
      {parseError && !parsing && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">Could not parse</p>
              <p className="text-xs text-muted-foreground mt-1">{parseError}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ------- parsed summary + preview ------- */}
      {rows.length > 0 && !parsing && (
        <>
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{fileName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {summary.total} row{summary.total === 1 ? "" : "s"} parsed
                </p>
              </div>
              <Badge variant="outline">{summary.withEmail} w/ email</Badge>
              <Badge variant="outline">{summary.withNpn} w/ NPN</Badge>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                {summary.passedExam} passed exam
              </Badge>
              <Button variant="ghost" size="sm" onClick={reset} disabled={uploading}>
                <X className="h-4 w-4 mr-1" /> Clear
              </Button>
            </CardContent>
          </Card>

          {unmapped.length > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="p-3 text-xs text-amber-700 dark:text-amber-400">
                Ignored unrecognized column{unmapped.length === 1 ? "" : "s"}:{" "}
                <span className="font-mono">{unmapped.join(", ")}</span>
              </CardContent>
            </Card>
          )}

          {/* Desktop table */}
          <div className="hidden sm:block rounded-lg border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2 font-semibold">Name</th>
                  <th className="p-2 font-semibold">Email</th>
                  <th className="p-2 font-semibold">NPN</th>
                  <th className="p-2 font-semibold text-right">Overall %</th>
                  <th className="p-2 font-semibold text-right">Exam</th>
                  <th className="p-2 font-semibold">License #</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 truncate max-w-[180px]">
                      {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="p-2 truncate max-w-[220px]">{r.email ?? "—"}</td>
                    <td className="p-2 tabular-nums">{r.national_producer_number ?? "—"}</td>
                    <td className="p-2 text-right tabular-nums">{r.overall_percentage_complete ?? "—"}</td>
                    <td className="p-2 text-right tabular-nums">{r.final_exam_score ?? "—"}</td>
                    <td className="p-2 tabular-nums">{r.insurance_state_license_number ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 25 && (
              <p className="text-[11px] text-muted-foreground text-center py-2 border-t bg-muted/20">
                Showing first 25 of {rows.length} rows — all will be sent on confirm.
              </p>
            )}
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {preview.map((r, i) => (
              <Card key={i}>
                <CardContent className="p-3 text-xs space-y-1">
                  <p className="font-semibold text-sm">
                    {[r.first_name, r.last_name].filter(Boolean).join(" ") || "(no name)"}
                  </p>
                  {r.email && <p className="text-muted-foreground truncate">{r.email}</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {r.national_producer_number && <Badge variant="outline">NPN {r.national_producer_number}</Badge>}
                    {r.overall_percentage_complete && (
                      <Badge variant="outline">{r.overall_percentage_complete}%</Badge>
                    )}
                    {r.final_exam_score && <Badge variant="outline">Exam {r.final_exam_score}</Badge>}
                    {r.insurance_state_license_number && (
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                        Lic {r.insurance_state_license_number}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {rows.length > 25 && (
              <p className="text-[11px] text-muted-foreground text-center">
                Showing first 25 of {rows.length}. All will be sent on confirm.
              </p>
            )}
          </div>

          {/* Confirm bar */}
          <div className="sticky bottom-4 z-10">
            <Card className="border-emerald-500/40 bg-background/95 backdrop-blur">
              <CardContent className="p-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">Ready to import</p>
                  <p className="text-[11px] text-muted-foreground">
                    Sends {rows.length} row{rows.length === 1 ? "" : "s"} to <span className="font-mono">xcel-csv-ingest</span>.
                  </p>
                </div>
                <Button
                  onClick={confirmImport}
                  disabled={uploading || rows.length === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing…
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" /> Confirm import
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* ------- result ------- */}
      {result && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <p className="text-sm font-semibold">Import complete</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <ResultTile label="Inserted" value={result.inserted} accent="text-emerald-500" />
              <ResultTile label="Updated" value={result.updated} accent="text-sky-500" />
              <ResultTile label="Upgraded → licensed" value={result.applications_upgraded} accent="text-amber-500" />
              <ResultTile label="Invalid" value={result.invalid} accent="text-rose-500" />
            </div>
            {result.errors && result.errors.length > 0 && (
              <div className="text-[11px] text-rose-600 dark:text-rose-400 space-y-0.5 pt-2 border-t border-emerald-500/20">
                {result.errors.slice(0, 5).map((e, i) => (
                  <p key={i} className="font-mono truncate">{e}</p>
                ))}
                {result.errors.length > 5 && (
                  <p className="italic">…and {result.errors.length - 5} more</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ------- upload error ------- */}
      {uploadError && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">Ingest failed</p>
              <p className="text-xs text-muted-foreground mt-1">{uploadError}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ------- empty landing when the input was picked but produced nothing ------- */}
      {!parsing && !parseError && rows.length === 0 && fileName && (
        <EmptyState
          icon={<FileSpreadsheet className="h-8 w-8" />}
          title="No rows parsed"
          description="The file loaded but no rows survived parsing. Confirm it's the raw DataExport, not a filtered view."
        />
      )}
    </div>
  );
}

function ResultTile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{label}</p>
      <p className={cn("text-2xl leading-none font-black tabular-nums mt-1", accent)}>{value}</p>
    </div>
  );
}
