# Multi-device / Multi-surface (Section 9)

Sam works from phone, iPad, Meta glasses, multiple laptops.

## iPad / Meta glasses / phone

Nothing to change — whatever works on desktop claude.ai works on those surfaces. Admin pages (widest tables) use `max-w-5xl mx-auto` + `overflow-x-auto` on every table.

## Claude Code on a second device

Same setup each time:
1. Clone `samcom593-creator/rebuild-brighten-sparkle`
2. Anthropic auth
3. Copy `.env` (contains anon key only — no secrets)
4. Start a terminal in the repo root

No multi-device sync layer needed — **git is the sync layer**. Commit often, branch per feature, rebase before pushing.

## Session continuity

Every non-trivial change writes a one-paragraph summary to `/Users/<you>/.claude/projects/-Users-<you>/memory/*.md` so future Claude instances can pick up without re-reading the repo. The memory file `MEMORY.md` is loaded into every conversation automatically.

Current memory files:
- `apex_bot_sql_access.md` — bot-sql token + endpoint
- `apex_agent_link_live_pull.md` — Agent Link cookie decrypt recipe
- `apex_status_sync_fix.md` — why "submitted" numbers feel off (upstream null status)
