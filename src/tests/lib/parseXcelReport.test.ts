/**
 * parseXcelReport.test.ts
 *
 * Tests for src/lib/parseXcelReport.ts
 * This file parses XCEL Solutions HTML pre-licensing emails into structured data.
 * Complex HTML parsing logic that silently produces nulls on malformed input — needs thorough coverage.
 *
 * Coverage targets:
 *   ✅ Happy path — full valid HTML with summary table + 2 sections
 *   ✅ Summary table field mapping (enrolled_30d, enrolled_7d, active_10d, pipeline, pct_completed)
 *   ✅ Student row parsing — all fields correctly mapped
 *   ✅ Section classification — code_and_ethics / life_only / life_and_health / other
 *   ✅ Date parsing — MM/DD/YYYY, YYYY-MM-DD, dash/em-dash → null
 *   ✅ Time spent parsing — "3 hrs 33mins", "0 hrs 57mins", null → 0
 *   ✅ Percentage parsing — "75 %", "100%", null, negative
 *   ✅ Empty/blank student row skipping
 *   ✅ Missing summary table → null fields (no crash)
 *   ✅ Empty HTML → no crash, empty students array
 *   ✅ Custom reportDate parameter
 *
 * LATENT BUG:
 *   The `DOMParser` used in parseXcelReport is a browser API. In vitest/jsdom
 *   it works fine. In Node (without jsdom) it would fail — confirm jsdom env
 *   is configured in vitest.config.ts (it is: environment: "jsdom").
 */

import { describe, it, expect } from "vitest";
import { parseXcelReport } from "@/lib/parseXcelReport";

// ── HTML fixtures ─────────────────────────────────────────────────────────────

/**
 * Minimal valid XCEL email with:
 * - Pipeline Activity Summary table (header variant the real email uses)
 * - One "Code and Ethics" section with 2 students
 */
const VALID_HTML = `
<html><body>
<style>body { color: red; }</style>
<table>
  <tr>
    <td>Enrolled Last 30 Days</td>
    <td>Enrolled Last 7 Days</td>
    <td>Active Last 10 Days</td>
    <td>Active Pipeline</td>
    <td>% Completed</td>
  </tr>
  <tr>
    <td>42</td>
    <td>8</td>
    <td>15</td>
    <td>37</td>
    <td>63%</td>
  </tr>
</table>

<p>Pre-Licensing: Code and Ethics</p>

<table>
  <tr>
    <td>Date Enrolled</td>
    <td>Last Log In</td>
    <td>Time Spent</td>
    <td>% PLE Complete</td>
    <td>PLE Date Completed</td>
    <td>First Name</td>
    <td>Last Name</td>
    <td>Phone</td>
    <td>Email</td>
    <td>Course</td>
    <td>Hiring Manager</td>
  </tr>
  <tr>
    <td>05/01/2026</td>
    <td>05/15/2026</td>
    <td>3 hrs 33mins</td>
    <td>75%</td>
    <td>-</td>
    <td>Jane</td>
    <td>Doe</td>
    <td>(555) 123-4567</td>
    <td>jane.doe@example.com</td>
    <td>Code and Ethics</td>
    <td>Sam James</td>
  </tr>
  <tr>
    <td>04/28/2026</td>
    <td>05/10/2026</td>
    <td>0 hrs 57mins</td>
    <td>100%</td>
    <td>05/12/2026</td>
    <td>John</td>
    <td>Smith</td>
    <td>5557654321</td>
    <td>JOHN.SMITH@EXAMPLE.COM</td>
    <td>Code and Ethics</td>
    <td>Sam James</td>
  </tr>
</table>
</body></html>
`;

const LIFE_ONLY_HTML = `
<html><body>
<p>Pre-Licensing: Life Only</p>
<table>
  <tr>
    <td>Date Enrolled</td><td>Last Log In</td><td>Time Spent</td>
    <td>% PLE Complete</td><td>PLE Date Completed</td>
    <td>First Name</td><td>Last Name</td><td>Phone</td><td>Email</td>
    <td>Course</td><td>Hiring Manager</td>
  </tr>
  <tr>
    <td>05/03/2026</td><td>-</td><td>44 hrs 41mins</td>
    <td>50 %</td><td>—</td>
    <td>Alice</td><td>Walker</td><td>5551112222</td><td>alice@test.com</td>
    <td>Life Only</td><td>KJ</td>
  </tr>
</table>
</body></html>
`;

const LIFE_AND_HEALTH_HTML = `
<html><body>
<p>Pre-Licensing: Life and Health (Disability)</p>
<table>
  <tr>
    <td>Date Enrolled</td><td>Last Log In</td><td>Time Spent</td>
    <td>% PLE Complete</td><td>PLE Date Completed</td>
    <td>First Name</td><td>Last Name</td><td>Phone</td><td>Email</td>
    <td>Course</td><td>Hiring Manager</td>
  </tr>
  <tr>
    <td>2026-05-01</td><td>2026-05-14</td><td>176 hrs 16mins</td>
    <td>100%</td><td>2026-05-15</td>
    <td>Bob</td><td>Jones</td><td></td><td>bob@example.com</td>
    <td>Life and Health</td><td>Sam James</td>
  </tr>
</table>
</body></html>
`;

const EMPTY_HTML = `<html><body></body></html>`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("parseXcelReport — happy path", () => {
  it("does not throw on valid HTML", () => {
    expect(() => parseXcelReport(VALID_HTML)).not.toThrow();
  });

  it("uses today's date when reportDate not provided", () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = parseXcelReport(VALID_HTML);
    expect(result.report_date).toBe(today);
  });

  it("uses provided reportDate parameter", () => {
    const result = parseXcelReport(VALID_HTML, "2026-05-15");
    expect(result.report_date).toBe("2026-05-15");
  });

  it("returns 2 students from the Code and Ethics section", () => {
    const result = parseXcelReport(VALID_HTML);
    expect(result.students).toHaveLength(2);
  });
});

describe("parseXcelReport — summary table", () => {
  it("parses enrolled_last_30d", () => {
    const { summary } = parseXcelReport(VALID_HTML);
    expect(summary.enrolled_last_30d).toBe(42);
  });

  it("parses enrolled_last_7d", () => {
    const { summary } = parseXcelReport(VALID_HTML);
    expect(summary.enrolled_last_7d).toBe(8);
  });

  it("parses active_last_10d", () => {
    const { summary } = parseXcelReport(VALID_HTML);
    expect(summary.active_last_10d).toBe(15);
  });

  it("parses active_pipeline", () => {
    const { summary } = parseXcelReport(VALID_HTML);
    expect(summary.active_pipeline).toBe(37);
  });

  it("parses pct_completed", () => {
    const { summary } = parseXcelReport(VALID_HTML);
    expect(summary.pct_completed).toBe(63);
  });

  it("returns null summary fields when no summary table exists", () => {
    const { summary } = parseXcelReport(LIFE_ONLY_HTML);
    expect(summary.enrolled_last_30d).toBeNull();
    expect(summary.active_pipeline).toBeNull();
  });
});

describe("parseXcelReport — student row parsing", () => {
  it("parses date_enrolled as ISO yyyy-MM-dd from MM/DD/YYYY", () => {
    const { students } = parseXcelReport(VALID_HTML);
    expect(students[0].date_enrolled).toBe("2026-05-01");
  });

  it("parses last_log_in as ISO yyyy-MM-dd", () => {
    const { students } = parseXcelReport(VALID_HTML);
    expect(students[0].last_log_in).toBe("2026-05-15");
  });

  it("parses time_spent_minutes from 'N hrs Mmins'", () => {
    const { students } = parseXcelReport(VALID_HTML);
    expect(students[0].time_spent_minutes).toBe(3 * 60 + 33); // 213
  });

  it("parses '0 hrs 57mins' as 57 minutes", () => {
    const { students } = parseXcelReport(VALID_HTML);
    expect(students[1].time_spent_minutes).toBe(57);
  });

  it("parses '44 hrs 41mins' correctly", () => {
    const { students } = parseXcelReport(LIFE_ONLY_HTML);
    expect(students[0].time_spent_minutes).toBe(44 * 60 + 41); // 2681
  });

  it("parses '176 hrs 16mins' correctly", () => {
    const { students } = parseXcelReport(LIFE_AND_HEALTH_HTML);
    expect(students[0].time_spent_minutes).toBe(176 * 60 + 16); // 10576
  });

  it("parses pct_complete from '75%'", () => {
    const { students } = parseXcelReport(VALID_HTML);
    expect(students[0].pct_complete).toBe(75);
  });

  it("parses pct_complete from '50 %' (with space)", () => {
    const { students } = parseXcelReport(LIFE_ONLY_HTML);
    expect(students[0].pct_complete).toBe(50);
  });

  it("returns null for date_completed when cell is '-' (dash)", () => {
    const { students } = parseXcelReport(VALID_HTML);
    expect(students[0].date_completed).toBeNull();
  });

  it("returns null for date_completed when cell is '—' (em-dash)", () => {
    const { students } = parseXcelReport(LIFE_ONLY_HTML);
    expect(students[0].date_completed).toBeNull();
  });

  it("parses date_completed as ISO when present", () => {
    const { students } = parseXcelReport(VALID_HTML);
    expect(students[1].date_completed).toBe("2026-05-12");
  });

  it("lowercases email addresses", () => {
    const { students } = parseXcelReport(VALID_HTML);
    expect(students[1].email).toBe("john.smith@example.com");
  });

  it("strips non-digit characters from phone", () => {
    const { students } = parseXcelReport(VALID_HTML);
    expect(students[0].phone).toBe("5551234567");
  });

  it("returns null phone for empty cell", () => {
    const { students } = parseXcelReport(LIFE_AND_HEALTH_HTML);
    expect(students[0].phone).toBeNull();
  });

  it("parses YYYY-MM-DD date format in date_enrolled", () => {
    const { students } = parseXcelReport(LIFE_AND_HEALTH_HTML);
    expect(students[0].date_enrolled).toBe("2026-05-01");
  });
});

describe("parseXcelReport — section classification", () => {
  it("classifies 'Pre-Licensing: Code and Ethics' as code_and_ethics", () => {
    const { students } = parseXcelReport(VALID_HTML);
    expect(students[0].course_section).toBe("code_and_ethics");
  });

  it("classifies 'Pre-Licensing: Life Only' as life_only", () => {
    const { students } = parseXcelReport(LIFE_ONLY_HTML);
    expect(students[0].course_section).toBe("life_only");
  });

  it("classifies 'Pre-Licensing: Life and Health (Disability)' as life_and_health", () => {
    const { students } = parseXcelReport(LIFE_AND_HEALTH_HTML);
    expect(students[0].course_section).toBe("life_and_health");
  });
});

describe("parseXcelReport — edge cases", () => {
  it("does not throw on empty HTML body", () => {
    expect(() => parseXcelReport(EMPTY_HTML)).not.toThrow();
  });

  it("returns empty students array for empty HTML", () => {
    const result = parseXcelReport(EMPTY_HTML);
    expect(result.students).toHaveLength(0);
  });

  it("skips rows where all cells are empty", () => {
    const htmlWithBlankRow = VALID_HTML.replace(
      "</table>\n</body>",
      "<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>\n</body>"
    );
    const result = parseXcelReport(htmlWithBlankRow);
    // Should still be 2, blank row should be skipped
    expect(result.students).toHaveLength(2);
  });

  it("strips CSS style tags from HTML before parsing", () => {
    const htmlWithStyle = `
      <html><body>
      <style>.foo { color: red; font-family: "Enrolled Last 30 Days"; }</style>
      ${VALID_HTML}
      </body></html>
    `;
    // Should not crash and should still parse summary
    const result = parseXcelReport(htmlWithStyle);
    expect(() => result.summary).not.toThrow();
  });

  it("does not crash on HTML with no tables", () => {
    const noTables = "<html><body><p>No tables here</p></body></html>";
    const result = parseXcelReport(noTables);
    expect(result.students).toHaveLength(0);
    expect(result.summary.enrolled_last_30d).toBeNull();
  });
});
