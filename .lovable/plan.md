

# Fix Course Video Auto-Progression

## Problems

1. **At 90% watched, the system auto-switches to the Quiz tab** -- This is disruptive. The `onVideoComplete` callback fires at 90% and forces the tab to "quiz", pulling the agent away from the video before it finishes.

2. **After passing, the system auto-advances to the next module after 2 seconds** -- Agents don't get a moment to breathe. They should choose when to move forward.

## Changes

### 1. Stop auto-switching to Quiz tab at 90% (`OnboardingCourse.tsx`)

- Remove the `handleVideoComplete` callback that calls `setActiveTab("quiz")`.
- Instead, when progress hits 90%, just show a subtle "Quiz Unlocked" banner below the video -- the agent decides when to click the Quiz tab themselves.

### 2. Remove auto-advance after passing quiz (`OnboardingCourse.tsx`)

- Remove the `setTimeout` in `handleQuizSubmit` that auto-navigates to the next module after 2 seconds.
- The existing "Continue to Next Module" button on the quiz results screen already lets agents self-progress. That button stays.

### 3. Show "Quiz Ready" prompt on video tab instead of forcing tab switch (`CourseVideoPlayer.tsx`)

- The `onVideoComplete` callback currently triggers the tab switch. After this change, it will do nothing (or optionally show a toast). The video player's overlay already shows "Quiz unlocked! You can proceed." at 90% -- that's sufficient guidance.

## Technical Details

### File: `src/pages/OnboardingCourse.tsx`

- Line 78-82: Change `handleVideoComplete` to a no-op or remove the `setActiveTab("quiz")` call
- Lines 88-94: Remove the `setTimeout` that auto-advances to the next module after quiz pass

### File: No changes needed to `CourseVideoPlayer.tsx` or `CourseQuiz.tsx`

The video player already shows the "Quiz unlocked" message in the progress overlay. The quiz already has a "Continue to Next Module" button. Both are fine as-is.

