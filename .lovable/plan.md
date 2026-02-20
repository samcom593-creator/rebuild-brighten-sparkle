
# Add "Course Not Purchased" Flag to Kanban Cards

## What the User Wants

On Kanban board cards — specifically in the **"Course"** column and anywhere it's relevant — add a visible indicator and action button at the bottom for applicants who **have not purchased their course yet** (their `license_progress` is still `unlicensed` or `null`). The user wants to be able to:

1. **See at a glance** which people in the Course column haven't bought the course
2. **Click a button** to send them the course/licensing email right from the card

## Where This Gets Added

Three places share the Kanban card UI:

| File | What Changes |
|------|-------------|
| `src/components/pipeline/KanbanBoard.tsx` | Add "Course Not Purchased" banner + send button to `DraggableCard` when card is in the `course` column but `license_progress` is `unlicensed` or `null` |
| `src/pages/RecruiterDashboard.tsx` | Same indicator on Aisha's kanban cards in the "In Course" column for unlicensed applicants |
| `src/pages/AgentPipeline.tsx` | The **list view** cards also get a "Course Not Purchased" badge for applicants who are unlicensed |

## Logic for When to Show It

A card shows the "Course Not Purchased" indicator when:
- The applicant's `license_progress` is `unlicensed` (or `null`)
- AND the card appears in the "Course" column (because someone dragged them there or they need course action)

OR, more broadly (to catch all cases across all columns):
- The applicant is NOT licensed
- AND `license_progress` is `unlicensed` (never started the course process)

The simplest and most useful approach: **show it on any card where `license_progress === "unlicensed"` and they exist in the pipeline** — this tells the user "this person hasn't even started the course yet, go send it."

## Visual Design

At the bottom of the Kanban card (below the action buttons), add a subtle amber warning strip:

```
┌──────────────────────────────────┐
│  John Smith                      │
│  🕐 Never contacted              │
│  john@email.com                  │
│  📞 555-1234                     │
│  [View]  [📅]  [📞]              │
│──────────────────────────────────│
│  ⚠️ Course not purchased   [🎓 Send] │
└──────────────────────────────────┘
```

- Amber/orange background strip at the bottom of the card
- Small "Course not purchased" text with warning icon
- A **"Send Course"** icon button that calls the `send-licensing-instructions` edge function immediately (same as `ResendLicensingButton`)
- The button shows a checkmark briefly after sending, then resets

## Technical Changes

### `src/components/pipeline/KanbanBoard.tsx`

1. Add `onSendCourse?: (app: KanbanApplication) => void` prop to `KanbanBoardProps` and `DraggableCard`
2. Pass `recipientEmail` and `recipientName` needed to call the edge function
3. In `DraggableCard`, after the action buttons row, add a conditional block:
   ```tsx
   {app.license_progress === "unlicensed" || !app.license_progress ? (
     <div className="mt-2 flex items-center justify-between rounded-lg bg-amber-500/10 border border-amber-500/20 px-2 py-1.5">
       <span className="text-[10px] text-amber-400 flex items-center gap-1">
         <AlertCircle className="h-3 w-3" /> Course not purchased
       </span>
       <button onClick={handleSendCourse} className="...">
         <GraduationCap className="h-3 w-3" /> Send
       </button>
     </div>
   ) : null}
   ```
4. The send button calls `supabase.functions.invoke("send-licensing-instructions", ...)` inline, with a local `isSending` state for the loading spinner

### `src/pages/AgentPipeline.tsx`

In the **list view** cards, add a small amber `Badge` next to the name for unlicensed applicants:
```tsx
{!app.license_progress || app.license_progress === "unlicensed" ? (
  <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">
    <AlertCircle className="h-2.5 w-2.5 mr-1" /> Course not purchased
  </Badge>
) : null}
```

### `src/pages/RecruiterDashboard.tsx`

Aisha's cards already have the `ResendLicensingButton` — but we add the same amber "Course not purchased" strip at the bottom of her cards (inline in the card JSX where `license_progress === "unlicensed"`) so she gets the same immediate visual flag.

## No Database Changes Needed

This is purely a UI enhancement — `license_progress` already exists on every `applications` record and `unlicensed` is already the default value. No migrations required.

## Summary

- `KanbanBoard.tsx`: Add amber "Course not purchased" footer strip + inline Send button to `DraggableCard` when `license_progress === "unlicensed"`
- `AgentPipeline.tsx`: Add amber badge in list view for unlicensed applicants
- `RecruiterDashboard.tsx`: Add same amber strip to Aisha's kanban cards
