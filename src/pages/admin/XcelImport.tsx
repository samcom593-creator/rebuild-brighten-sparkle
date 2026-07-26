import { useCallback, useMemo, useRef, useState } from "react";
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ListChecks,
  Loader2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
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
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        accent="emerald"
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
            "cursor-pointer rounded-lg border-2 border-dashed bg-card p-6 text-center transition-colors sm:p-8",
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/60",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onInputChange}
          />
          <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Drop CSV here or click to browse</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Accepts Xcel DataExport format · Columns detected automatically
          </p>
        </div>
      )}

      {/* ------- parsing skeleton ------- */}
      {parsing && (
        <GlassCard className="p-4">
          <div className="mb-3 flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            <span className="truncate">Parsing {fileName}…</span>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </GlassCard>
      )}

      {/* ------- parse error ------- */}
      {parseError && !parsing && (
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Could not parse</p>
              <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">{parseError}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={reset}
              aria-label="Clear file"
              className="h-10 w-10 shrink-0 sm:h-9 sm:w-9"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ------- parsed summary + preview ------- */}
      {rows.length > 0 && !parsing && (
        <>
          <GlassCard className="p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{fileName}</span>
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={uploading}
                className="h-10 shrink-0 sm:h-9"
              >
                <X className="h-4 w-4" /> Clear
              </Button>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Parsed on this device — nothing has been sent yet. A row without an email or an NPN cannot be matched to a person.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Rows parsed" value={summary.total} className="col-span-2 sm:col-span-1" />
              <StatTile label="With email" value={summary.withEmail} />
              <StatTile label="With NPN" value={summary.withNpn} />
              <StatTile label="Passed exam" value={summary.passedExam} tone="good" />
            </div>
          </GlassCard>

          {unmapped.length > 0 && (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Ignored unrecognized column{unmapped.length === 1 ? "" : "s"}
                  </p>
                  <p className="mt-0.5 break-words font-mono text-xs text-muted-foreground">
                    {unmapped.join(", ")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Preview — one render, one horizontal scroll container (contract §8). */}
          <GlassCard className="p-4">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">Preview</span>
              </h3>
              <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
                {preview.length}
              </span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Exactly what will be sent, straight off the parser — a dash means that column was blank or absent in the export.
            </p>

            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 text-left">Name</th>
                    <th className="px-2 py-2 text-left">Email</th>
                    <th className="px-2 py-2 text-right">NPN</th>
                    <th className="px-2 py-2 text-right">Overall %</th>
                    <th className="px-2 py-2 text-right">Exam</th>
                    <th className="px-2 py-2 text-right">License #</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    /* stable-key-allow:preview-slice — static first-25 slice of parsed CSV, no reorder mid-session */
                    <tr
                      key={`${r.email ?? r.national_producer_number ?? "row"}|${i}`}
                      className="border-b border-border/60 transition-colors hover:bg-muted/30"
                    >
                      <td className="max-w-[180px] px-2 py-2">
                        <div className="truncate text-sm font-medium text-foreground">
                          {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                        </div>
                      </td>
                      <td className="max-w-[220px] px-2 py-2">
                        <div className="truncate text-[11px] text-muted-foreground">{r.email ?? "—"}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {r.national_producer_number ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-foreground">
                        {r.overall_percentage_complete ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-foreground">
                        {r.final_exam_score ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {r.insurance_state_license_number ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows.length > 25 && (
              <p className="mt-3 text-[11px] tabular-nums text-muted-foreground">
                Showing first 25 of {rows.length} rows — all will be sent on confirm.
              </p>
            )}
          </GlassCard>

          {/* Confirm bar */}
          <div className="sticky bottom-4 z-10">
            <div className="rounded-lg border border-emerald-500/35 bg-card p-3 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Ready to import</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    Sends <span className="font-bold tabular-nums text-foreground">{rows.length}</span> row
                    {rows.length === 1 ? "" : "s"} to <span className="font-mono">xcel-csv-ingest</span>.
                  </p>
                </div>
                <Button
                  onClick={confirmImport}
                  disabled={uploading || rows.length === 0}
                  className="h-10 w-full shrink-0 sm:h-9 sm:w-auto"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Importing…
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" /> Confirm import
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ------- result ------- */}
      {result && (
        <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/5 p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-semibold text-foreground">Import complete</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Inserted" value={result.inserted} tone="good" />
            <StatTile label="Updated" value={result.updated} />
            <StatTile label="Upgraded → licensed" value={result.applications_upgraded} tone="good" />
            <StatTile label="Invalid" value={result.invalid} tone="bad" />
          </div>
          {result.errors && result.errors.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-emerald-500/20 pt-3">
              {result.errors.slice(0, 5).map((e, i) => (
                /* stable-key-allow:static-string-list — server-returned error slice, no reorder */
                <p
                  key={`${i}|${e.slice(0, 40)}`}
                  className="break-words font-mono text-[11px] text-rose-600 dark:text-rose-400"
                >
                  {e}
                </p>
              ))}
              {result.errors.length > 5 && (
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  …and {result.errors.length - 5} more
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ------- upload error ------- */}
      {uploadError && (
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Ingest failed</p>
              <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">{uploadError}</p>
            </div>
          </div>
        </div>
      )}

      {/* ------- empty landing when the input was picked but produced nothing ------- */}
      {!parsing && !parseError && rows.length === 0 && fileName && (
        <EmptyState
          icon={<FileSpreadsheet className="h-7 w-7" />}
          variant="warning"
          title="No rows parsed"
          description="The file loaded but no rows survived parsing. Confirm it's the raw DataExport, not a filtered view."
        />
      )}
    </div>
  );
}

// Severity tokens — the -600 dark:-400 pair so a count stays legible on the
// white light-theme card as well as the dark one. Zero is never coloured.
const TILE_TONE = {
  neutral: "text-foreground",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
} as const;

function StatTile({
  label,
  value,
  tone = "neutral",
  className,
}: {
  label: string;
  value: number;
  tone?: keyof typeof TILE_TONE;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-3", className)}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold leading-none tabular-nums",
          value > 0 ? TILE_TONE[tone] : "text-muted-foreground",
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}
