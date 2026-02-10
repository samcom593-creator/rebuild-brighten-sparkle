

# Fix "Free Leads" Language and Allow Importing Leads Without Email/Phone

## Two Changes

### 1. Replace All "Free Leads" References with "Unlimited Warm Leads"

Every instance of "free leads" across the codebase will be updated. The aged lead email also needs to acknowledge that these people previously applied.

| File | Current Text | New Text |
|------|-------------|----------|
| `supabase/functions/send-aged-lead-email/index.ts` | "Free warm leads provided daily" | "Unlimited warm leads provided daily" |
| `supabase/functions/send-aged-lead-email/index.ts` | "A new remote sales position just opened up..." (generic opener) | "You applied to Apex Financial before, and we wanted to reach back out..." (personalized re-engagement) |
| `supabase/functions/send-outreach-email/index.ts` | "Free leads provided daily" | "Unlimited warm leads provided daily" |
| `supabase/functions/send-licensing-instructions/index.ts` | "Free warm leads to start calling" | "Unlimited warm leads to start calling" |
| `src/components/dashboard/AgedLeadEmailPreview.tsx` | "Free warm leads provided daily" | "Unlimited warm leads provided daily" |
| `src/components/landing/CareerPathwaySection.tsx` | "Start Working Free Real-Time Leads" | "Start Working Unlimited Warm Leads" |
| `src/components/landing/FAQSection.tsx` | "provide free leads to get started" | "provide unlimited warm leads to get started" |
| `src/pages/ScheduleCall.tsx` | "Free leads daily" | "Unlimited warm leads daily" |

The aged lead email subject and body will also be updated to reference that they previously applied, making it a re-engagement email rather than a cold outreach.

### 2. Allow Importing Leads Missing Email or Phone

Currently, leads without BOTH email AND phone are marked invalid and skipped. Many aged leads only have one contact method.

**Change in `src/components/dashboard/AgedLeadImporter.tsx`**:
- Relax validation: a lead is valid if it has a first name AND at least one of email or phone (instead of requiring both)
- Leads with neither email nor phone remain invalid
- The `aged_leads` table already allows nullable email/phone, but the current column `email` is `NOT NULL` -- we need a migration to make it nullable

**Database migration**:
```sql
ALTER TABLE aged_leads ALTER COLUMN email DROP NOT NULL;
```

This allows importing leads that only have a phone number. Emails will only be sent to leads that have an email address (the send logic already checks for email).

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/send-aged-lead-email/index.ts` | Update copy: remove "free", add "you applied before" context |
| `supabase/functions/send-outreach-email/index.ts` | Replace "Free leads" with "Unlimited warm leads" |
| `supabase/functions/send-licensing-instructions/index.ts` | Replace "Free warm leads" with "Unlimited warm leads" |
| `src/components/dashboard/AgedLeadEmailPreview.tsx` | Update preview copy to match edge function |
| `src/components/landing/CareerPathwaySection.tsx` | Replace "Free Real-Time Leads" with "Unlimited Warm Leads" |
| `src/components/landing/FAQSection.tsx` | Replace "free leads" with "unlimited warm leads" |
| `src/pages/ScheduleCall.tsx` | Replace "Free leads daily" with "Unlimited warm leads daily" |
| `src/components/dashboard/AgedLeadImporter.tsx` | Relax validation to require email OR phone (not both) |
| Database migration | Make `aged_leads.email` nullable |

