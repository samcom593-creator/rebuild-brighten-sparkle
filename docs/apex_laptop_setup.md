# APEX laptop command runner (the Siri-without-Siri setup)

Works on your macOS laptop **right now** — doesn't need the `siri-command` edge function to deploy, hits Supabase directly via bot-sql.

## What got installed

- `~/bin/apex` — the Python command parser + DB writer + `say` speaker
- `~/bin/apex-voice` — a shell wrapper that shows a prompt dialog
- `~/.zshrc` updated with `export PATH="$HOME/bin:$PATH"`

## Try it right now (new terminal)

```bash
apex "what's today's numbers"
apex "schedule call with Joe tomorrow 2pm"
apex "remind me to call Kim in 30 minutes"
apex "note to self the Aetna contract needs review"
```

Each one writes to Supabase (`public.calendar_events` or `public.notifications`) and speaks the confirmation.

## Hands-free / Siri voice

Three ways to bind:

### Option A — Siri Shortcut (recommended, 60 seconds)

1. Open **Shortcuts** app on this Mac (`⌘Space → Shortcuts`)
2. Click **+** (new shortcut)
3. Add one action: **Run Shell Script**
   - Shell: `/bin/zsh`
   - Pass input: *nothing*
   - Script:
     ```
     /Users/samjames/bin/apex-voice
     ```
4. Tap the shortcut name at top → rename to **APEX**
5. Settings gear → **Add to Siri** → record phrase "APEX"
6. Done. Say **"Hey Siri, APEX"** → it prompts for a command → runs it → speaks back.

### Option B — Global hotkey

System Settings → Keyboard → Keyboard Shortcuts → Services. Or bind via **Raycast** / **Alfred** / **BetterTouchTool** to `/Users/samjames/bin/apex-voice`.

### Option C — Just Terminal (already works)

Open any terminal tab and type `apex "..."`. Done.

## What works today (all verified live)

| Phrase | What happens |
|---|---|
| `schedule call with X tomorrow 2pm` | Creates calendar_event Fri 14:00 CT |
| `schedule meeting with X friday 10:30am` | Fri 10:30 CT |
| `book time with X next tuesday 3pm` | Next Tue 15:00 CT |
| `schedule a chat with X in 2 hours` | Today +2h |
| `remind me to Y in 30 minutes` | Reminder +30m |
| `remind me to Y tomorrow at 11am` | Reminder tomorrow 11:00 |
| `note to self Z` | Row in notifications inbox |
| `what's today's numbers` | Siri reads MTD ALP, active deals, open apps |

## Where rows land

- `public.calendar_events` with `source='siri'`
- `public.notifications` (notes, unknown commands saved for re-parse)
- `trg_siri_notify` auto-logs each event to admin users' inbox

## When you eventually want iOS Siri too

Same instructions as this doc but for iPhone Shortcuts — already written at `docs/siri_shortcut_setup.md`. The iPhone version goes through the edge function which needs a deploy; the laptop version bypasses it.

## Updating the script

The committed source lives at `scripts/apex-laptop.py`. To update your local copy after pulling:

```bash
cp scripts/apex-laptop.py ~/bin/apex
cp scripts/apex-voice.sh ~/bin/apex-voice
chmod +x ~/bin/apex ~/bin/apex-voice
```

## Token rotation

The bearer token is hardcoded in `~/bin/apex` (the bot-sql token — see `apex-bot-credentials.md`). If you rotate it, update the `BOT_SQL_TOKEN` constant and you're done — no redeploy required.
