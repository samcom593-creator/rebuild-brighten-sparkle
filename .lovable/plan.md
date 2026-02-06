

# Plan: Fix Emails & Optimize Call Center Timeline

## Summary

Fix three issues in the Call Center:

1. **Emails not sending** - Edge function only checks `applications` table, but Call Center also has leads from `aged_leads`
2. **2-week countdown logic** - Should only start from first contact, not from lead creation date
3. **Missing time info** - Need to show: when lead came in, first contact, and last contact

---

## Issues Found

### 1. Email Sending Bug

**Root Cause:** The `send-outreach-email` edge function (line 667-674) only queries the `applications` table:

```typescript
const { data: application, error: appError } = await supabase
  .from("applications")
  .select("*")
  .eq("id", applicationId)
  .single();
```

When `QuickEmailMenu` is used on an aged lead, the `applicationId` is actually an `aged_leads` ID, so the query fails with "Application not found".

**Solution:** Update the edge function to:
1. Accept a `leadSource` parameter ("applications" | "aged_leads")
2. Query the correct table based on source
3. Update `QuickEmailMenu` to pass the `leadSource` from the lead data

### 2. Timeline Countdown Logic

**Current Logic (incorrect):** Countdown starts from `createdAt` (when lead was added to system)

**Correct Logic:** 
- Countdown should only start after first contact (`contactedAt`)
- If not yet contacted, show "Contact to start 2-week timer" instead of countdown

### 3. Missing Time Information

**Current Display:**
- Only shows "Added X ago"
- Shows "Last contact: MMM d" if contacted

**New Display:**
- Lead Added: Full date/time
- First Contact: Full date/time (if exists)
- Last Contact: Full date/time (if exists, and different from first)

**Database:** Need to add `last_contacted_at` column to both tables to track last contact separately from first contact.

---

## Files to Modify

### 1. Database Migration

Add `last_contacted_at` column to both tables:

```sql
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;
```

### 2. `supabase/functions/send-outreach-email/index.ts`

**Changes:**
- Add `leadSource` parameter to the request body
- Query the correct table based on source
- Handle both `applications` and `aged_leads` tables

```typescript
const { applicationId, agentId, templateType, customSubject, customBody, leadSource } = await req.json();

// Determine which table to query
const tableName = leadSource === "aged_leads" ? "aged_leads" : "applications";

const { data: lead, error: leadError } = await supabase
  .from(tableName)
  .select("*")
  .eq("id", applicationId)
  .single();
```

### 3. `src/components/dashboard/QuickEmailMenu.tsx`

**Changes:**
- Add `leadSource` prop to component interface
- Pass `leadSource` in the edge function call

```typescript
interface QuickEmailMenuProps {
  applicationId: string;
  agentId: string | null;
  licenseStatus: "licensed" | "unlicensed" | "pending";
  recipientEmail: string;
  recipientName: string;
  leadSource?: "aged_leads" | "applications";  // NEW
  onEmailSent?: () => void;
  className?: string;
}

// In handleSendEmail:
const { error } = await supabase.functions.invoke("send-outreach-email", {
  body: { 
    applicationId, 
    agentId, 
    templateType: selectedTemplate,
    customSubject,
    customBody,
    leadSource,  // NEW
  },
});
```

### 4. `src/components/callcenter/CallCenterLeadCard.tsx`

**Changes:**
- Pass `leadSource={lead.source}` to `QuickEmailMenu`
- Update time display section to show all three timestamps

```tsx
<QuickEmailMenu
  applicationId={lead.id}
  agentId={null}
  licenseStatus={...}
  recipientEmail={lead.email}
  recipientName={...}
  leadSource={lead.source}  // NEW
/>
```

**Update time info section:**
```tsx
{/* Time Info - All three timestamps */}
<motion.div variants={itemVariants} className="space-y-1 text-sm">
  <div className="flex items-center gap-1.5 text-muted-foreground">
    <Clock className="h-3.5 w-3.5" />
    <span>Lead Added:</span>
    <span className="text-foreground">{format(new Date(lead.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
  </div>
  
  {lead.contactedAt && (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <Phone className="h-3.5 w-3.5 text-green-500" />
      <span>First Contact:</span>
      <span className="text-foreground">{format(new Date(lead.contactedAt), "MMM d, yyyy 'at' h:mm a")}</span>
    </div>
  )}
  
  {lead.lastContactedAt && lead.lastContactedAt !== lead.contactedAt && (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <Phone className="h-3.5 w-3.5 text-blue-500" />
      <span>Last Contact:</span>
      <span className="text-foreground">{format(new Date(lead.lastContactedAt), "MMM d, yyyy 'at' h:mm a")}</span>
    </div>
  )}
</motion.div>
```

### 5. `src/components/callcenter/LeadExpiryCountdown.tsx`

**Changes:**
- Only show countdown if `contactedAt` exists (first contact made)
- Calculate countdown from `contactedAt`, not `createdAt`
- Show "Contact to start timer" message if not yet contacted

**Updated Props:**
```typescript
interface LeadExpiryCountdownProps {
  createdAt: string;
  contactedAt?: string;
  lastContactedAt?: string;  // NEW
}
```

**Updated Logic:**
```typescript
// Only start countdown after first contact
if (!contactedAt) {
  return (
    <div className="...">
      <Clock className="..." />
      <span>Contact lead to start 2-week reimbursement timer</span>
    </div>
  );
}

// Calculate from first contact, not creation
const firstContact = new Date(contactedAt);
const now = new Date();
const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;

const elapsed = now.getTime() - firstContact.getTime();
const remaining = Math.max(0, twoWeeksMs - elapsed);
```

### 6. `src/pages/CallCenter.tsx`

**Changes:**
- Update `UnifiedLead` interface to include `lastContactedAt`
- Update fetch queries to include `last_contacted_at`
- Update action handlers to set `last_contacted_at` when processing

**Interface update:**
```typescript
interface UnifiedLead {
  // ... existing fields
  contactedAt?: string;      // First contact
  lastContactedAt?: string;  // Last contact (NEW)
}
```

**Update action handler** - When marking as "hired", update both contacted timestamps:
```typescript
if (!currentLead.contactedAt) {
  // First contact - set contacted_at
  updates.contacted_at = new Date().toISOString();
}
// Always update last_contacted_at
updates.last_contacted_at = new Date().toISOString();
```

---

## Visual Mockup - Updated Time Display

```text
┌─────────────────────────────────────────────────────────────┐
│  [Aged Lead]  [Unlicensed]                                 │
│                                                             │
│  John Smith  ✨                      [Stage: Course...]    │
│                                                             │
│  ⏱️ Lead Added: Jan 15, 2026 at 2:30 PM                    │
│  📞 First Contact: Jan 18, 2026 at 10:15 AM               │
│  📞 Last Contact: Jan 22, 2026 at 3:45 PM                 │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 🔔 10 days remaining                                  │ │
│  │ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░  28% elapsed        │ │
│  │ 2-week reimbursement window (from first contact)      │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  [📞 CALL NOW - (555) 123-4567]                            │
└─────────────────────────────────────────────────────────────┘
```

**If not yet contacted:**
```text
┌───────────────────────────────────────────────────────────┐
│ ⏱️ Contact lead to start 2-week reimbursement timer      │
│ (Timer begins after first call)                          │
└───────────────────────────────────────────────────────────┘
```

---

## Implementation Summary

| File | Changes |
|------|---------|
| Database | Add `last_contacted_at` column to both tables |
| `send-outreach-email/index.ts` | Support both `applications` and `aged_leads` tables |
| `QuickEmailMenu.tsx` | Add `leadSource` prop and pass to edge function |
| `CallCenterLeadCard.tsx` | Pass `leadSource` prop, update time display UI |
| `LeadExpiryCountdown.tsx` | Calculate from `contactedAt`, show "not started" state |
| `CallCenter.tsx` | Update interface, fetch, and action handlers |

---

## Expected Result

1. **Emails work for all leads** - Both aged leads and applications send emails successfully
2. **2-week timer is accurate** - Only counts down from first contact date
3. **Clear time visibility** - All three timestamps (added, first contact, last contact) clearly displayed
4. **Better UX** - Shows "Contact to start timer" when lead hasn't been contacted yet

