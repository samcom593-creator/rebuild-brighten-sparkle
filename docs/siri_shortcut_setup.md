# Siri → APEX — 30-second install

Once this is set up, every `"Hey Siri, APEX [anything]"` command lands on the APEX backend, gets parsed, and creates calendar events / notes / reminders / status queries.

## One-time setup on your iPhone

1. Open the **Shortcuts** app (pre-installed on iOS).
2. Tap the **+** to create a new Shortcut.
3. Add these actions in order:

   **① Dictate Text**
   - Default: *(leave blank — Siri fills it via voice)*
   - Language: English (United States)
   - Stop Listening: On Tap

   **② Get Contents of URL**
   - URL: `https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/siri-command`
   - Method: **POST**
   - Headers:
     - `Authorization`: `Bearer 5638a395fb54c325cb8579168592b53d4db435eb000c5d24`
     - `Content-Type`: `application/json`
   - Request Body: **JSON**
     - `command`: (Magic Variable) Dictated Text
     - `source`: `siri`

   **③ Get Dictionary Value**
   - Dictionary: (Magic Variable) Contents of URL
   - Key: `spoken`

   **④ Speak Text**
   - Text: (Magic Variable) Dictionary Value
   - Rate: Default
   - Voice: Default

4. Tap the shortcut name at top → rename to **APEX**
5. Tap the settings gear → "Add to Siri" → record phrase "**APEX**" or "**Hey APEX**"
6. Done. Save.

## What you can say

| Say this | What happens |
|---|---|
| "APEX, schedule a call with Joe tomorrow at 2pm" | Creates a calendar_event, emails you a confirmation, Siri reads back the time |
| "APEX, remind me to follow up with Kim in 30 minutes" | Creates a reminder event, shows in your notifications |
| "APEX, note to self the NJ licensing meeting is delayed" | Saves to your APEX notifications inbox |
| "APEX, what's today's numbers?" | Siri speaks: "Today: X deals. Month to date: $Y. Open applications: Z." |
| "APEX, schedule recruiter chat with Sarah Friday 10:30am" | Full schedule flow |

## Where the events show up

- **APEX:** `/dashboard` — any `calendar_events` row with `source='siri'` renders as a calendar chip
- **Email:** confirmation from `sam@apex-financial.org` with the event time in CT (after you set `siri_confirm_email` in system_settings)
- **Discord:** no spam — Siri commands don't route to Discord unless you tell them to
- **Your phone calendar:** the shortcut can *also* pipe into your iOS Calendar — add an "Add Event" action as a 5th step if you want iOS-native calendar too

## Optional: auto-sync to Google Calendar

If you've wired the `google_calendar_refresh_token` in system_settings, the `siri-command` endpoint can mirror to Google Calendar too. Currently off until you drop the token. Ask me to wire when ready.

## Security

- Token is stored in `system_settings.siri_shortcut_token` — rotate by running `UPDATE public.system_settings SET value = encode(gen_random_bytes(24),'hex') WHERE key='siri_shortcut_token';`
- The endpoint rate-limits on its own via Supabase edge function caps.
- Don't commit the bearer to git. It lives in Supabase only.

## Test from terminal (before Shortcut install)

```bash
curl -X POST https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/siri-command \
  -H "Authorization: Bearer 5638a395fb54c325cb8579168592b53d4db435eb000c5d24" \
  -H "Content-Type: application/json" \
  -d '{"command":"Schedule call with Joe tomorrow at 2pm","source":"terminal"}'
```

Expected: `{"ok":true,"spoken":"Scheduled Call with joe for Thu, Apr 24, 2:00 PM Central time."}`
