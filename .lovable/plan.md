
## Plan: Comprehensive CRM & Agent Portal Improvements

### Overview
This plan addresses multiple enhancements across the Agent CRM, Application Form, Admin Panel, and Agent Portal to create a smoother, more polished user experience.

---

## Part 1: Agent CRM Improvements

### 1.1 Full-Screen Section View with Smooth Transitions

**Current State:** The CRM displays 3 columns side-by-side (In Course, In-Field Training, Live)

**Changes to `src/pages/DashboardCRM.tsx`:**
- Add new state for selected column: `const [expandedColumn, setExpandedColumn] = useState<string | null>(null)`
- When a filter stat card is clicked, expand that section to full-screen with smooth framer-motion animation
- Add a "Back to Overview" button when viewing expanded section
- Use `AnimatePresence` with `layoutId` for seamless transitions between views

**Animation approach:**
```tsx
<motion.div
  layoutId={column.key}
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ type: "spring", stiffness: 300, damping: 30 }}
  className="col-span-full"
>
```

### 1.2 Remove AbandonedLeadsPanel from CRM

**File: `src/pages/DashboardCRM.tsx`**

**Current (Line ~714):**
```tsx
<AbandonedLeadsPanel />
```

**Action:** Remove this component from the CRM page. It already exists in the Admin Panel where it belongs.

### 1.3 Add Quick Email Options for Leads

**Files to modify:**
- `src/components/dashboard/QuickEmailMenu.tsx` - Add new templates
- `supabase/functions/send-outreach-email/index.ts` - Add template handlers

**New email templates to add:**
1. **"Course Help"** - For those who purchased a course and need assistance
2. **"Schedule Consultation"** - Link for unlicensed individuals to book a call

**Update template labels:**
```typescript
const emailTemplateLabels: Record<EmailTemplate, string> = {
  // existing templates...
  course_help: "Course Help Request",
  schedule_consultation: "Schedule Consultation",
};
```

---

## Part 2: Application Toast Frequency Change

### 2.1 Change Refresh Rate from ~55-70s to ~35s

**File: `src/components/landing/ApplicationToast.tsx`**

**Current (Line ~59-61):**
```typescript
const interval = setInterval(() => {
  showNotification();
}, 55000 + Math.random() * 15000); // Between 55-70 seconds
```

**New:**
```typescript
const interval = setInterval(() => {
  showNotification();
}, 35000 + Math.random() * 10000); // Between 35-45 seconds
```

---

## Part 3: SMS Consent Disclosure

### 3.1 Add Consent Checkbox to Application Form

**File: `src/pages/Apply.tsx`**

**Schema update (add new field):**
```typescript
const applicationSchema = z.object({
  // ... existing fields
  smsConsent: z.boolean().refine(val => val === true, {
    message: "You must agree to receive SMS messages to submit",
  }),
});
```

**Add checkbox before submit button in Step 4 (around line 750):**
```tsx
<div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border">
  <Checkbox
    id="smsConsent"
    checked={watch("smsConsent")}
    onCheckedChange={(checked) => 
      setValue("smsConsent", checked === true, { shouldValidate: true })
    }
    className="mt-0.5"
  />
  <Label htmlFor="smsConsent" className="text-sm text-muted-foreground cursor-pointer">
    By submitting this form, you agree to receive SMS/text messages from 
    Apex Financial at the phone number provided for applications, plus 
    updates and onboarding steps.
  </Label>
</div>
{errors.smsConsent && (
  <p className="text-sm text-destructive">{errors.smsConsent.message}</p>
)}
```

---

## Part 4: Admin Panel - Abandoned Leads Fix

### 4.1 Ensure Abandoned Applications Are Properly Logged

**Investigation needed:**
- The `check-abandoned-applications` Edge Function checks for apps older than 15 minutes with `admin_notified_at IS NULL`
- The `AbandonedLeadsPanel` queries `partial_applications` where `converted_at IS NULL`

**Potential issues to fix:**
1. Verify the `partial_applications` RLS policies allow admins and managers to read
2. Ensure the Edge Function is being triggered (check pg_cron schedule)
3. Add manual refresh capability to force sync

**File: `src/components/dashboard/AbandonedLeadsPanel.tsx`**

**Add logging and error handling:**
```typescript
const fetchAbandonedLeads = async () => {
  setIsLoading(true);
  try {
    console.log("Fetching abandoned leads...");
    const { data, error, count } = await supabase
      .from("partial_applications")
      .select("*", { count: "exact" })
      .is("converted_at", null)
      .order("created_at", { ascending: false });

    console.log("Abandoned leads query result:", { data, error, count });
    // ... rest of function
  }
}
```

### 4.2 Navigation Bug Fix (Settings → CRM)

**Issue:** Navigation feels delayed, options don't appear promptly

**Root cause:** Likely React query caching or slow auth state resolution

**File: `src/components/dashboard/DashboardLayout.tsx`**

**Optimization:**
- Add `prefetch` on navigation links
- Ensure `useAuth` doesn't cause unnecessary re-renders
- Add skeleton loading states for faster perceived performance

---

## Part 5: Agent Portal Complete Redesign

### 5.1 New Clean, Modern Dashboard Design

**File: `src/pages/AgentPortal.tsx`**

**New design principles:**
- Clean, minimal interface with more whitespace
- Modern gradient accents and glass morphism
- Clear visual hierarchy
- Appealing color palette (teals, purples, warm accents)
- Simple number input form prominently displayed
- Easy-to-read analytics cards

**New structure:**
```tsx
<div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
  {/* Sticky Header with Avatar & Date */}
  <header>...</header>
  
  {/* Hero Welcome Card */}
  <section className="hero">
    <WelcomeCard userName={name} todayStats={...} />
  </section>
  
  {/* Daily Number Input - Prominent & Clean */}
  <section className="production-input">
    <ProductionEntryRedesigned />
  </section>
  
  {/* Stats Dashboard - Cards Grid */}
  <section className="stats-grid">
    <StatCard label="Today's ALP" value="$X,XXX" icon="💰" />
    <StatCard label="Weekly Total" value="$XX,XXX" icon="📈" />
    <StatCard label="Close Rate" value="XX%" icon="🎯" />
    <StatCard label="Rank" value="#X" icon="🏆" />
  </section>
  
  {/* Compact Leaderboard */}
  <section className="leaderboard">
    <MiniLeaderboard />
  </section>
  
  {/* History Chart - Simple */}
  <section className="chart">
    <SimplifiedHistoryChart />
  </section>
</div>
```

**Color palette improvements:**
- Primary: `#14b8a6` (teal) - keep for brand consistency
- Accent: `#8b5cf6` (purple) - for highlights and rank badges
- Success: `#22c55e` (green) - for positive metrics
- Warm: `#f59e0b` (amber) - for top performer indicators
- Background: Smoother gradients with glass effects

### 5.2 Production Entry Redesign

**File: `src/components/dashboard/ProductionEntry.tsx`**

**Improvements:**
- Larger, cleaner input fields
- Clear labels with icons
- Satisfying animations on input
- Big, prominent "Save" button
- Visual feedback when saving

### 5.3 Portal Login Email - Include Username

**File: `supabase/functions/send-agent-portal-login/index.ts`**

**Add username/email to email body:**
```html
<p style="color: #94a3b8; font-size: 14px; text-align: center; margin: 0;">
  Log in with your email: <strong style="color: #14b8a6;">${profile.email}</strong>
</p>
```

---

## Part 6: Mock Account for Testing

### 6.1 Create Test Agent Portal Login Flow

**Action:** Send a test login email to verify the complete flow

**Implementation:**
- Use the existing `send-agent-portal-login` Edge Function
- User can provide their email to receive a test login
- Or we can add a "Preview Mode" button in the portal for admins

---

## Summary of Files to Modify

| File | Changes |
|------|---------|
| `src/pages/DashboardCRM.tsx` | Full-screen sections, remove AbandonedLeadsPanel |
| `src/components/landing/ApplicationToast.tsx` | Change interval from 55-70s to 35-45s |
| `src/pages/Apply.tsx` | Add SMS consent checkbox |
| `src/components/dashboard/QuickEmailMenu.tsx` | Add course help & consultation templates |
| `supabase/functions/send-outreach-email/index.ts` | Add new email template handlers |
| `src/pages/AgentPortal.tsx` | Complete redesign for cleaner UI |
| `src/components/dashboard/ProductionEntry.tsx` | Visual improvements |
| `supabase/functions/send-agent-portal-login/index.ts` | Include username in email |
| `src/components/dashboard/AbandonedLeadsPanel.tsx` | Add debug logging |
| `src/components/dashboard/DashboardLayout.tsx` | Navigation performance optimization |

---

## Technical Considerations

1. **Smooth Animations:** Use framer-motion's `layoutId` and `AnimatePresence` for seamless transitions
2. **Performance:** Lazy load components where possible, optimize re-renders
3. **Accessibility:** Ensure all new UI elements have proper ARIA labels
4. **Mobile Responsive:** All changes must work on mobile devices
5. **Sound Effects:** Reuse existing `useSoundEffects` hook for feedback

---

## Expected Outcomes

1. **CRM:** Cleaner single-section views with smooth transitions, no random abandoned panel
2. **Application:** Faster "activity" notifications, legal SMS consent captured
3. **Admin Panel:** Reliable abandoned lead tracking with proper counts
4. **Agent Portal:** Beautiful, motivating dashboard agents will want to use daily
5. **Navigation:** Snappy, responsive navigation throughout the app
