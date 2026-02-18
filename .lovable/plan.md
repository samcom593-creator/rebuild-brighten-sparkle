

# Two Changes: Quick Calendly Buttons + Re-send Bulk Licensing Emails

## Change 1: Replace Manual Link Paste with Two Calendly Buttons

Right now, after a call summary, you see a "Send Follow-Up Email" button and a small "Add calendar link" toggle that opens a text field where you have to manually paste a URL. Instead, this will be replaced with two clearly labeled buttons you can just tap:

- **"Licensed Link"** -- auto-fills the licensed Calendly link
- **"Unlicensed Link"** -- auto-fills the unlicensed Calendly link

Tapping either one will immediately send the follow-up email with the correct link. No pasting required.

### File Changed

| File | What Changes |
|------|-------------|
| `src/components/callcenter/CallCenterVoiceRecorder.tsx` | Remove the "Add calendar link" toggle and text input. Replace with two buttons: "Send (Licensed)" and "Send (Unlicensed)" that each call `onSendFollowUp` with the appropriate Calendly URL pre-filled. The links used will match the ones already in the backend: `calendly.com/apexlifeadvisors/15-minute-discovery` for licensed and `calendly.com/apexlifeadvisors/15min` for unlicensed. |

### How It Will Look

Instead of:
```
[Send Follow-Up Email]  [Add calendar link]
                        [___paste link here___]
```

It becomes:
```
[Send Licensed Follow-Up]   [Send Unlicensed Follow-Up]
```

Each button sends the email with the correct Calendly link automatically.

---

## Change 2: Re-send Bulk Licensing Emails

After fixing the buttons above, I will trigger the `bulk-send-licensing` function again to re-send licensing instruction emails to all ~70 unlicensed/pending applicants (oldest first, 1 per second). This is the same function we fixed and deployed last time -- it just needs to be called again.

