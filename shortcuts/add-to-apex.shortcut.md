# Shortcut: Add to APEX

A Siri-friendly capture flow that takes dictated text on iPhone or Mac and drops the resulting Reminder into the right APEX list. Apple Shortcuts cannot be checked in as plain text, so this doc walks you through building it once on either device and iCloud-syncing.

> **Limitation up front:** the Shortcut writes to Apple Reminders only. The metadata round-trip (tags, status, source flags) happens later when `tasks sync` runs on the Mac and reconciles the Reminder back into `tasks.json` + `public.agent_inbox`.

## Build steps (iPhone or Mac)

1. Open the **Shortcuts** app → **+** to create a new Shortcut.
2. Tap the title and rename it to **`Add to APEX`** (this is the phrase Siri matches).
3. Add the actions in this order:

### Action 1 — Dictate Text
- *Dictate Text* (from the Scripting category)
- Stop Listening: **On Tap** (or **After Pause** if you prefer)

### Action 2 — Set Variable: `text`
- *Set Variable* → name `text` → value: the **Dictated Text** output of action 1.

### Action 3 — If text contains "alarm"
- *If* → Input: `text`, Condition: **contains**, Value: **alarm**
- (We'll branch later inside this `If` to add an alarm.)

### Action 4 — Decide list (nested If/Else inside the previous If, or as a separate If)
Add four chained *If* actions checking for keywords (case-insensitive):
| Keyword group | List |
|---|---|
| `recruit`, `agent`, `hire`, `onboard`, `applicant` | Recruiting |
| `build`, `code`, `bug`, `website`, `crm`, `deploy` | Build |
| `follow up`, `follow-up`, `call back`, `text`, `client`, `reply` | Follow-ups |
| (default — *Otherwise* branch) | APEX-Daily |

For each branch, set a variable `list` to the matching list name.

### Action 5 — Parse simple time phrases (optional)
- *If* `text` **contains** `tomorrow` → set variable `due` to **Tomorrow** (use *Get Tomorrow's Date*).
- *Else If* `text` **contains** any of `today`, `now`, `tonight` → set variable `due` to **Today** (*Current Date*).
- *Else If* `text` matches regex `at (\d{1,2})(:\d{2})?\s*(am|pm)` → use *Date* with parsed components.
- *Else* leave `due` empty.

### Action 6 — Create Reminder
- *Add New Reminder*
- Title: `text`
- List: variable `list`
- If `due` is set: Remind Me, *At Time*: `due`
- Priority: leave default unless you parsed an explicit "urgent"/"high" word
- Notes: literal string `source=siri` (so the Mac sync can later flag the source)

### Action 7 — Inside the original "if alarm" branch
- *Set Alarm* using the parsed `due` time + the Reminder title.

### Action 8 — Speak the confirmation
- *Speak Text*: `Added "[text]" to [list].`

4. Save the Shortcut.
5. Test it from inside the Shortcuts app, then say **"Hey Siri, Add to APEX"** to confirm voice routing works. iCloud Sync to your Mac is automatic if you're signed into the same Apple ID — open the Mac Shortcuts app to verify it appears.

## Optional: invoke from a URL

Once the Shortcut exists, you can also fire it from anywhere via the URL scheme:

```
shortcuts://run-shortcut?name=Add+to+APEX&input=text&text=Follow%20up%20with%20Brennan%20tomorrow
```

That URL is what we use from VS Code's **Tasks: Add Reminder** task on Macs (if you'd rather skip the CLI entry). On non-Mac hosts the URL scheme is meaningless and the CLI path takes over.

## Where each piece of metadata lives

| Metadata | Apple Reminders | tasks.json / Supabase |
|---|---|---|
| Title | ✅ | ✅ |
| Due | ✅ | ✅ |
| List | ✅ (one of four) | ✅ |
| Source (`siri`/`cli`/`vscode`) | only via "source=" line in body | ✅ authoritative |
| Tags | only via "tags=" line in body | ✅ authoritative |
| Priority | not portable round-trip | ✅ authoritative |
| Status (open/in_progress/blocked/done) | only completed bool | ✅ authoritative |

So the Siri shortcut is intentionally simple — it only handles list routing and due dates. Everything else fills in when the Mac runs `task sync`.
