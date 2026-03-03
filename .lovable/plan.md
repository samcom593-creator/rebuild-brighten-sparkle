

# Recruiter HQ: Spacing Polish + Record & Transcribe on Lead Cards

## Changes

### 1. Spacing Improvements (RecruiterDashboard.tsx)

**Header section**: Tighten the gap between header row items from `gap-4` to `gap-2`, reduce XP bar width from `md:w-64` to `md:w-48`, and remove `mb-1` on title row.

**Stat bubbles row**: Reduce `gap-2` to `gap-1.5`, reduce pill padding from `px-3 py-1.5` to `px-2 py-1`.

**Search/Filter bar**: Already `p-2 space-y-1` -- tighten filter button row `gap-2` to `gap-1.5`.

**Kanban columns**: Reduce empty-state padding from `py-8` to `py-4`. Reduce card-to-card `space-y-2` to `space-y-1.5`. Reduce column max-height scroll area from `65vh` to `70vh` to use more screen.

**Lead cards**: Tighten main `p-2 space-y-1` to `p-1.5 space-y-0.5`. Reduce action button row `min-h-[28px]` to `min-h-[24px]` and button sizes from `h-7 w-7` to `h-6 w-6`.

**Overall page**: Reduce `space-y-3` to `space-y-2` on the main container.

### 2. Add Record & Transcribe Button to Each Lead Card

Add a **Mic** icon button to the action button row on each lead card. When clicked, it opens the existing `InterviewRecorder` component inline for that lead -- recording audio via browser SpeechRecognition, transcribing in real-time, then auto-analyzing via the `analyze-call-transcript` edge function.

**Implementation:**
- Add `Mic` to the lucide imports (already imported at file top)
- Add state `recordingLeadId` to track which lead card has the recorder open
- Add a Mic button in the action row (after the AI Brain button) that toggles `InterviewRecorder` for that card's lead
- The `InterviewRecorder` component already handles: recording, transcription, AI analysis, saving to `interview_recordings` table, and follow-up email
- Render `InterviewRecorder` conditionally inside the lead card when `recordingLeadId === lead.id`

**Files changed:**
- `src/pages/RecruiterDashboard.tsx` -- spacing tweaks + add Mic button + recorder state in LeadCard

No database or edge function changes needed -- the existing `InterviewRecorder` component and `analyze-call-transcript` edge function handle everything.

