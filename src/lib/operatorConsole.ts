export type OperatorExecutionType =
  | "navigate"
  | "sync"
  | "status_snapshot"
  | "health_check"
  | "licensing_blast"
  | "queue_prompt"
  | "advanced_sql"
  | "confirm_required"
  | "unknown";

export interface OperatorCommandRequest {
  command: string;
  scope: "website" | "recruiting" | "metrics" | "admin";
  dryRun: boolean;
  requiresConfirmation: boolean;
}

export interface OperatorCommandResponse {
  command: string;
  scope: OperatorCommandRequest["scope"];
  dryRun: boolean;
  requiresConfirmation: boolean;
  executionType: OperatorExecutionType;
  taskId?: string | null;
  plannedAction: string;
  executedAction: string;
  why: string;
  result: string;
  rollbackHint: string;
  prompt?: string;
  route?: string;
  createdAt: string;
}

const ROUTE_SHORTCUTS: Array<{ test: RegExp; route: string; action: string }> = [
  { test: /\btoday\b/i, route: "/dashboard/today", action: "Open the Today page" },
  { test: /\bcrm\b/i, route: "/dashboard/crm", action: "Open CRM" },
  { test: /\bcall center\b/i, route: "/dashboard/call-center", action: "Open Call Center" },
  { test: /\bleaderboard\b/i, route: "/dashboard/leaderboard", action: "Open Leaderboard" },
  { test: /\blicensed?\b.*\bguide\b|\bget licensed\b/i, route: "/get-licensed", action: "Open the licensing flow" },
  { test: /\boffers?\b/i, route: "/dashboard/offers", action: "Open Offers" },
];

export function buildImplementationPrompt(command: string): string {
  return [
    "APEX Website task",
    "",
    `User request: ${command}`,
    "",
    "Requirements:",
    "1. Treat AgentLink / posted deals as the source of truth for sales widgets.",
    "2. Keep America/Chicago calendar day, week, and month boundaries.",
    "3. Do not fabricate numbers or fallback marketing metrics.",
    "4. End with live verification, exact files changed, and any remaining risks.",
  ].join("\n");
}

export function planOperatorCommand(command: string): OperatorCommandResponse {
  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();
  const createdAt = new Date().toISOString();

  const routeShortcut = ROUTE_SHORTCUTS.find((item) => item.test.test(trimmed));
  if (routeShortcut) {
    return {
      command: trimmed,
      scope: "website",
      dryRun: false,
      requiresConfirmation: false,
      executionType: "navigate",
      plannedAction: routeShortcut.action,
      executedAction: "Pending navigation",
      why: "You asked for a known workflow area that already exists in the app.",
      result: "Route is ready to open.",
      rollbackHint: "Use browser back or reopen the prior route.",
      route: routeShortcut.route,
      createdAt,
    };
  }

  if (/\b(refresh|sync|pull)\b.*\b(agentlink|leaderboard|numbers|deals)\b/i.test(trimmed)) {
    return {
      command: trimmed,
      scope: "metrics",
      dryRun: false,
      requiresConfirmation: false,
      executionType: "sync",
      plannedAction: "Refresh AgentLink deals and rebuild leaderboard snapshots",
      executedAction: "Pending sync",
      why: "This is a safe metrics refresh that improves accuracy without changing public copy.",
      result: "The live deal feed and leaderboard cache will be refreshed.",
      rollbackHint: "Re-run the sync after the upstream issue is resolved.",
      createdAt,
    };
  }

  if (/\b(system health|health check|run check)\b/i.test(trimmed)) {
    return {
      command: trimmed,
      scope: "admin",
      dryRun: false,
      requiresConfirmation: false,
      executionType: "health_check",
      plannedAction: "Run the system health check",
      executedAction: "Pending system check",
      why: "This is a read-mostly operational check.",
      result: "Health diagnostics will run and report back here.",
      rollbackHint: "No rollback needed; this is non-destructive.",
      createdAt,
    };
  }

  if (/\b(licensing blast|blast licensing|send licensing)\b/i.test(trimmed)) {
    return {
      command: trimmed,
      scope: "recruiting",
      dryRun: false,
      requiresConfirmation: true,
      executionType: "licensing_blast",
      plannedAction: "Send the licensing outreach blast",
      executedAction: "Confirmation required",
      why: "This sends public-facing communication to applicants.",
      result: "Awaiting confirmation before sending.",
      rollbackHint: "Cancel here if this should not be sent.",
      createdAt,
    };
  }

  if (/\b(status|what('?s| is) live|today'?s numbers|how are we doing)\b/i.test(trimmed)) {
    return {
      command: trimmed,
      scope: "metrics",
      dryRun: false,
      requiresConfirmation: false,
      executionType: "status_snapshot",
      plannedAction: "Build a quick status snapshot from live app data",
      executedAction: "Pending status pull",
      why: "This is a safe read-only summary request.",
      result: "Status snapshot will be generated here.",
      rollbackHint: "No rollback needed; this is read-only.",
      createdAt,
    };
  }

  if (/\b(delete|drop|truncate|alter|sql)\b/i.test(trimmed)) {
    return {
      command: trimmed,
      scope: "admin",
      dryRun: false,
      requiresConfirmation: true,
      executionType: "advanced_sql",
      plannedAction: "Move this into Advanced SQL",
      executedAction: "Confirmation required",
      why: "The command looks destructive or SQL-like.",
      result: "Use the Advanced SQL tab after confirming.",
      rollbackHint: "Review the statement before running it.",
      createdAt,
    };
  }

  return {
    command: trimmed,
    scope: "website",
    dryRun: false,
    requiresConfirmation: false,
    executionType: "queue_prompt",
    plannedAction: "Queue an implementation prompt for the executor",
    executedAction: "Pending prompt generation",
    why: "This looks like a website/content/system change request that should become an implementation task.",
    result: "A ready-to-run prompt will be generated and queued if the task inbox is available.",
    rollbackHint: "Delete or ignore the queued task if the request changes.",
    prompt: buildImplementationPrompt(trimmed),
    createdAt,
  };
}
