// FunnelConnector — vertical-arrow plain-language conversion line between
// two adjacent FunnelStageCards. Phone-first, no percent signs ("62 of every
// 100 clicked the ref link" reads like a sentence Sam would say to a
// recruiter, not a chart label).
//
// Null-safe: when prev count is missing/0 → renders "—" instead of an
// undefined % calc. Sam 2026-06-10 rule: never bare "0" for missing data.

interface FunnelConnectorProps {
  prev: number | null;
  next: number | null;
  /** Action verb after "of every 100", e.g. "clicked the ref link". */
  verb: string;
}

export function FunnelConnector({ prev, next, verb }: FunnelConnectorProps) {
  let convOf100: string;
  if (prev == null || next == null || prev <= 0) {
    convOf100 = "—";
  } else {
    convOf100 = Math.round((next / prev) * 100).toString();
  }

  return (
    <div className="flex flex-col items-center py-1">
      <div className="text-muted-foreground text-lg leading-none">▼</div>
      <div className="text-sm text-muted-foreground mt-1">
        {convOf100} of every 100
      </div>
      <div className="text-sm text-muted-foreground/80">{verb}</div>
    </div>
  );
}
