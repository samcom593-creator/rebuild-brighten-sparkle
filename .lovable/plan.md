

# Add Recurring Blocks to the Day Planner

## Overview
Add a recurring block system so users can create daily or weekly repeating time blocks. When navigating to a new date, recurring blocks auto-populate if no blocks exist for that day yet.

## Database Changes

**New table: `recurring_calendar_blocks`**
- `id` UUID PK
- `user_id` UUID NOT NULL
- `title` TEXT NOT NULL
- `start_hour` INT NOT NULL
- `end_hour` INT NOT NULL
- `category` TEXT DEFAULT 'admin'
- `notes` TEXT
- `recurrence_type` TEXT NOT NULL ('daily' | 'weekly')
- `day_of_week` INT (0-6, only used when recurrence_type = 'weekly'; 0 = Sunday)
- `is_active` BOOLEAN DEFAULT true
- `created_at` TIMESTAMPTZ DEFAULT now()

RLS: users can manage their own rows; admins can manage all.

## Frontend Changes (`AdminCalendar.tsx`)

1. **Add/Edit Dialog** — add a "Repeat" toggle with options: None, Daily, Weekly (auto-sets `day_of_week` from selected date). When repeat is chosen, insert into `recurring_calendar_blocks` instead of (or in addition to) `admin_calendar_blocks`.

2. **Auto-populate logic** — on `fetchBlocks`, after loading the day's blocks, if the day has zero blocks, query `recurring_calendar_blocks` for matching recurrences (daily + weekly matching `day_of_week`). Show a banner: "Apply X recurring blocks?" with a confirm button that bulk-inserts them into `admin_calendar_blocks` for that date.

3. **Manage Recurring Blocks** — add a small "Recurring" button in the header that opens a dialog listing all active recurring blocks with toggle/delete actions.

4. **Visual indicator** — recurring-origin blocks get a small repeat icon badge so users know they came from a template.

## Files to Modify/Create

| File | Action |
|------|--------|
| New migration SQL | Create `recurring_calendar_blocks` table + RLS |
| `src/pages/AdminCalendar.tsx` | Add recurrence toggle in form, auto-populate logic, manage recurring dialog |

