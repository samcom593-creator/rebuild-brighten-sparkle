
# Comprehensive Fix Plan: Leaderboard Visibility + Onboarding Course

## Part 1: Fix ALL Leaderboard Visibility Issues

### Root Cause Analysis
The leaderboards are failing because of a **cascading RLS failure**:

```
ManagerLeaderboard.tsx Flow:
1. Query `agents` table for all active agents → RLS blocks other managers ❌
2. Query `user_roles` for role='manager' → RLS only returns YOUR role ❌  
3. Query `profiles` for names → No user_ids to query, returns nothing ❌

Result: Manager only sees themselves!
```

### Solution: Add 3 New RLS Policies

**1. Allow Managers to View Manager User Roles**
```sql
CREATE POLICY "Managers can view manager roles"
ON public.user_roles FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND role = 'manager'
);
```
This allows any manager to see which users have the 'manager' role.

**2. Allow Managers to View Other Manager Agent Records**
```sql
CREATE POLICY "Managers can view other manager agents"
ON public.agents FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND user_id IN (
    SELECT ur.user_id 
    FROM public.user_roles ur 
    WHERE ur.role = 'manager'
  )
);
```
This allows managers to see other managers' agent records (needed for leaderboard calculations).

**3. Allow All Authenticated Users to View All Agent Production Data**
The current policy already allows managers to view all production, but the agents table blocks the name lookup. We need to ensure the full chain works.

### Additional Fix: Update Profile Visibility for Leaderboards

The existing policy "Managers can view manager profiles for leaderboard" is good, but we need to ensure agents with production data can also have their profiles viewed by managers. Add:

```sql
CREATE POLICY "Managers can view all profiles for leaderboards"
ON public.profiles FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role)
);
```
This is broader but safe - profile data (name, avatar) isn't sensitive.

---

## Part 2: Onboarding Course Integration

### What You Want
Based on your description, you want an interactive onboarding course that:
- Uses video content to train new agents
- Includes quiz questions to test understanding
- Prevents progression until questions are answered correctly
- Gets agents in the right "mindset" before going live

### Proposed Course Structure

**Page: `/onboarding-course`**

A multi-module course with:
1. **Video Player** - Embedded videos for each module
2. **AI-Powered Quiz Questions** - Generated from video content
3. **Progress Tracking** - Database-backed, shows completion status
4. **Gate System** - Must pass each module to unlock the next
5. **Integration with CRM** - Updates agent onboarding_stage when complete

### Database Schema

```sql
-- Onboarding modules table
CREATE TABLE onboarding_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  video_url TEXT NOT NULL,
  pass_threshold INTEGER DEFAULT 80, -- % correct needed to pass
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Questions for each module
CREATE TABLE onboarding_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID REFERENCES onboarding_modules(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL, -- ["Option A", "Option B", "Option C", "Option D"]
  correct_answer INTEGER NOT NULL, -- 0-3 index
  explanation TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent progress tracking
CREATE TABLE onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  module_id UUID REFERENCES onboarding_modules(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  score INTEGER,
  attempts INTEGER DEFAULT 0,
  answers JSONB, -- Store their answers for review
  passed BOOLEAN DEFAULT false,
  UNIQUE(agent_id, module_id)
);
```

### Course Components

**1. OnboardingCourse.tsx** - Main course page
- Module list sidebar with lock/unlock icons
- Current module content area
- Video player with required watch time
- Quiz section that appears after video

**2. OnboardingModule.tsx** - Individual module
- Video embed (YouTube or custom)
- Progress bar for video completion
- "Take Quiz" button unlocks after 90% video watched

**3. OnboardingQuiz.tsx** - Quiz interface
- Multiple choice questions
- Immediate feedback on answers
- Score summary at end
- "Retry" if below pass threshold
- Confetti celebration on pass

**4. OnboardingProgress.tsx** - Progress tracker
- Visual progress bar
- Module completion checkmarks
- Estimated time remaining

### AI Question Enhancement

Use the AI assistant edge function to:
1. Analyze video transcripts (provided by you)
2. Generate additional quiz questions
3. Create scenario-based questions
4. Generate "gotcha" questions to catch those not paying attention

### Integration with CRM

When all modules are complete:
1. Update `agents.onboarding_stage` to 'training_online' or 'in_field_training'
2. Log completion in `agent_onboarding` table
3. Trigger notification to manager
4. Show "Ready for Field Training" status in CRM

---

## Implementation Order

### Phase 1: Fix Leaderboards (Immediate)
1. Add RLS policy for `user_roles` - managers can see manager roles
2. Add RLS policy for `agents` - managers can see other managers
3. Update profile visibility policy to be more permissive for managers
4. Test all leaderboards with manager accounts (KJ, OB)

### Phase 2: Basic Course Structure
1. Create database tables for modules/questions/progress
2. Build OnboardingCourse.tsx page with module navigation
3. Build video player with watch time tracking
4. Build quiz component with scoring

### Phase 3: Content & AI Enhancement
1. You provide video URLs and any existing questions
2. AI generates additional questions from video transcripts
3. Fine-tune pass thresholds and difficulty

### Phase 4: CRM Integration
1. Connect course completion to onboarding stage
2. Add "Course Progress" indicator to agent cards in CRM
3. Manager notifications when agents complete course

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| SQL Migration | Create | Add 3 new RLS policies for leaderboard visibility |
| `src/pages/OnboardingCourse.tsx` | Create | Main course page |
| `src/components/course/OnboardingModule.tsx` | Create | Module display component |
| `src/components/course/OnboardingQuiz.tsx` | Create | Quiz interface |
| `src/components/course/OnboardingProgress.tsx` | Create | Progress tracker |
| SQL Migration | Create | New tables for course content |
| `src/App.tsx` | Modify | Add `/onboarding-course` route |

---

## Next Steps

I need from you:
1. **Video URLs** - Links to your training videos (YouTube, Vimeo, etc.)
2. **Existing Questions** - Any current quiz questions you want included
3. **Module Structure** - How many modules? What topics?
4. **Pass Threshold** - What score should be required? (80%? 90%?)

For now, I'll proceed with **Phase 1 (fixing leaderboards)** immediately since that's blocking your managers from seeing competitive data. Ready to implement?
