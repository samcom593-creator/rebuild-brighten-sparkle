
# Plan: Call Center Optimization - Actions, AI Call Summary & Lead Reassignment

## Summary

Optimize the Call Center with three major improvements:
1. **Simplify action buttons** - Keep: Contacted, Contracted, Hired (replacing Licensing), Bad Applicant (renamed from Not Qualified), remove No Pickup
2. **Replace raw transcription with AI call summary** - Instead of showing word-by-word transcription, use AI to analyze the recording and provide a structured breakdown
3. **Admin-only lead reassignment button** - Quick button to assign leads to any manager's pipeline

---

## 1. Action Button Changes

### Current Buttons (6)
- Contacted
- Hired
- Contracted
- Licensing (unlicensed only)
- Not Qualified
- No Pickup

### New Buttons (4)
| Button | Action ID | Icon | Purpose |
|--------|-----------|------|---------|
| Contacted | `contacted` | MessageSquare | Mark as contacted |
| Hired | `hired` | CheckCircle2 | Mark as hired (decision made) |
| Contracted | `contracted` | FileText | Mark as contracted |
| Bad Applicant | `bad_applicant` | XCircle | Disqualify lead |

### Files to Modify
- `src/components/callcenter/CallCenterActions.tsx`
- `src/pages/CallCenter.tsx` (update action handler for new IDs)

---

## 2. AI Call Summary (Replace Raw Transcription)

### Current Problem
The voice recorder shows every word transcribed in real-time, which is overwhelming and not useful. Users want an **analyzed summary** instead.

### Solution
1. Record/transcribe the call as before (using Web Speech API)
2. When recording stops, send the full transcript to AI for analysis
3. Display a structured call summary with:
   - Key Points discussed
   - Lead Sentiment (positive/neutral/negative)
   - Action Items identified
   - Recommended next steps

### Technical Implementation

**New Edge Function**: `analyze-call-transcript`
- Takes raw transcript as input
- Uses Lovable AI (gemini-2.5-flash) to analyze
- Returns structured summary

**Updated CallCenterVoiceRecorder.tsx:**
- Keep transcription running in background (for accuracy)
- On stop: send transcript to edge function for analysis
- Display summary instead of raw text
- Option to view full transcript if needed

### AI Summary Output Format
```typescript
interface CallSummary {
  keyPoints: string[];
  sentiment: "positive" | "neutral" | "negative";
  actionItems: string[];
  recommendation: string;
  briefSummary: string;
}
```

---

## 3. Admin-Only Lead Reassignment Button

### Feature
- Only visible to admins
- Appears on the lead card in Call Center
- Click to open manager selector dropdown
- Select manager to reassign lead to their pipeline

### Implementation
- Add "Reassign Lead" button to `CallCenterLeadCard.tsx`
- Reuse existing `QuickAssignMenu` component logic
- Conditionally render based on `isAdmin` prop
- For both `aged_leads` and `applications` tables:
  - `aged_leads`: Update `assigned_manager_id`
  - `applications`: Update `assigned_agent_id`

---

## Files to Modify

### 1. `src/components/callcenter/CallCenterActions.tsx`
```typescript
// Updated ActionId type
export type ActionId = "contacted" | "hired" | "contracted" | "bad_applicant";

// New actions array (4 buttons)
const actions: ActionDef[] = [
  { id: "contacted", label: "Contacted", icon: MessageSquare, color: "text-teal-400", ... },
  { id: "hired", label: "Hired", icon: CheckCircle2, color: "text-green-400", ... },
  { id: "contracted", label: "Contracted", icon: FileText, color: "text-blue-400", ... },
  { id: "bad_applicant", label: "Bad Applicant", icon: XCircle, color: "text-red-400", ... },
];
```

### 2. `src/components/callcenter/CallCenterVoiceRecorder.tsx`
- Add `onAnalyzeComplete` callback prop
- Add state for `isAnalyzing` and `callSummary`
- On stop recording: call edge function for AI analysis
- Display structured summary UI instead of raw transcript

### 3. `supabase/functions/analyze-call-transcript/index.ts` (NEW)
- Edge function to analyze call transcripts using Lovable AI
- Returns structured summary with key points, sentiment, action items

### 4. `src/components/callcenter/CallCenterLeadCard.tsx`
- Add `isAdmin` prop
- Add "Reassign Lead" button (admin-only)
- Import and use manager dropdown component

### 5. `src/pages/CallCenter.tsx`
- Pass `isAdmin` to CallCenterLeadCard
- Update action handler for new action IDs (`bad_applicant` instead of `not_qualified`)
- Remove `no_pickup` and `licensing` handling
- Update keyboard shortcuts (1-4 for 4 buttons)

### 6. `src/components/callcenter/index.ts`
- Update exported types to reflect new ActionId

---

## UI Changes

### Call Center Actions (Before → After)
```text
Before (6 buttons):
[Contacted] [Hired] [Contracted]
[Licensing] [Not Qualified] [No Pickup]

After (4 buttons):
[Contacted] [Hired]
[Contracted] [Bad Applicant]
```

### Voice Recording (Before → After)
```text
Before:
"Call Notes (Live Transcription)"
Hi I'm calling about the insurance position you applied for
um yeah I'm interested in learning more about it actually
I have some experience in sales from my previous job...
[entire word-by-word transcript]

After:
"Call Summary"
┌─────────────────────────────────────┐
│ 📋 Key Points                        │
│ • Candidate has sales experience     │
│ • Interested in insurance career     │
│ • Available to start next week       │
├─────────────────────────────────────┤
│ 😊 Sentiment: Positive               │
├─────────────────────────────────────┤
│ ✅ Action Items                      │
│ • Send contracting paperwork         │
│ • Schedule onboarding call           │
├─────────────────────────────────────┤
│ 💡 Recommendation: Move to Hired     │
└─────────────────────────────────────┘
[View Full Transcript]
```

### Lead Card (Admin-Only Addition)
```text
┌─────────────────────────────────────┐
│ John Smith                          │
│ Aged Lead • Unlicensed              │
│ ...                                 │
│ [📞 CALL] [📧 Email] [🔀 Reassign] │  ← New button for admin
└─────────────────────────────────────┘
```

---

## Data Flow

### AI Call Analysis
```text
User stops recording
        ↓
Full transcript sent to edge function
        ↓
Edge function calls Lovable AI (gemini-2.5-flash)
        ↓
AI returns structured analysis
        ↓
UI displays formatted summary
        ↓
Summary saved to lead notes
```

### Lead Reassignment
```text
Admin clicks "Reassign"
        ↓
Manager dropdown appears
        ↓
Admin selects manager
        ↓
Database updated:
  - aged_leads.assigned_manager_id = managerId
  - OR applications.assigned_agent_id = managerId
        ↓
Lead moves to new manager's pipeline
```

---

## Expected Outcomes

1. **Cleaner action buttons** - 4 focused actions instead of 6
2. **Useful call summaries** - AI-analyzed breakdown instead of overwhelming raw text
3. **Fast lead distribution** - Admins can quickly assign leads to managers
4. **Keyboard shortcuts updated** - 1-4 for actions, N to skip, ESC to exit
