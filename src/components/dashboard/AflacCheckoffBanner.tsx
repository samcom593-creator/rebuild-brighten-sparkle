import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useAflacGate } from "@/lib/aflacGate";

/**
 * Home banner for the mandatory daily Aflac check-off. Admin Home only.
 *
 * Three honest states, none of which is hidden:
 *   - the read failed      -> amber "could not read", never silent
 *   - hires ready to send  -> red, says how many
 *   - nothing ready, but today not checked off -> amber
 * It renders nothing only when today's check-off is actually recorded.
 */
export function AflacCheckoffBanner() {
  const { data, isError, isLoading } = useAflacGate();

  if (isLoading) return null;

  if (isError || !data) {
    return (
      <Link
        to="/dashboard/contracting/aflac"
        className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1">Could not read today&apos;s Aflac status. Open the Aflac page to check.</span>
        <ArrowRight className="h-4 w-4 shrink-0" />
      </Link>
    );
  }

  if (data.checked_off_today) return null;

  const ready = data.ready_unsent;
  const tone =
    ready > 0
      ? "border-red-500/50 bg-red-500/10 text-red-200"
      : "border-amber-500/40 bg-amber-500/10 text-amber-200";
  const text =
    ready > 0
      ? `${ready} licensed ${ready === 1 ? "hire is" : "hires are"} ready to send to Aflac. Send them, then check off today.`
      : "Aflac daily check-off is not done today.";

  return (
    <Link to="/dashboard/contracting/aflac" className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${tone}`}>
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 font-medium">{text}</span>
      <ArrowRight className="h-4 w-4 shrink-0" />
    </Link>
  );
}
