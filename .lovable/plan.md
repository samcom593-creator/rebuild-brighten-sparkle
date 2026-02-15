

# Fix Application Emails, Manager Notifications, Growth Calculation, and Abandoned Follow-ups

## What's Changing

### 1. Manager's Own Email (the manager who got the recruit)
The current `sendManagerNotification` in `submit-application/index.ts` already sends the assigned manager full recruit info. However, it's missing dedicated action buttons. Will add:
- **View IG** button (links to recruit's Instagram profile, only shown if IG handle exists)
- **Call Now** button (prominent tel: link styled as a button)
- **View Lead** button (links to the applicant dashboard page)

These will replace the current inline text links with proper mobile-friendly CTA buttons at the bottom of the email.

### 2. All-Managers Broadcast Email (everyone else)
The current `notify-all-managers-leaderboard` function sends a generic "X scored another recruit!" email to all managers. Will update to:
- Include the recruit's name: "[Manager] just got a new recruit: [Recruit Name]!"
- Add the $7K growth calculation: "estimated potential override growth of $7,000"
- Show a daily leaderboard summary: which manager recruited the most that day, with total estimated value (recruits x $7,000)
- Keep it clean and motivational per the existing email standards

### 3. Send Re-apply Links to All Abandoned Partial Applications
There are 4 unconverted partial applications in the database. Will invoke the `send-abandoned-followup` function for each one that has an email and hasn't already received a follow-up (checking `form_data->followup_sent_at`). This sends them a "Complete My Application" email with a direct link to /apply.

## Technical Changes

### File: `supabase/functions/submit-application/index.ts` (lines 200-270)
Update `sendManagerNotification` to add three CTA buttons after the applicant details table:
- "View Instagram" button (conditional on instagramHandle existing) linking to `https://instagram.com/{handle}`
- "Call Now" button linking to `tel:{phone}`
- "View Lead" button linking to `https://apex-financial.org/dashboard/applicants?lead={applicationId}`

Styled as table-based buttons (mobile-safe, no flexbox per email standards).

### File: `supabase/functions/notify-all-managers-leaderboard/index.ts`
Update `sendLeaderboardEmail` to:
- Accept and display the recruit's name in the email body
- Add the $7K estimated value calculation: "That's an estimated $7,000 in potential override value!"
- Update the subject line to include the recruit name: "[Manager] just recruited [Name]!"
- For organic leads: "New organic lead: [Name] -- estimated $7,000 in potential override value"
- Pass `applicantName` through from the handler to the email function

### Action: Trigger abandoned follow-ups
After deploying, invoke `send-abandoned-followup` for each unconverted partial application that has an email and no prior follow-up sent. There are 2 eligible leads (the ones without `followup_sent_at`).

## Files to Modify
1. `supabase/functions/submit-application/index.ts` -- Add IG/Call/View buttons to manager email
2. `supabase/functions/notify-all-managers-leaderboard/index.ts` -- Add recruit name and $7K growth calculation
3. Deploy both functions and trigger abandoned follow-ups
