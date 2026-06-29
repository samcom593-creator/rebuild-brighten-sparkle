// parseXcelReport — parse the daily XCEL Solutions HTML email body into
// a structured payload our `xcel_pre_licensing_*` tables can ingest.
//
// Format Sam receives (from clientservices@xcelsolutions.com):
//   1. "Pipeline Activity Summary" table — 5 cells: enrolled 30d / 7d /
//      active 10d / active pipeline / % completed
//   2. One section per pre-licensing track. Each section is preceded by
//      heading text like "Pre-Licensing: Code and Ethics" or
//      "Pre-Licensing: Life Only" or "Pre-Licensing: Life and Health
//      (Disability)" and contains a table whose header row starts with
//      "Date Enrolled" and has columns:
//        Date Enrolled | Last Log In | Time Spent | % PLE Complete |
//        PLE Date Completed | First Name | Last Name | Phone | Email |
//        Course | Hiring Manager
//
// Output: { report_date, summary, sections: [{section, students[...]}] }

export interface XcelSummary {
  enrolled_last_30d: number | null;
  enrolled_last_7d: number | null;
  active_last_10d: number | null;
  active_pipeline: number | null;
  pct_completed: number | null;
}

export interface XcelStudentRow {
  course_section: "code_and_ethics" | "life_only" | "life_and_health" | "other";
  date_enrolled: string | null;       // ISO yyyy-mm-dd
  last_log_in: string | null;
  time_spent_minutes: number | null;
  pct_complete: number | null;
  date_completed: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  course_name: string | null;
  hiring_manager_name: string | null;
}

export interface XcelParseResult {
  report_date: string;                 // ISO yyyy-mm-dd (defaults to today)
  summary: XcelSummary;
  students: XcelStudentRow[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim().replace(/[ ]/g, " ");
  if (!trimmed || trimmed === "-" || trimmed === "—") return null;
  // Accept MM/DD/YYYY or YYYY-MM-DD
  const m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = (Number(yy) > 50 ? "19" : "20") + yy;
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function parseTimeSpentMinutes(s: string | null | undefined): number | null {
  if (!s) return 0;
  const t = s.toLowerCase().replace(/[ ]/g, " ");
  // Accept "3 hrs 33mins" / "0 hrs 57mins" / "44 hrs 41mins" / "176 hrs 16mins"
  let hrs = 0, mins = 0;
  const hMatch = t.match(/(\d+)\s*hrs?/);
  const mMatch = t.match(/(\d+)\s*mins?/);
  if (hMatch) hrs = parseInt(hMatch[1], 10);
  if (mMatch) mins = parseInt(mMatch[1], 10);
  if (!hMatch && !mMatch) return null;
  return hrs * 60 + mins;
}

function parsePct(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/[ ]/g, " ").match(/(-?\d+(?:\.\d+)?)\s*%?/);
  return m ? Math.max(0, Math.min(100, parseFloat(m[1]))) : null;
}

function parseInt0(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/[ ,]/g, " ").match(/-?\d+(?:\.\d+)?/);
  return m ? Math.round(parseFloat(m[0])) : null;
}

function classifySection(heading: string): XcelStudentRow["course_section"] {
  const h = heading.toLowerCase();
  if (h.includes("code") && h.includes("ethics")) return "code_and_ethics";
  if (h.includes("life") && h.includes("health")) return "life_and_health";
  if (h.includes("life") && h.includes("only")) return "life_only";
  return "other";
}

function textOf(el: Element | null): string {
  if (!el) return "";
  return el.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function cellsOf(row: HTMLTableRowElement): string[] {
  return Array.from(row.cells).map((c) => textOf(c));
}

// ─── Main ───────────────────────────────────────────────────────────────────
export function parseXcelReport(html: string, reportDate?: string): XcelParseResult {
  const today = reportDate ?? new Date().toISOString().slice(0, 10);

  // Strip CSS to keep DOMParser happy; preserve text content
  const cleanedHtml = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  const doc = new DOMParser().parseFromString(cleanedHtml, "text/html");

  const tables = Array.from(doc.querySelectorAll("table")) as HTMLTableElement[];

  // ── 1. Pipeline Activity Summary table ────────────────────────────────
  const summary: XcelSummary = {
    enrolled_last_30d: null,
    enrolled_last_7d: null,
    active_last_10d: null,
    active_pipeline: null,
    pct_completed: null,
  };

  for (const tbl of tables) {
    const rows = Array.from(tbl.rows);
    if (rows.length < 2) continue;
    const headerCells = cellsOf(rows[0]).map((s) => s.toLowerCase());
    const isSummary =
      headerCells.some((h) => h.includes("enrolled") && h.includes("30")) ||
      headerCells.some((h) => h.includes("active pipeline"));
    if (!isSummary) continue;
    const valueCells = cellsOf(rows[1]);
    // Map by header text since column order can vary
    for (let i = 0; i < headerCells.length; i++) {
      const h = headerCells[i];
      const v = valueCells[i];
      if (h.includes("enrolled") && h.includes("30")) summary.enrolled_last_30d = parseInt0(v);
      else if (h.includes("enrolled") && h.includes("7")) summary.enrolled_last_7d = parseInt0(v);
      else if (h.includes("active") && h.includes("10")) summary.active_last_10d = parseInt0(v);
      else if (h.includes("active") && h.includes("pipeline")) summary.active_pipeline = parseInt0(v);
      else if (h.includes("complete")) summary.pct_completed = parsePct(v);
    }
    break;
  }

  // ── 2. Per-section student tables ─────────────────────────────────────
  // Walk the document in order. When we find text containing "Pre-Licensing:"
  // remember the section; the next table that has student-row columns
  // belongs to that section.
  const students: XcelStudentRow[] = [];
  let currentSection: XcelStudentRow["course_section"] = "other";

  // Build an ordered list of "events" — either a heading or a table —
  // by walking the body tree.
  const events: Array<{ type: "heading"; text: string } | { type: "table"; el: HTMLTableElement }> = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;
  while ((node = walker.nextNode())) {
    const el = node as Element;
    if (el.tagName === "TABLE") {
      events.push({ type: "table", el: el as HTMLTableElement });
    } else if (/Pre-Licensing\s*:/i.test(textOf(el))) {
      const t = textOf(el);
      // Avoid pushing the same heading multiple times when it's nested
      if (!events.length || events[events.length - 1].type !== "heading" ||
          (events[events.length - 1] as any).text !== t) {
        events.push({ type: "heading", text: t });
      }
    }
  }

  for (const ev of events) {
    if (ev.type === "heading") {
      currentSection = classifySection(ev.text);
      continue;
    }
    const tbl = ev.el;
    const rows = Array.from(tbl.rows);
    if (rows.length < 2) continue;
    const headerCells = cellsOf(rows[0]).map((s) => s.toLowerCase());
    // Identify a student-row table by header signature
    const hasStudentCols =
      headerCells.some((h) => h.startsWith("date enrolled")) &&
      headerCells.some((h) => h.includes("first name"));
    if (!hasStudentCols) continue;

    // Build a column index lookup
    const idx: Record<string, number> = {};
    headerCells.forEach((h, i) => { idx[h] = i; });
    const col = (...keys: string[]) => {
      for (const k of keys) {
        const i = Object.keys(idx).findIndex((h) => h.includes(k));
        if (i >= 0) return idx[Object.keys(idx)[i]];
      }
      return -1;
    };

    const iDateEnrolled  = col("date enrolled");
    const iLastLogin     = col("last log");
    const iTimeSpent     = col("time spent");
    const iPctComplete   = col("complete");                                // matches "% PLE Complete"
    const iDateCompleted = col("ple date completed", "date completed");
    const iFirstName     = col("first name");
    const iLastName      = col("last name");
    const iPhone         = col("phone");
    const iEmail         = col("email");
    const iCourse        = col("course");
    const iHiringMgr     = col("hiring manager", "hiring mgr");

    for (let r = 1; r < rows.length; r++) {
      const cells = cellsOf(rows[r]);
      if (cells.every((c) => !c)) continue;
      const email = (iEmail >= 0 ? cells[iEmail] : "").toLowerCase().trim();
      const phone = (iPhone >= 0 ? cells[iPhone] : "").replace(/[^\d]/g, "");
      students.push({
        course_section: currentSection,
        date_enrolled: parseDate(iDateEnrolled >= 0 ? cells[iDateEnrolled] : null),
        last_log_in: parseDate(iLastLogin >= 0 ? cells[iLastLogin] : null),
        time_spent_minutes: parseTimeSpentMinutes(iTimeSpent >= 0 ? cells[iTimeSpent] : null),
        pct_complete: parsePct(iPctComplete >= 0 ? cells[iPctComplete] : null),
        date_completed: parseDate(iDateCompleted >= 0 ? cells[iDateCompleted] : null),
        first_name: iFirstName >= 0 ? cells[iFirstName] || null : null,
        last_name: iLastName >= 0 ? cells[iLastName] || null : null,
        phone: phone || null,
        email: email || null,
        course_name: iCourse >= 0 ? cells[iCourse] || null : null,
        hiring_manager_name: iHiringMgr >= 0 ? cells[iHiringMgr] || null : null,
      });
    }
  }

  return { report_date: today, summary, students };
}
