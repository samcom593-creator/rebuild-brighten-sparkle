
# Plan: Premium Call Center with AI Voice Recording & Auto Follow-Up Emails

## Summary

This plan delivers a **world-class Call Center** with AI-powered voice recording for automatic note-taking, premium high-tech UI effects, pipeline stage tracking, last contact visibility, and automated follow-up emails after every contact.

---

## Features to Implement

### 1. AI Voice Recording with Auto-Transcription
- **Record calls** using browser's Web Speech API (already exists in `InterviewRecorder.tsx`)
- **Live transcription** as you speak - notes appear in real-time
- **Auto-save notes** to the lead's record when call ends
- Single button to start/stop recording with pulsing animation

### 2. Premium High-Tech UI Redesign
- **Glass morphism cards** with subtle glow effects
- **Animated transitions** between leads (slide/fade with framer-motion)
- **Pulsing recording indicator** when voice recording active
- **Progress ring** instead of bar (more premium feel)
- **Gradient accent buttons** with hover animations
- **"Call Active" mode** with visual indicator when phone is active
- **Waveform visualizer** during recording

### 3. Pipeline Stage Selector
- Visual stage selector showing where lead is in pipeline:
  - New → Contacted → Qualified → Contracted → Onboarding → Active
- Quick-select to update stage directly from Call Center
- Color-coded badges for each stage

### 4. Last Contact Display
- Show **last contact date** for each lead
- Display **contact method** (call, email, text)
- Time ago format ("2 days ago", "1 week ago")

### 5. Automatic Follow-Up Emails
After marking a lead as "Contacted":
- **Trigger automatic email** saying "Great talking to you!"
- Include **calendar link** to rebook if needed
- Uses existing Resend email infrastructure

---

## Technical Architecture

### New Edge Function: `send-post-call-followup`
Sends branded email after a call:
- Subject: "Great Talking to You, [Name]! 📞"
- Body: Warm message about the conversation
- Includes Calendly link based on license status
- Updates `contacted_at` timestamp

### UI Component Structure
```
CallCenter.tsx (redesigned)
├── CallCenterFilters (source, license, status)
├── CallCenterLeadCard (premium card with lead info)
│   ├── VoiceRecorder (inline recording controls)
│   ├── LastContactBadge (contact history)
│   ├── PipelineStageSelector (stage dropdown)
│   └── NotesEditor (quick notes with transcription)
├── CallCenterActions (premium action buttons)
└── CallCenterProgress (ring progress indicator)
```

### Database Interactions
- **aged_leads.notes**: Append transcription
- **applications.notes**: Append transcription
- **applications.contacted_at**: Update on contact
- **contact_history**: Log each interaction

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/send-post-call-followup/index.ts` | Auto email after contact |

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/CallCenter.tsx` | Complete premium redesign with voice recording, stage selector, last contact |
| `supabase/config.toml` | Register new edge function |

---

## Visual Design Details

### Lead Card (Premium Glass Effect)
- Soft glow border on hover
- Gradient background header with lead source badge
- Large, readable phone number with "Tap to Call" button
- Recording indicator (pulsing red dot) when active
- Live transcription area that expands when recording

### Action Buttons (Gradient Style)
- **Contacted**: Teal gradient with check icon
- **Hired**: Green gradient with success animation
- **Contracted**: Blue gradient with document icon
- **Not Qualified**: Subtle red outline
- **No Pickup**: Amber with phone-off icon

### Progress Indicator
- Circular ring progress (not bar)
- Shows X of Y leads processed
- Animated count-up numbers

---

## Auto Follow-Up Email Content

**Subject**: "Great Talking to You, [First Name]! 📞"

**Body** (for licensed leads):
```
Hey [First Name]!

It was great chatting with you just now! I'm excited about the possibility 
of having you join the APEX team.

If you have any questions or want to continue our conversation, feel free 
to book another call:

[Schedule Follow-Up Call Button → Calendly Link]

Looking forward to working with you!

– The APEX Team
```

**Body** (for unlicensed leads):
```
Hey [First Name]!

Great talking with you! I know the licensing process can seem overwhelming, 
but we're here to help every step of the way.

If you need any guidance or want to chat more:

[Schedule a Call Button → Calendly Link]

You've got this!

– The APEX Team
```

---

## User Flow

1. **Open Call Center** → Select filters → Click "Start Calling"
2. **View lead card** with premium glass design
3. **Click phone number** to initiate call
4. **Click "Record Call"** → AI transcription starts automatically
5. **Speak** → Watch notes appear in real-time
6. **Click "Stop Recording"** → Notes are saved
7. **Select action** (Contacted, Hired, etc.)
8. **If "Contacted"** → Auto email sent with calendar link
9. **Next lead slides in** with smooth animation

---

## Keyboard Shortcuts (Enhanced)
- `R` - Start/Stop recording
- `1-5` - Quick actions
- `N` - Skip to next
- `ESC` - Exit call mode

---

## Technical Implementation Notes

### Voice Recording
Uses the existing `SpeechRecognition` API pattern from `InterviewRecorder.tsx`:
- Browser-native, no external API needed
- Continuous transcription with interim results
- Fallback message for unsupported browsers

### Email Sending
Uses existing Resend infrastructure:
- RESEND_API_KEY already configured
- Follows same email template patterns as other functions
- Branded APEX styling

### Stage Updates
Maps to existing application status enum:
- new → reviewing → contracting → approved
- Updates `status`, `contacted_at`, `contracted_at` as appropriate

---

## Expected Outcomes

After implementation:
- Premium, high-tech Call Center interface
- Voice recording with live AI transcription
- Automatic follow-up emails on every contact
- Pipeline stage visibility and quick updates
- Last contact tracking on every lead
- Smooth animations and professional UX
- Keyboard shortcuts for power users
