

# Award Graphics System Overhaul: New Award Types, Date Picker, Profile Management, Editable Results

## Summary
Expand the awards system from 2 graphics (Top Producer + Leaderboard) to 6 award types, add a date picker for precise date selection, build a profile photo/IG management panel, and make generated awards editable before download.

## Database Changes

### Modify `award_batches` table
Add a column for the award type:
```sql
ALTER TABLE award_batches ADD COLUMN award_type text NOT NULL DEFAULT 'top_producer';
```

### New table: `agent_award_profiles`
Stores saved profile photos and Instagram handles specifically for award graphics:
```sql
CREATE TABLE agent_award_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL UNIQUE,
  photo_url text,
  instagram_handle text,
  display_name_override text,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE agent_award_profiles ENABLE ROW LEVEL SECURITY;
-- Admin-only management
CREATE POLICY "Admins can manage award profiles" ON agent_award_profiles FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Managers can manage award profiles" ON agent_award_profiles FOR ALL USING (has_role(auth.uid(), 'manager'::app_role));
```

## New Award Types (6 total)

| Award | Data Source | Logic |
|-------|-----------|-------|
| **Top Producer** (existing) | `daily_production.aop` | Highest ALP for period |
| **Leaderboard** (existing) | `daily_production.aop` | Top 8 ranked by ALP |
| **First Deal Today** | `daily_production` for today | First agent with deals_closed > 0 on that date (earliest `created_at`) |
| **Top Producer of the Week** | `daily_production` Mon–Sun | Highest weekly ALP |
| **Most Hires of the Week** | `applications` where `status = 'hired'` | Agent with most hires (by `assigned_agent_id`) that week |
| **Most Hires of the Month** | `applications` where `status = 'hired'` | Agent with most hires that month |

## UI Changes to `src/pages/AwardGraphics.tsx`

### 1. Award Type Selector
Add a new dropdown for award type (Top Producer, Leaderboard, First Deal Today, Top Producer of the Week, Most Hires Week, Most Hires Month).

### 2. Custom Date Picker
Add a date input field next to the period selector. When a specific date is chosen, it overrides the period dropdown. The edge function already supports `custom_start`/`custom_end` — wire them up.

### 3. Agent Award Profiles Panel
New card section "Agent Profiles" showing a grid of agents with:
- Current saved photo (from `agent_award_profiles.photo_url` or fallback to `profiles.avatar_url`)
- Instagram handle (pre-filled from `profiles.instagram_handle`, editable and saved to `agent_award_profiles`)
- Display name override
- Upload button to set/change award photo

### 4. Editable Generated Awards
After generation, instead of just showing the image + download:
- Show editable fields below each image: winner name, IG handle, amount
- "Regenerate with changes" button that re-calls the edge function with overrides
- Direct download button on each image
- Tap an image to see it full-screen with download option

## Edge Function Changes (`generate-award-graphics/index.ts`)

### Accept new parameters
```typescript
{
  award_type: "top_producer" | "leaderboard" | "first_deal" | "top_producer_week" | "most_hires_week" | "most_hires_month",
  time_period: string,
  custom_date: string, // specific date override
  custom_start: string,
  custom_end: string,
  overrides: { name?: string, instagram?: string, amount?: number } // for edits
}
```

### New data queries per award type
- **First Deal Today**: Query `daily_production` for the target date, filter `deals_closed > 0`, order by `created_at ASC`, take first
- **Most Hires Week/Month**: Query `applications` where `contracted_at` (or `closed_at`) falls within the period, group by `assigned_agent_id`, count, rank

### Pull Instagram handles
Query `agent_award_profiles` first (override), fall back to `profiles.instagram_handle`. Include IG handle in the generated image prompt as `@handle` text.

### Pull award photos
Query `agent_award_profiles.photo_url` first, fall back to `profiles.avatar_url`. If a real photo URL exists, pass it to the AI prompt as a reference image for the portrait circle.

## Files Modified
- **`src/pages/AwardGraphics.tsx`** — Add award type selector, date picker, profiles panel, editable results with download
- **`supabase/functions/generate-award-graphics/index.ts`** — Support new award types, accept overrides, pull IG/photos from award profiles table
- **Database migration** — Add `award_type` column to `award_batches`, create `agent_award_profiles` table

