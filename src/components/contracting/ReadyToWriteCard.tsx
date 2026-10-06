/**
 * ReadyToWriteCard — which carriers this agent can actually write today.
 *
 * Verified Ready to Write means one of two things and nothing else:
 *   - the imported AgentLink carrier record shows the contract active,
 *     labelled "Imported carrier record" with its last sync time; or
 *   - contracting staff recorded a verification with its source and evidence.
 * "Submitted", "pending" or "no outstanding requirements" never appear here as
 * approval. Every other carrier is summarised by lifecycle, one count each,
 * never folded into a single "contracted" badge.
 *
 * Reads contracting_carrier_cases(p_agent_id), which allows the agent
 * themself, their upline, and contracting staff.
 */
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchCarrierCases } from "@/lib/contractingCasesApi";
import { isAccessRefusal, readyToWriteSummary, verificationLabel } from "@/lib/contractingCases";

export function ReadyToWriteCard({ agentId }: { agentId: string | null | undefined }) {
  const q = useQuery({
    queryKey: ["agent-ready-to-write", agentId],
    enabled: !!agentId,
    staleTime: 60_000,
    queryFn: () => fetchCarrierCases(agentId as string),
  });

  if (!agentId) return null;
  // The server decides who may see an agent's carriers. A refusal is that
  // decision, not a load failure: show nothing rather than an error.
  if (isAccessRefusal(q.error)) return null;

  const summary = readyToWriteSummary(q.data ?? []);

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby={`rtw-${agentId}`}>
      <h3 id={`rtw-${agentId}`} className="flex items-center gap-1.5 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        Carriers ready to write
      </h3>
      {q.isLoading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      ) : q.error ? (
        <p className="mt-2 text-sm text-destructive">Carrier status did not load: {(q.error as Error).message}</p>
      ) : (
        <>
          {summary.verified.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No carrier verified ready to write yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {summary.verified.map((r) => (
                <li key={r.carrier_name} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5 text-sm">
                  <span className="font-medium">
                    {r.carrier_name}
                    {r.carrier_level && <span className="ml-1.5 text-xs font-normal text-muted-foreground">Level {r.carrier_level}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{verificationLabel(r) ?? "Source not recorded"}</span>
                </li>
              ))}
            </ul>
          )}
          {summary.others.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Not yet writable:{" "}
              {summary.others.map((o, i) => (
                <span key={o.lifecycle}>
                  {i > 0 && " · "}
                  <span className="tabular-nums text-foreground">{o.count}</span> {o.label}
                </span>
              ))}
            </p>
          )}
          {(q.data ?? []).length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">No carrier records on file for this agent yet.</p>
          )}
        </>
      )}
    </section>
  );
}

export default ReadyToWriteCard;
