export type ClientPriorityInput = {
  pipeline_stage: string | null;
  created_at: string;
  last_contact_date: string | null;
  next_action_date: string | null;
  callback_date: string | null;
  callback_time?: string | null;
};

export type ClientPriorityCode = "overdue" | "today" | "new" | "unplanned" | "upcoming";

export type ClientPriority = {
  code: ClientPriorityCode;
  label: string;
  reason: string;
  rank: number;
  dueDate: string | null;
};

const CLOSED_STAGES = new Set(["SOLD", "LOST", "INACTIVE"]);

/**
 * Pipeline schedules are entered as calendar dates. Compare their YYYY-MM-DD
 * keys instead of constructing local Date objects, which can move a midnight
 * UTC timestamp to the previous day on an agent's phone.
 */
export function pipelineDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return key ?? null;
}

export function localDateKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isActivePipelineClient(client: Pick<ClientPriorityInput, "pipeline_stage">): boolean {
  return !CLOSED_STAGES.has(client.pipeline_stage ?? "");
}

function earliestSchedule(client: ClientPriorityInput): { date: string; kind: "Callback" | "Next action" } | null {
  const callback = pipelineDateKey(client.callback_date);
  const nextAction = pipelineDateKey(client.next_action_date);
  if (callback && nextAction) return callback <= nextAction ? { date: callback, kind: "Callback" } : { date: nextAction, kind: "Next action" };
  if (callback) return { date: callback, kind: "Callback" };
  if (nextAction) return { date: nextAction, kind: "Next action" };
  return null;
}

export function getClientPriority(client: ClientPriorityInput, now = new Date()): ClientPriority | null {
  if (!isActivePipelineClient(client)) return null;

  const today = localDateKey(now);
  const scheduled = earliestSchedule(client);
  if (scheduled?.date && scheduled.date < today) {
    return {
      code: "overdue",
      label: "Overdue",
      reason: `${scheduled.kind} was due ${scheduled.date}`,
      rank: 0,
      dueDate: scheduled.date,
    };
  }
  if (scheduled?.date === today) {
    return {
      code: "today",
      label: "Due today",
      reason: `${scheduled.kind} is due today${scheduled.kind === "Callback" && client.callback_time ? ` at ${client.callback_time}` : ""}`,
      rank: 1,
      dueDate: scheduled.date,
    };
  }
  if (scheduled) {
    return {
      code: "upcoming",
      label: "Scheduled",
      reason: `${scheduled.kind} is set for ${scheduled.date}`,
      rank: 4,
      dueDate: scheduled.date,
    };
  }
  if (!client.last_contact_date) {
    return {
      code: "new",
      label: "Never touched",
      reason: "No contact or next step recorded",
      rank: 2,
      dueDate: null,
    };
  }
  if (!scheduled) {
    return {
      code: "unplanned",
      label: "No next step",
      reason: "Contacted, but no follow-up is scheduled",
      rank: 3,
      dueDate: null,
    };
  }
  // The earlier branches cover every active client: scheduled, untouched, or
  // contacted without a schedule. Keep this defensive return for malformed
  // runtime data that bypasses the typed contract.
  return null;
}

function timestamp(value: string | null | undefined, fallback: number): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Priority first; then the oldest missed promise, newest untouched lead, or oldest contact without a plan. */
export function compareClientPriority(a: ClientPriorityInput, b: ClientPriorityInput, now = new Date()): number {
  const aPriority = getClientPriority(a, now);
  const bPriority = getClientPriority(b, now);
  if (!aPriority && !bPriority) return 0;
  if (!aPriority) return 1;
  if (!bPriority) return -1;
  if (aPriority.rank !== bPriority.rank) return aPriority.rank - bPriority.rank;

  if (aPriority.dueDate !== bPriority.dueDate) {
    return (aPriority.dueDate ?? "9999-12-31").localeCompare(bPriority.dueDate ?? "9999-12-31");
  }
  if (aPriority.code === "new") {
    return timestamp(b.created_at, 0) - timestamp(a.created_at, 0);
  }
  if (aPriority.code === "unplanned") {
    return timestamp(a.last_contact_date, Number.MAX_SAFE_INTEGER) - timestamp(b.last_contact_date, Number.MAX_SAFE_INTEGER);
  }
  return (a.callback_time ?? "").localeCompare(b.callback_time ?? "");
}
