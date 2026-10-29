// GradeBreakdown: why a call got its grade (rubric v2, MP-310, 2026-10-29).
//
// Sam: "fix the grading process, I feel like the grading process is pretty vague ... how much they were on script."
// Each of the six scores carries the reason, the moment and the line behind it, and the script checklist shows every
// step of the agency script the call followed (public.sales_scripts): done, partly or skipped, and where it happens.
// The overall score is computed from fixed weights by readymode-bot/scripts/grade-calls.py, shown beside each part.
import { Check, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { seekCall } from "@/lib/callAudio";

interface Reason { reason?: string; t?: string; quote?: string }
interface Step { step?: string; status?: string; t?: string; note?: string }
const PARTS: Array<{ key: string; label: string; weight: number }> = [
  { key: "opening", label: "Opening", weight: 1 },
  { key: "discovery", label: "Discovery", weight: 1.5 },
  { key: "presentation", label: "Presentation", weight: 1.5 },
  { key: "objection_handling", label: "Objections", weight: 2 },
  { key: "close", label: "Close", weight: 2 },
  { key: "compliance", label: "Compliance", weight: 0.5 },
];
function Stamp({ callId, t }: { callId?: string; t?: string }) {
  if (!t) return null;
  return callId ? (
    <button type="button" className="mr-1 font-mono text-xs text-primary hover:underline" title="Play this moment" onClick={() => seekCall(callId, t)}>[{t}]</button>
  ) : (
    <span className="mr-1 font-mono text-xs text-muted-foreground">[{t}]</span>
  );
}
const tone = (n: number | null | undefined) =>
  n == null ? "text-muted-foreground" : n >= 8 ? "text-emerald-700 dark:text-emerald-300" : n >= 6 ? "text-amber-700 dark:text-amber-300" : "text-rose-700 dark:text-rose-300";

export function GradeBreakdown({ callId, scores, reasons, scriptScore, scriptFollowed, steps }: {
  /** When set, every timestamp plays that moment of this call. */
  callId?: string;
  scores: Record<string, number> | null;
  reasons: Record<string, Reason> | null;
  scriptScore: number | null;
  scriptFollowed: string | null;
  steps: Step[] | null;
}) {
  const rs = reasons ?? {};
  const list = steps ?? [];
  if (Object.keys(rs).length === 0 && list.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="py-1 pr-2">Part</th><th className="px-2 text-right">Score</th><th className="px-2">Why</th></tr>
          </thead>
          <tbody>
            {PARTS.map((p) => {
              const r = rs[p.key] ?? {};
              const s = scores?.[p.key];
              return (
                <tr key={p.key} className="border-t border-border/40 align-top">
                  <td className="py-1.5 pr-2 font-medium">{p.label}<span className="block text-xs font-normal text-muted-foreground">weight {p.weight}</span></td>
                  <td className={cn("px-2 text-right font-semibold tabular-nums", tone(s))}>{s ?? ""}/10</td>
                  <td className="px-2">
                    {r.reason ?? ""}
                    {r.quote ? <span className="block text-xs text-muted-foreground"><Stamp callId={callId} t={r.t} />“{r.quote}”</span> : null}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-border/40 align-top">
              <td className="py-1.5 pr-2 font-medium">On script<span className="block text-xs font-normal text-muted-foreground">weight 1.5</span></td>
              <td className={cn("px-2 text-right font-semibold tabular-nums", tone(scriptScore))}>{scriptScore ?? ""}/10</td>
              <td className="px-2">{scriptFollowed && scriptFollowed !== "none" ? `Followed: ${scriptFollowed}` : "No agency script followed"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {list.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Script steps</p>
          <ol className="space-y-1">
            {list.map((st) => (
              <li key={`${st.step ?? ""}|${st.t ?? ""}`} className="flex items-start gap-2">
                {st.status === "done" ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="done" />
                ) : st.status === "partly" ? (
                  <Minus className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-label="partly" />
                ) : (
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-label="skipped" />
                )}
                <span>
                  <span className="font-medium">{st.step}</span>
                  {st.t ? <span className="ml-1"><Stamp callId={callId} t={st.t} /></span> : null}
                  {st.note ? <span className="block text-xs text-muted-foreground">{st.note}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
