

## Comprehensive Course Management and Notification System Overhaul

### Issues to Fix

1. **X Button Not Working for Unenroll** - RLS policy needs to allow admins to delete from `onboarding_progress`
2. **Apex Financial Branding on Log Numbers Page** - Add faint watermark
3. **Auto-Move to Field Training on Course Completion** - Trigger edge function when agent passes all modules
4. **Course Completion Email Updates** - Add Discord link, meeting time, expectations
5. **Release Video Email** - Send when agent is marked live in CRM
6. **Monthly Motivation Email** - End of month "finish strong" message
7. **Welcome Email Flow** - Complete restructure with licensing link and expectations

---

### Part 1: Fix Unenroll X Button (RLS Policy)

**Problem**: The delete operation on `onboarding_progress` is likely being blocked by RLS.

**Solution**: Add explicit DELETE policy for admins in a migration:

```sql
-- Add DELETE policy for admins on onboarding_progress
CREATE POLICY "Admins can delete all progress" 
ON public.onboarding_progress 
FOR DELETE 
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Also allow managers to delete their team's progress
CREATE POLICY "Managers can delete team progress" 
ON public.onboarding_progress 
FOR DELETE 
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role) 
  AND agent_id IN (
    SELECT id FROM agents 
    WHERE invited_by_manager_id = current_agent_id()
  )
);
```

---

### Part 2: Apex Financial Branding on Log Numbers Page

**File**: `src/pages/LogNumbers.tsx`

Add a faint "Apex Financial" watermark on the right side of the production entry screen:

```tsx
{/* Inside the GlassCard for production step */}
<div className="relative">
  {/* Faint watermark on right side */}
  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none select-none">
    <span className="text-4xl font-bold text-muted-foreground/10 whitespace-nowrap rotate-[-15deg] block">
      APEX FINANCIAL
    </span>
  </div>
  
  {/* Existing production form content */}
  ...
</div>
```

This creates a subtle, non-intrusive watermark that maintains the aesthetic while reinforcing branding.

---

### Part 3: Auto-Move to Field Training on Course Completion

**File**: `src/hooks/useOnboardingCourse.ts`

Add a new function that triggers when the last module is passed:

```tsx
const handleCourseCompletion = useCallback(async () => {
  if (!agentId) return;
  
  // Call the edge function to notify and move to field training
  await supabase.functions.invoke("notify-course-complete", {
    body: { agentId }
  });
}, [agentId]);

// In submitQuiz - check if this completes the course
const submitQuiz = useCallback(async (...) => {
  // After saving quiz results...
  
  // Check if this was the last module and course is now complete
  const allModulesPassed = modules.every(m => 
    m.id === moduleId ? passed : progress[m.id]?.passed
  );
  
  if (allModulesPassed) {
    await handleCourseCompletion();
  }
  
  return true;
}, [...]);
```

---

### Part 4: Enhanced Course Completion Email

**File**: `supabase/functions/notify-course-complete/index.ts`

Update the email to include:
- Discord link (https://discord.gg/GygkGEhb)
- Meeting time: 10 AM CST on Discord
- Expectations: Camera on, "On time is late"
- Congratulations message to the agent

```tsx
// Updated email structure:

// 1. Email to Admin + Manager (existing)
// Subject: "🎓 [Agent Name] Completed Onboarding Course!"

// 2. NEW: Congratulations email to the Agent
const agentEmailHtml = `
  <h1>Congratulations, ${finalAgentName}!</h1>
  <p>You've successfully completed all onboarding coursework!</p>
  
  <div class="highlight">
    <h3>🎯 Next Steps - Field Training</h3>
    <p>Your manager will be reaching out to schedule your first field training session.</p>
  </div>
  
  <div class="highlight">
    <h3>💬 Join Our Discord</h3>
    <p>This is where all team communication happens:</p>
    <a href="https://discord.gg/GygkGEhb">Join Discord →</a>
  </div>
  
  <div class="highlight">
    <h3>📅 Daily Team Meeting</h3>
    <p><strong>Time:</strong> 10:00 AM CST on Discord</p>
    <p><strong>Expectations:</strong></p>
    <ul>
      <li>Camera ON (required)</li>
      <li>Remember: On time is LATE</li>
    </ul>
  </div>
  
  <div class="highlight">
    <h3>🏆 The Standard Here</h3>
    <p>Excellence is the expectation. Our minimum standard is $20,000/month.</p>
    <p>You've got what it takes - now let's prove it in the field.</p>
  </div>
`;
```

---

### Part 5: Release Video Email (New Edge Function)

**New File**: `supabase/functions/notify-agent-live-field/index.ts`

This function triggers when an agent's `onboarding_stage` is changed to "evaluated" (live in field):

```tsx
// Trigger: Called when agent is marked as "evaluated" in CRM

const releaseVideoUrl = "https://youtu.be/fZSm3T1jBJ8";

const emailHtml = `
  <h1>You're Officially LIVE! 🚀</h1>
  <p>Congratulations ${agentName}! You've completed field training and are now a live agent.</p>
  
  <div class="highlight">
    <h3>🎬 Watch This Important Video</h3>
    <p>Before you get started, watch this release video:</p>
    <a href="${releaseVideoUrl}">Watch Release Video →</a>
  </div>
  
  <div class="highlight">
    <h3>📊 Log Your Numbers Daily</h3>
    <p>Remember to log your production numbers every day by 7 PM CST!</p>
    <a href="${portalLink}">Open Agent Portal →</a>
  </div>
`;
```

**Integration**: Add a trigger in the CRM stage change logic to call this function.

---

### Part 6: End of Month Motivation Email (New Edge Function)

**New File**: `supabase/functions/send-monthly-motivation/index.ts`

Scheduled to run tomorrow morning (Jan 31) to prepare everyone for February:

```tsx
// Recipients: All agents below $5,000 for the current week

const emailHtml = `
  <h1>Prepare for February! 💪</h1>
  <p>Hey ${agentName},</p>
  
  <p>We're wrapping up January and heading into a brand new month. 
  This is YOUR moment to finish strong!</p>
  
  <div class="highlight">
    <h3>📊 Your Current Week</h3>
    <p>You're currently at <strong>$${weeklyALP.toLocaleString()}</strong> this week.</p>
    <p>The standard we know is <strong>$20,000/month</strong> to stay competitive.</p>
  </div>
  
  <div class="highlight">
    <h3>🎯 Set Your February Goals</h3>
    <p>What are you going to crush next month?</p>
    <ul>
      <li>How many presentations will you commit to?</li>
      <li>What's your ALP target?</li>
      <li>How will you beat last month?</li>
    </ul>
  </div>
  
  <div class="highlight">
    <h3>💡 Finish January Strong</h3>
    <p>You still have today and tomorrow to make this month count. 
    Every presentation matters. Every deal counts.</p>
    <p><strong>Let's go!</strong></p>
  </div>
`;
```

---

### Part 7: Restructured Welcome Email

**File**: `supabase/functions/welcome-new-agent/index.ts`

Complete rewrite with proper onboarding flow:

```tsx
const emailHtml = `
  <h1>Welcome to APEX! 🎉</h1>
  <p>Hey ${firstName},</p>
  
  <p>Welcome to the Apex Financial team! Follow these steps to get started:</p>
  
  <div class="step">
    <h3>Step 1: Complete Your Licensing</h3>
    <p>If you're not already licensed, tap the link below to get started:</p>
    <a href="${licensingLink}">Complete Licensing →</a>
    <p><em>⚠️ IMPORTANT: Attach your E&O (Errors & Omissions) insurance. 
    This is a critical step - without it, your application won't process correctly.</em></p>
  </div>
  
  <div class="step">
    <h3>Step 2: Complete Your Coursework</h3>
    <p>Once you're set up, complete the onboarding course. 
    <strong>Expectation: Complete this the same day you receive it.</strong></p>
    <a href="${courseLink}">Start Coursework →</a>
  </div>
  
  <div class="step">
    <h3>Step 3: Join Discord</h3>
    <p>All team communication happens here:</p>
    <a href="https://discord.gg/GygkGEhb">Join Discord →</a>
    <p>Daily meetings at <strong>10 AM CST</strong> - camera ON, on time is late!</p>
  </div>
  
  <div class="highlight">
    <h3>🏆 What We Expect</h3>
    <p>At Apex, the standard is <strong>excellence</strong>.</p>
    <p>Our minimum production standard is <strong>$20,000/month</strong>.</p>
    <p>You were chosen because we believe you can hit that and beyond.</p>
  </div>
  
  <p>Let's build something great together!</p>
  <p>— The Apex Team</p>
`;
```

**Note**: The licensing link will be dynamically pulled from the manager's saved contracting links or provided during the invite flow.

---

### Summary of Changes

| Component | Change | Files Affected |
|-----------|--------|----------------|
| **Unenroll RLS Fix** | Add DELETE policies for admins and managers | Migration SQL |
| **Apex Branding** | Add faint watermark to production page | `LogNumbers.tsx` |
| **Auto Field Training** | Trigger completion function when course done | `useOnboardingCourse.ts` |
| **Course Complete Email** | Add Discord, meeting info, expectations | `notify-course-complete/index.ts` |
| **Release Video Email** | New function for live agents | `notify-agent-live-field/index.ts` (new) |
| **Monthly Motivation** | End-of-month email for low performers | `send-monthly-motivation/index.ts` (new) |
| **Welcome Email** | Full restructure with step-by-step flow | `welcome-new-agent/index.ts` |

---

### Testing Plan

After implementation:
1. Test X button unenroll on Course Progress page
2. Verify Apex branding appears on Log Numbers production entry
3. Complete a test course run to verify auto-move and emails
4. Verify mock emails sent to info@kingofsales.net
5. Test the full agent flow: Add agent → Enroll → Complete course → Mark live

