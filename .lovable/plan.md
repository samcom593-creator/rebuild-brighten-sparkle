

# Plan: Call Center UI Optimization + Aged Lead Email System + Homepage Update

## Summary

This plan addresses multiple improvements:
1. **Call Center Pipeline UI** - Add last contact date display, 2-week countdown timer, better screen utilization
2. **Aged Lead Auto-Email** - Improve the email sent when importing leads with a high-converting "new position" email + test preview
3. **Homepage Update** - Change "50%" commission references to "70%"

---

## Database Changes

Add column to `aged_leads` table to track when lead was first imported (for 2-week countdown):

```sql
ALTER TABLE aged_leads
ADD COLUMN IF NOT EXISTS contacted_at timestamp with time zone;
```

---

## 1. Call Center Pipeline UI Improvements

### Files to Modify

#### `src/components/callcenter/CallCenterLeadCard.tsx`

**Changes:**
- Add "Last Contacted" badge showing date of last contact
- Add 2-week countdown progress bar showing days remaining
- Expand the card to use more horizontal space (remove `max-w-3xl` constraint)
- Better visual hierarchy with larger touch targets

**New UI Elements:**

| Element | Description |
|---------|-------------|
| Last Contact Badge | Shows "Last: Called • 2d ago" or "No contact yet" |
| 2-Week Countdown | Progress bar showing X of 14 days elapsed |
| Urgency Indicator | Red warning when under 3 days remaining |

**Visual Design:**
```text
┌─────────────────────────────────────────────────────────────────┐
│  Aged Lead  •  Unlicensed                                       │
│  John Smith                                                     │
│  Added 3 days ago  •  Last contact: 2d ago                      │
│                                                                 │
│  ⏱️ Lead Expiry: 11 days remaining                              │
│  [██████████░░░░░░░░░░░░░░]                                     │
│                                                                 │
│  [📞 CALL NOW] john@email.com | @johndoe                        │
│                                                                 │
│  Notes: Looking for remote sales opportunity...                 │
│                                                                 │
│  [🎙️ Record Call]  [📧 Email]  [🔀 Reassign]                    │
└─────────────────────────────────────────────────────────────────┘
```

#### `src/pages/CallCenter.tsx`

**Changes:**
- Remove `max-w-3xl` constraint to use full screen width
- Update grid layout for better space utilization
- Fetch `contacted_at` for aged leads (add to query)
- Track when leads are contacted (update on action)

---

## 2. Aged Lead High-Converting Email

### Current Flow
When leads are imported via `AgedLeadImporter.tsx`, emails are sent via `send-aged-lead-email` edge function.

### Improvements Needed

#### A. Test Email Preview (Before Import)

**New Component:** `AgedLeadEmailPreview.tsx`

Add a preview modal that shows the exact email before importing. User can review and approve.

**Integration in `AgedLeadImporter.tsx`:**
- Add "Preview Email" button in step 2 (before import)
- Show modal with full email content
- Allow minor customization if needed

#### B. High-Converting Email Content

**Update:** `supabase/functions/send-aged-lead-email/index.ts`

Replace current generic email with a high-converting "new position opened" message:

**New Subject Line:**
```
🔥 New Remote Sales Position Just Opened – Apply Now
```

**Email Structure:**
1. **Attention-grabbing header** - "A new position just opened up"
2. **Urgency** - "Limited spots available"
3. **Benefits list** - Starting at 70% commission, free leads, etc.
4. **Social proof** - Agent success stories
5. **Clear CTA** - "Claim Your Spot"

**New Email Copy:**
```text
Hey [Name]!

A new remote sales position just opened up at Apex Financial and we thought of you.

Here's what's on the table:

✓ Start at 70% commission (up to 145%)
✓ Free warm leads provided daily  
✓ Complete training program included
✓ No cold calling required
✓ Work from anywhere

Our top performers are earning $10K-$50K+ per month, and we're looking for motivated individuals to join the team.

[🚀 CLAIM YOUR SPOT]

Spots are limited and filling fast.

– The Apex Financial Team
```

---

## 3. Homepage 50% → 70% Update

### Files to Modify

#### `src/components/landing/HeroSection.tsx`
**Line 182:** Change `"50%-145%"` to `"70%-145%"`

#### `src/components/landing/CareerPathwaySection.tsx`
**Line 139:** Change `"50%-145%"` to `"70%-145%"`
**Line 209:** Change `"50%-145%"` to `"70%-145%"`

#### `src/components/landing/EarningsSection.tsx`
**Lines 15, 23:** Update `commissionRate` from `"50%-145%"` to `"70%-145%"`

---

## 4. Post-Contact Thank You Email Enhancement

### Current State
`send-post-call-followup` already sends emails after contact with licensing resources for unlicensed leads.

### Verify Functionality
- Licensed leads receive Calendly rebook link
- Unlicensed leads receive 3-step resource package (video, doc, course link)

**No changes needed** - this is already implemented correctly per the memory context.

---

## Technical Implementation Details

### 2-Week Countdown Component

```typescript
// New component: LeadExpiryCountdown.tsx
interface LeadExpiryCountdownProps {
  createdAt: string;
  contactedAt?: string;
}

function LeadExpiryCountdown({ createdAt, contactedAt }: LeadExpiryCountdownProps) {
  const created = new Date(createdAt);
  const now = new Date();
  const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
  
  const elapsed = now.getTime() - created.getTime();
  const remaining = Math.max(0, twoWeeksMs - elapsed);
  const daysRemaining = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  const progress = Math.min(100, (elapsed / twoWeeksMs) * 100);
  
  const isUrgent = daysRemaining <= 3;
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className={cn("font-medium", isUrgent && "text-red-400")}>
          {daysRemaining > 0 ? `${daysRemaining} days remaining` : "Expired"}
        </span>
        {contactedAt && <span className="text-green-400">Contacted</span>}
      </div>
      <Progress 
        value={progress} 
        className={cn("h-1.5", isUrgent && "[&>div]:bg-red-500")} 
      />
    </div>
  );
}
```

### Email Preview Modal for Imports

```typescript
// New component: AgedLeadEmailPreview.tsx
interface EmailPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  sampleFirstName: string;
  onApprove: () => void;
}

function AgedLeadEmailPreview({ isOpen, onClose, sampleFirstName, onApprove }) {
  // Shows the exact HTML that will be sent
  // Uses same template as send-aged-lead-email function
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email Preview</DialogTitle>
          <DialogDescription>
            This is what your leads will receive
          </DialogDescription>
        </DialogHeader>
        
        {/* Render email preview */}
        <div className="border rounded-lg p-4 bg-black text-white">
          {/* Email content preview */}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onApprove}>Looks Good, Import Leads</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Files Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/components/callcenter/CallCenterLeadCard.tsx` | Modify | Add last contact badge, 2-week countdown, wider layout |
| `src/pages/CallCenter.tsx` | Modify | Remove width constraint, fetch contacted_at, update on action |
| `supabase/functions/send-aged-lead-email/index.ts` | Modify | High-converting "new position" email, 70% commission |
| `src/components/dashboard/AgedLeadImporter.tsx` | Modify | Add email preview step before import |
| `src/components/landing/HeroSection.tsx` | Modify | 50% → 70% |
| `src/components/landing/CareerPathwaySection.tsx` | Modify | 50% → 70% (2 locations) |
| `src/components/landing/EarningsSection.tsx` | Modify | 50% → 70% (2 locations) |
| **NEW** `src/components/callcenter/LeadExpiryCountdown.tsx` | Create | 2-week countdown progress bar component |
| **NEW** `src/components/dashboard/AgedLeadEmailPreview.tsx` | Create | Email preview modal for lead imports |

---

## Expected Outcomes

After implementation:
1. **Better Call Center UX** - Full-width layout with last contact dates and urgency indicators
2. **Lead urgency visibility** - 2-week countdown shows how long until lead expires
3. **Safer email sending** - Preview exactly what goes out before importing leads
4. **Higher email conversions** - Compelling "new position opened" email with 70% commission highlight
5. **Consistent messaging** - Homepage matches actual commission structure (70% starting)

