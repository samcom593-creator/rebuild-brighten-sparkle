

# Upgrade Interview Recorder to Match Call Center AI Summary

## Problem
The "Voice" button in Applications opens the old `InterviewRecorder` component which only does basic speech-to-text transcription and saves raw text. Meanwhile, the Call Center has a much better `CallCenterVoiceRecorder` that automatically analyzes the transcript with AI and displays a rich summary (key points, sentiment, action items, recommendation, follow-up email button).

## Solution
Replace the `InterviewRecorder` component with an upgraded version that mirrors the Call Center experience:

1. **Record and transcribe** (same as now -- browser speech recognition)
2. **Auto-analyze with AI** when recording stops (calls `analyze-call-transcript` edge function, same as Call Center)
3. **Display rich AI summary** with key points, sentiment, action items, and recommendation
4. **Save both transcript and summary** to the `interview_recordings` table
5. **Include waveform visualization** during recording (same as Call Center)
6. **Add follow-up email option** post-analysis

## Files to Modify

### 1. `src/components/dashboard/InterviewRecorder.tsx`
Rewrite to incorporate Call Center voice recorder features:
- Add audio waveform canvas visualization during recording
- After stopping, automatically call `analyze-call-transcript` edge function
- Display the AI summary panel (key points, sentiment, action items, recommendation, brief summary)
- Allow viewing/hiding the raw transcript
- Save both transcript AND AI summary JSON to the database
- Keep the same props interface so `DashboardApplicants.tsx` doesn't need changes

### 2. Database Migration
Add a `summary` JSONB column to the `interview_recordings` table to store the AI analysis alongside the raw transcript. This lets dashboards display the summary without re-analyzing.

## Technical Details

- Reuses the existing `analyze-call-transcript` edge function (already deployed, uses Lovable AI)
- Same speech recognition API and waveform visualization pattern from `CallCenterVoiceRecorder`
- Summary structure: `{ keyPoints, sentiment, actionItems, recommendation, briefSummary }`
- No new edge functions needed -- the analysis function is shared
- The component keeps its same external interface (`applicationId`, `agentId`, `applicantName`, `onClose`, `onTranscriptionSaved`) so no changes are needed in `DashboardApplicants.tsx`

