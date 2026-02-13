

# Update Expired Discord Link + Resend to Course Completers

## What's Wrong
Every email that includes a Discord invite link uses an **expired link** (`https://discord.gg/GygkGEhb`). This affects course completion emails, portal login emails, welcome emails, and more.

## Part 1: Update the Discord Link in All 6 Files

Replace `https://discord.gg/GygkGEhb` with `https://discord.gg/JpUWA73UZX` in:

1. `supabase/functions/notify-course-complete/index.ts` -- sent when agent finishes the course
2. `supabase/functions/welcome-new-agent/index.ts` -- sent when a new agent is added
3. `supabase/functions/notify-agent-live-field/index.ts` -- sent when agent moves to field training
4. `supabase/functions/send-course-enrollment-email/index.ts` -- sent when agent is enrolled in course
5. `supabase/functions/send-agent-portal-login/index.ts` -- sent with portal login credentials
6. `supabase/functions/send-bulk-portal-logins/index.ts` -- sent during bulk portal login blasts

## Part 2: Resend Course Completion Email to Recent Graduates

After deploying the fixed functions, trigger the `notify-course-complete` function for these 6 agents who recently passed the course (last 5 days):

| Name | Email |
|------|-------|
| Trae Edmond | traeyvon713@outlook.com |
| Johnivan Bush | jbbush3736@gmail.com |
| Lev Hills | levhills24@gmail.com |
| Jacob Causer | jcauser06@gmail.com |
| Brian Hernandez | bam2sleeze@outlook.com |
| Wayne Price | waynepricenew@gmail.com |

Each will receive the corrected course-complete email with the working Discord link, portal access info, and next steps.

## Files to Modify
- `supabase/functions/notify-course-complete/index.ts`
- `supabase/functions/welcome-new-agent/index.ts`
- `supabase/functions/notify-agent-live-field/index.ts`
- `supabase/functions/send-course-enrollment-email/index.ts`
- `supabase/functions/send-agent-portal-login/index.ts`
- `supabase/functions/send-bulk-portal-logins/index.ts`

