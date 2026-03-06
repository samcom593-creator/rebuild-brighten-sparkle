

# Fix Pipeline Cards & Dashboard Button Alignment

## Problems Identified

1. **PipelineCard action buttons too small and cramped** — `h-7 w-7` with `gap-1`, hard to tap on mobile
2. **PipelineCard missing key actions** — no Record (Mic) button, no GraduationCap (send coursework) button, no Email button, no notification bell
3. **Kanban columns need scroll extension** — `max-h-[60vh]` may cut off cards; needs full vertical scroll
4. **ResendLicensingButton has no explicit size** — inherits default which may not match other buttons

## Changes

### File: `src/components/pipeline/PipelineCard.tsx`

**Increase button sizes and spacing:**
- Change action row from `gap-1` to `gap-1.5`
- Change buttons from `h-7 w-7` to `h-8 w-8`
- Change icons from `h-3.5 w-3.5` to `h-4 w-4`

**Add missing action buttons (after existing ones):**
- **Email** button — `mailto:` link with Mail icon
- **GraduationCap** button — triggers `send-licensing-instructions` edge function (sends coursework + licensing info with push/SMS/email notifications). Same logic as existing `CourseSendStrip` but as an icon button always visible
- **Record** button — placeholder that opens the ApplicationDetailSheet (since InterviewRecorder needs agentId context not available in PipelineCard, we make the Eye button the entry point)

Actually, to keep it clean and functional:
- Add `ResendLicensingButton` import and render it (the GraduationCap button) for unlicensed leads
- Add a `mailto:` Email icon button
- Wrap action row in `flex-wrap` so buttons flow to next line on narrow columns instead of overflowing

**Props additions:**
- Accept `licenseStatus` from `PipelineCardData` (already available)

### File: `src/components/pipeline/KanbanBoard.tsx`

- Change column `max-h-[60vh]` to `max-h-[75vh]` for more scroll room

### File: `src/components/callcenter/ResendLicensingButton.tsx`

- Add explicit `h-8 w-8` sizing to the Button so it aligns consistently across all dashboards

### Summary of button standardization across dashboards

All action buttons across RecruiterHQ, Pipeline, and Applicants will use:
- Minimum `h-8 w-8` touch targets (32px)
- `h-4 w-4` icons
- `gap-1.5` spacing
- `flex-wrap` on action rows to prevent overflow

