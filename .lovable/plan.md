

# Fix Broken Email Links + Bulk Resend to All Unlicensed Applicants

## Problem
The licensing instructions email uses CSS `display: flex` and `display: inline-flex` -- these are **not supported** by most mobile email clients (Gmail app, Apple Mail, Outlook). This makes the numbered step headers and links unclickable or invisible on phones.

There are currently **63 unlicensed/pending applicants** who need this email resent with working links.

## Part 1: Fix the Email Template

**File: `supabase/functions/send-licensing-instructions/index.ts`**

Replace all `display: flex` and `display: inline-flex` layouts with **table-based layouts** (the only universally supported email layout method). Specific changes:

- Replace the 3 step header `<div style="display: flex">` blocks with `<table>` rows containing numbered circles and step titles
- Convert all 3 text links ("Watch Licensing Overview", "Open Licensing Guide", "Start Course Now") into **large, full-width CTA buttons** using `<table>` with `<a>` tags -- big tap targets that are impossible to miss on mobile
- Add `text-decoration: underline` as a fallback on all link text
- Ensure the Calendly "Need Help?" button also uses the table-based button pattern
- Keep the same colors, branding, and content -- just fix the HTML structure

Each step card will look like:
```
[Numbered circle] [Step Title]        <-- table row, not flexbox
Description text                      <-- paragraph
[====== BIG CTA BUTTON ======]        <-- table-based button, full width
```

## Part 2: Bulk Resend Edge Function

**New file: `supabase/functions/bulk-send-licensing/index.ts`**

Create a new edge function that:
1. Queries all applications where `license_status` is `unlicensed` or `pending`
2. For each one, calls the existing `send-licensing-instructions` function logic (sends the email with proper CC to admin + manager)
3. Returns a summary of how many were sent and any failures
4. Requires admin authentication to prevent abuse

## Part 3: Trigger the Bulk Send

After deploying the fixed template and bulk send function, invoke it once to send the corrected email to all 63 unlicensed/pending applicants immediately.

## Files to Modify/Create
1. **`supabase/functions/send-licensing-instructions/index.ts`** -- Fix email HTML (flexbox to tables, links to buttons)
2. **`supabase/functions/bulk-send-licensing/index.ts`** -- New edge function to blast to all unlicensed applicants

