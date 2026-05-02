# tasks/

A unified, execution-focused task system that captures from Siri, iPhone Apple Reminders, VS Code, the CLI, and the CRM UI. Local file (`tasks.json`) is the cache + CLI source. Supabase (`public.agent_inbox`) is the system of record for the CRM and React UI. Apple Reminders is a one-way-ish bridge so Siri/iPhone capture works.

## Files

| File | Purpose |
|---|---|
| `tasks.json` | Local cache; CLI reads/writes here directly |
| `schema.ts` | Single source of truth for the `Task` type + helpers (`fingerprint`, `inferList`) |
| `sync.ts` | Bridges tasks.json ↔ Apple Reminders ↔ Supabase |
| `cli.ts` | `task` command implementation |
| `today.md` | Auto-generated daily view |
| `README.md` | This file |

## Quick start

```bash
# from repo root
bun run tasks/cli.ts add "Call back Brennan tomorrow" --list Follow-ups --due tomorrow --priority high
bun run tasks/cli.ts list
bun run tasks/cli.ts sync
```

If `bun` is not your daily driver, swap for `npx tsx tasks/cli.ts ...`.

For a shorter alias, drop into your shell rc:

```bash
alias task="bun run $(pwd)/tasks/cli.ts"
```

## CLI commands

| Command | What it does |
|---|---|
| `task add "title" [--list X] [--due today\|tomorrow\|YYYY-MM-DD\|+Nd] [--priority urgent\|high\|medium\|low] [--tag t1] [--tag t2]` | Add a task |
| `task list [--list X] [--status open\|in_progress\|done\|cancelled]` | List tasks |
| `task done <id-prefix>` | Mark a task done (also flips Apple Reminder) |
| `task push` | Push open tasks → Reminders, all tasks → Supabase |
| `task pull` | Pull from Reminders + Supabase, reconcile into local file |
| `task sync` | Full bidirectional reconcile (run this most often) |

If `--list` is omitted, it's inferred from keywords in the title (`recruit/agent/hire` → Recruiting, `build/code/bug` → Build, `follow up/text/client` → Follow-ups, otherwise `APEX-Daily`).

## Lists

Hard-coded to four:
- `APEX-Daily`
- `Recruiting`
- `Build`
- `Follow-ups`

Add new lists by extending `ALL_LISTS` in `schema.ts` and creating the matching list in Apple Reminders (the sync code creates them on first push).

## macOS Apple Reminders integration

We use AppleScript via `osascript`. **AppleScript exposes only a small subset of Reminders state — name, body, due date, completed flag, list, item id.** Anything richer (tags, priority round-trip, status beyond done/not-done) is stored in `tasks.json` + `public.agent_inbox` and bridged via the body field where helpful.

- On non-macOS hosts the Reminders bridge is a clean no-op (logged + exit 0).
- Match strategy: prefer `reminderExternalId`. Fall back to `(list, due-day, lowercased title)` fingerprint.

## Supabase integration

- Table: `public.agent_inbox` (see migration `supabase/migrations/<ts>_create_agent_inbox.sql`)
- RLS: each row owned by `auth.uid()`; users only see/edit their own.
- Required env (any of these): `SUPABASE_URL` + (`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`), or the Vite-prefixed equivalents (`VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`).

If env vars aren't set, the cloud sync is a clean no-op (warning printed, local + Reminders still work).

## Siri capture (iPhone) — `shortcuts/add-to-apex.shortcut.md`

Manual setup required because Apple's Shortcut format isn't a portable text file. The doc walks you through building a Shortcut named **Add to APEX** that:
1. Accepts dictated text
2. Routes to the right list by keyword
3. Creates an Apple Reminder
4. Optionally sets an alarm

Once running, just say **"Hey Siri, Add to APEX, follow up with Brennan tomorrow at 2pm"** and it lands in the *Follow-ups* list with the right due date.

## VS Code integration

`.vscode/extensions.json` recommends:
- `wayou.vscode-todo-highlight` (for `// TODO: ...` comments)
- `Gruntfuggly.todo-tree` (sidebar view of TODOs)
- *No first-party Apple Reminders extension exists in the marketplace as of writing — flagged here as a limitation.*

`.vscode/tasks.json` exposes:
- **Add Reminder** — prompts for a title and a list, calls `task add`
- **Pull Today's Reminders** — `task pull` and opens `tasks/today.md`
- **Sync All** — `task sync`

## CRM UI

`src/components/TaskInbox.tsx` reads `agent_inbox` directly, groups by list, sorts by priority + due, has a one-click complete button. Drop it into a route or sidebar slot:

```tsx
import { TaskInbox } from "@/components/TaskInbox";

export default function Page() {
  return <TaskInbox />;
}
```

## Limitations explicitly called out

1. **Apple Reminders has no public REST API.** This module uses AppleScript via `osascript` on macOS only. Linux/Windows/CI should set `SKIP_REMINDERS=1` or just expect the no-op log line.
2. **Shortcut import is manual.** There is no clean text format for `.shortcut` files; the markdown doc enumerates the steps. After building once you can share `.shortcut` files via iCloud.
3. **Tag round-trip with Reminders is partial.** We embed tags in the Reminder's body field (`tags=foo,bar`); the source of truth stays JSON/Supabase.
4. **AppleScript date parsing is finicky.** We pass through `date` shell command for ISO → epoch conversion.
5. **No first-party VS Code Reminders extension exists** that I've validated. The recommended extensions cover TODO highlighting but not iCloud Reminders.
