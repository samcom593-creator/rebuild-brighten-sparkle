/**
 * task CLI — minimal arg parser, no external deps. Subcommands:
 *   task add "title" [--list X] [--due today|tomorrow|YYYY-MM-DD] [--priority urgent|high|medium|low] [--tag t1] [--tag t2]
 *   task list [--list X] [--status open|in_progress|done]
 *   task done <id>
 *   task push   — push local → Reminders + Supabase
 *   task pull   — pull Reminders + Supabase → local
 *   task sync   — full bidirectional reconcile
 *
 * Run via:  npx tsx tasks/cli.ts <subcommand> ...args
 *           bun run tasks/cli.ts <subcommand> ...args
 */
import {
  Task,
  TaskList,
  TaskPriority,
  TaskStatus,
  ALL_LISTS,
  DEFAULTS,
  PRIORITY_RANK,
  inferList,
} from "./schema.js";
import {
  loadStore,
  saveStore,
  rebuildTodayMd,
  syncAll,
  pushToSupabase,
  pullFromSupabase,
  pushToReminders,
  pullReminders,
  markRemindersCompleted,
} from "./sync.js";

function uuid(): string {
  // @ts-ignore
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseDue(input: string | undefined): string | null {
  if (!input) return null;
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (input === "today") return fmt(today);
  if (input === "tomorrow") {
    const t = new Date(today);
    t.setDate(t.getDate() + 1);
    return fmt(t);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) return input.slice(0, 10);
  // Allow "+3d" etc.
  const m = input.match(/^\+(\d+)d$/);
  if (m) {
    const t = new Date(today);
    t.setDate(t.getDate() + parseInt(m[1]!, 10));
    return fmt(t);
  }
  return null;
}

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | string[] | boolean>;
}
function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, any> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        if (flags[key] === undefined) flags[key] = next;
        else if (Array.isArray(flags[key])) (flags[key] as string[]).push(next);
        else flags[key] = [flags[key] as string, next];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function usage() {
  console.log(`Usage: task <add|list|done|push|pull|sync> [args]

  add "title" [--list X] [--due today|tomorrow|YYYY-MM-DD|+Nd] [--priority low|medium|high|urgent] [--tag t1] [--tag t2]
  list [--list X] [--status open|in_progress|done|cancelled]
  done <id-prefix>
  push
  pull
  sync
`);
}

async function cmdAdd(args: ParsedArgs) {
  const title = args.positional.slice(1).join(" ").trim();
  if (!title) {
    console.error("title required");
    process.exit(2);
  }
  const tagsRaw = args.flags["tag"];
  const tags = Array.isArray(tagsRaw) ? tagsRaw : tagsRaw && typeof tagsRaw === "string" ? [tagsRaw] : [];
  const list = (args.flags.list as TaskList) || inferList(title);
  if (!ALL_LISTS.includes(list)) {
    console.error(`unknown --list "${list}"; must be one of: ${ALL_LISTS.join(", ")}`);
    process.exit(2);
  }
  const priority = ((args.flags.priority as TaskPriority) || DEFAULTS.priority);
  const due = parseDue(args.flags.due as string | undefined);
  const t: Task = {
    id: uuid(),
    title,
    list,
    due,
    priority,
    tags,
    status: "open",
    source: "cli",
    reminderExternalId: null,
    supabaseId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
  const store = loadStore();
  store.tasks.push(t);
  saveStore(store);
  rebuildTodayMd(store.tasks);
  console.log(`✓ added ${t.id.slice(0, 8)}  [${t.list}]  ${t.title}${t.due ? "  @" + t.due : ""}`);
}

function cmdList(args: ParsedArgs) {
  const store = loadStore();
  const filterList = args.flags.list as TaskList | undefined;
  const filterStatus = args.flags.status as TaskStatus | undefined;
  const filtered = store.tasks
    .filter((t) => (filterList ? t.list === filterList : true))
    .filter((t) => (filterStatus ? t.status === filterStatus : t.status !== "done" && t.status !== "cancelled"))
    .sort((a, b) => {
      const p = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
      if (p !== 0) return p;
      return (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31");
    });

  if (filtered.length === 0) {
    console.log("(no matching tasks)");
    return;
  }
  for (const t of filtered) {
    const status = { open: "○", in_progress: "◐", blocked: "✕", done: "✓", cancelled: "−" }[t.status] || "?";
    const due = t.due ? ` ${t.due.slice(0, 10)}` : "       ";
    const tagsStr = t.tags.length ? "  " + t.tags.map((tag) => `#${tag}`).join(" ") : "";
    console.log(`${status} ${t.id.slice(0, 8)}  ${t.priority.padEnd(7)} ${t.list.padEnd(11)} ${due}  ${t.title}${tagsStr}`);
  }
  console.log(`\n${filtered.length} task(s)`);
}

function cmdDone(args: ParsedArgs) {
  const idPrefix = args.positional[1];
  if (!idPrefix) {
    console.error("usage: task done <id-prefix>");
    process.exit(2);
  }
  const store = loadStore();
  const matches = store.tasks.filter((t) => t.id.startsWith(idPrefix));
  if (matches.length === 0) {
    console.error(`no task starting with ${idPrefix}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`ambiguous prefix; matches ${matches.length} tasks`);
    process.exit(1);
  }
  const t = matches[0]!;
  t.status = "done";
  t.completedAt = new Date().toISOString();
  t.updatedAt = new Date().toISOString();
  if (t.reminderExternalId) markRemindersCompleted(t.reminderExternalId);
  saveStore(store);
  rebuildTodayMd(store.tasks);
  console.log(`✓ done  ${t.id.slice(0, 8)}  ${t.title}`);
}

async function cmdPush() {
  const store = loadStore();
  // Apple Reminders: only push tasks without an external id and still open
  if (process.platform !== "darwin") {
    console.log("[push] non-macOS — Reminders push skipped (no-op)");
  } else {
    let pushed = 0;
    for (const t of store.tasks) {
      if (t.status === "open" && !t.reminderExternalId) {
        const id = pushToReminders(t);
        if (id) {
          t.reminderExternalId = id;
          t.updatedAt = new Date().toISOString();
          pushed++;
        }
      }
    }
    console.log(`[push] reminders: ${pushed} new`);
  }
  await pushToSupabase(store.tasks);
  saveStore(store);
  rebuildTodayMd(store.tasks);
  console.log(`[push] supabase: synced ${store.tasks.length} tasks`);
}

async function cmdPull() {
  const store = loadStore();
  if (process.platform !== "darwin") {
    console.log("[pull] non-macOS — Reminders pull skipped (no-op)");
  } else {
    const rems = pullReminders();
    console.log(`[pull] reminders: ${rems.length} items returned`);
  }
  const cloud = await pullFromSupabase();
  console.log(`[pull] supabase: ${cloud.length} rows`);
  // Delegate full reconcile to syncAll which writes back to file
  await syncAll();
  console.log("[pull] reconcile complete");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args.positional[0];
  switch (cmd) {
    case "add": await cmdAdd(args); break;
    case "list": cmdList(args); break;
    case "done": cmdDone(args); break;
    case "push": await cmdPush(); break;
    case "pull": await cmdPull(); break;
    case "sync": {
      const tasks = await syncAll();
      console.log(`✓ sync complete — ${tasks.length} tasks`);
      break;
    }
    default:
      usage();
      process.exit(cmd ? 2 : 0);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
