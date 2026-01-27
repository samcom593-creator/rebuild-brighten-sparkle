

# Onboarding Course Content Population Plan

## Overview

This plan will populate your onboarding course database with 4 training modules and AI-generated quiz questions. Each module requires 90% correct answers to pass.

---

## Module Structure

Based on the YouTube videos you provided, here are the 4 modules:

| Order | Title | Video URL | Duration |
|-------|-------|-----------|----------|
| 1 | Getting Started: Your First Week | `https://youtu.be/olXKn7OoH6I` | ~10 min |
| 2 | The Sales System Blueprint | `https://youtu.be/4iVRFhe7Kxo` | 8:58 |
| 3 | Handling Objections | `https://youtu.be/jOtqBnnLsR0` | 9:34 |
| 4 | Script Mastery | `https://youtu.be/TggYZUIWQRE` | 45:08 |

---

## Implementation Steps

### Step 1: Database Population Migration

Create a SQL migration to insert the 4 modules with their video URLs and 90% pass threshold:

```sql
INSERT INTO onboarding_modules (order_index, title, description, video_url, pass_threshold)
VALUES 
  (0, 'Getting Started: Your First Week', 'Learn the fundamentals of your new role...', 'https://youtu.be/olXKn7OoH6I', 90),
  (1, 'The Sales System Blueprint', 'Master the proven sales system...', 'https://youtu.be/4iVRFhe7Kxo', 90),
  (2, 'Handling Objections', 'Learn to confidently handle common objections...', 'https://youtu.be/jOtqBnnLsR0', 90),
  (3, 'Script Mastery', 'Perfect your word-for-word sales script...', 'https://youtu.be/TggYZUIWQRE', 90);
```

### Step 2: Create AI Question Generation Edge Function

Build an edge function that uses Lovable AI (Gemini) to generate quiz questions based on module topics. The function will:
- Accept module title and topic keywords
- Generate 5 multiple-choice questions per module
- Return questions with 4 options each and correct answer index
- Include explanations for why answers are correct

### Step 3: Generate & Insert Quiz Questions

Use the AI to generate relevant questions for each module:

**Module 1: Getting Started** (5 questions)
- Company culture and values
- Daily schedule expectations
- Tools and systems overview
- Communication protocols
- First-week goals

**Module 2: Sales System Blueprint** (5 questions)
- Sales process stages
- Lead qualification criteria
- Presentation structure
- Follow-up timing
- Conversion metrics

**Module 3: Handling Objections** (5 questions)
- Common objection types
- Response frameworks
- Empathy techniques
- Turnaround phrases
- When to walk away

**Module 4: Script Mastery** (5 questions)
- Opening statements
- Discovery questions
- Value proposition delivery
- Closing techniques
- Tone and pacing

### Step 4: Admin Panel for Question Management (Optional)

If you want to edit questions later, I can add an admin interface to:
- View all modules and questions
- Edit question text and options
- Change correct answers
- Add/remove questions
- Reorder modules

---

## Technical Details

### Edge Function: `generate-quiz-questions`

```text
supabase/functions/generate-quiz-questions/index.ts
```

This function will:
1. Accept a module ID or title
2. Call Lovable AI Gateway with a structured prompt
3. Use tool calling to extract structured JSON output
4. Return 5 questions per module

### Database Changes

No schema changes needed - tables already exist:
- `onboarding_modules` - Store module content
- `onboarding_questions` - Store quiz questions
- `onboarding_progress` - Track agent progress

### CRM Integration (Already Done)

The "View Training Course" link was added in the previous update for agents in 'onboarding' or 'training_online' stages.

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| SQL Migration | Create | Insert 4 modules with video URLs |
| `supabase/functions/generate-quiz-questions/index.ts` | Create | AI question generation |
| SQL Migration | Create | Insert AI-generated questions |

---

## Sample Quiz Question Format

Each question follows this structure:

```json
{
  "question": "What is the first step in the sales system?",
  "options": [
    "Close the deal immediately",
    "Build rapport and qualify the lead",
    "Present the full product catalog",
    "Ask for referrals"
  ],
  "correct_answer": 1,
  "explanation": "Building rapport and qualifying the lead is essential before presenting solutions."
}
```

---

## Expected Outcome

After implementation:
- 4 active modules visible in the course
- 5 AI-generated quiz questions per module (20 total)
- 90% pass threshold on all modules
- Agents must watch 90% of video before taking quiz
- Progress tracked in database
- CRM shows course link for agents in training stages

