

# Phase 4 Enhanced: Admin Calendar with Drag-and-Drop + AI Screenshot-to-Schedule

## Current State
- `AdminCalendar.tsx` exists with basic hour grid, add/delete/complete blocks, category colors, and ICS export
- `admin_calendar_blocks` table exists with `user_id`, `title`, `start_hour`, `end_hour`, `block_date`, `category`, `completed`, `notes`
- `ai-assistant` edge function exists with Lovable AI integration — can add a new request type
- `@dnd-kit/core` and `@dnd-kit/sortable` already installed

## What to Build

### 1. Drag-and-Drop Time Block Reordering
- Use `@dnd-kit/core` with `DndContext`, `useDraggable`, `useDroppable` to allow blocks to be dragged between hour slots
- Each hour row becomes a droppable zone; each block becomes draggable
- On drop: update `start_hour`/`end_hour` in database, maintain block duration
- Visual drag overlay showing the block being moved with category color

### 2. AI Screenshot-to-Schedule
- Add a "Scan Schedule" button that opens a dialog with image upload (file input)
- Convert uploaded image to base64, send to a new `parse-schedule-image` edge function
- Edge function uses Lovable AI (`google/gemini-2.5-flash`) with vision to extract schedule items from the screenshot
- Returns structured JSON: `[{title, start_hour, end_hour, category}]`
- Auto-populate blocks from the parsed result with a preview/confirm step

### 3. Mobile-Optimized Layout
- Stack header actions vertically on mobile
- Touch-friendly block actions (always visible on mobile, not hover-only)
- Swipe-to-complete gesture via touch event handlers
- Larger tap targets for hour slots

### 4. Block Editing
- Tap/click a block to open an edit dialog (currently only add exists)
- Edit title, category, start/end time, and notes

### Files to Create/Modify

| File | Action |
|------|--------|
| `src/pages/AdminCalendar.tsx` | Add DnD context, edit dialog, AI scan button, mobile layout |
| `supabase/functions/parse-schedule-image/index.ts` | New edge function for AI vision parsing |
| `supabase/config.toml` | Add `parse-schedule-image` function config |

### Technical Details
- DnD: `DndContext` wraps hour grid. Each hour slot is a `useDroppable` with `id=hour-{n}`. Each block is `useDraggable`. `onDragEnd` calculates new start/end hours from the drop target and persists to DB.
- AI parsing: Uses `google/gemini-2.5-flash` multimodal with image input. System prompt instructs extraction of time blocks with title, start/end times, and best-guess category. Returns via tool calling for structured output.
- Mobile: `useIsMobile()` hook controls conditional rendering of touch-friendly controls.

