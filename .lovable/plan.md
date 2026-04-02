

# Instagram Award Graphics Automation System

## Summary
Build an edge function that pulls live production data, generates two Instagram Story graphics (Top Producer + Leaderboard) as PNG files using the AI image generation gateway, archives results to a new `award_batches` table, and exposes an admin UI page to trigger/view/search awards.

## Database

### New table: `award_batches`
```sql
CREATE TABLE public.award_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  time_period text NOT NULL,        -- 'today', 'this_week', 'this_month', etc.
  metric_type text NOT NULL DEFAULT 'AP',
  period_start date,
  period_end date,
  winner_agent_id uuid REFERENCES agents(id),
  winner_name text,
  winner_amount numeric,
  top_agents jsonb,                 -- array of {rank, agent_id, name, amount}
  top_producer_file text,           -- storage path
  leaderboard_file text,            -- storage path
  status text DEFAULT 'ready_for_review', -- 'published', 'ready_for_review', 'data_review_required'
  source_data jsonb
);
ALTER TABLE public.award_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access" ON public.award_batches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
```

### New storage bucket: `award-graphics`
Public bucket for generated PNGs.

## Edge Function: `generate-award-graphics`

**Inputs**: `{ time_period, metric_type, auto_publish }`

**Logic**:
1. Calculate date range from `time_period` (today, this_week, this_month, last_week, last_month, custom)
2. Query `daily_production` aggregated by agent for the range, joined with agent names and avatar URLs
3. Rank by selected metric (ALP default), tiebreak by deals then earliest date then alphabetical
4. Build structured data for top 8 + winner
5. Call the Lovable AI image generation API (`google/gemini-3-pro-image-preview`) twice with precise prompts describing the exact template layouts from the reference images:
   - **Top Producer**: Black background, "TOP PRODUCER" serif header, agent name bold caps, large portrait area, green dollar amount with period label, "APEX FINANCIAL" footer
   - **Leaderboard**: Black background, podium layout with crown on #1, circular photos for top 3 with yellow dollar amounts, white bars for ranks 4-8
6. Upload both PNGs to `award-graphics` storage bucket with naming convention: `apex_{type}_{metric}_{period}_{yyyy_mm_dd}.png`
7. Insert archive record into `award_batches`
8. Return JSON with status, file URLs, and archive info

**Agent photos**: Use `avatar_url` from profiles. If null, use a dark placeholder circle with initials.

## Admin UI: New page `/dashboard/awards`

### Generate Panel
- Period selector (Today, This Week, This Month, Last Week, Last Month, Custom Range)
- Metric selector (AP, Issue Paid)
- "Generate Awards" button
- Preview of both generated images side by side
- Publish / Download buttons

### Archive Panel
- Searchable table of all past `award_batches`
- Filter by date range, agent name, metric type
- Click to view/download past graphics
- Shows winner name, amount, period, and top 8 list

### Quick Actions
- "Generate Today's Awards" one-click button
- "Regenerate" for any past batch

## Files

### New
- `supabase/functions/generate-award-graphics/index.ts` — Main edge function
- `src/pages/AwardGraphics.tsx` — Admin page for generating/viewing/searching awards

### Modified
- `src/App.tsx` — Add `/dashboard/awards` route
- `src/components/layout/GlobalSidebar.tsx` — Add Awards link
- Database migration for `award_batches` table + storage bucket

## Technical Notes
- Uses `google/gemini-3-pro-image-preview` for high-quality image generation matching the reference style
- Agent display names use the alias map (Moody = Mahmod, KJ = Kaeden, Chudi = Chukwudi, Obi = Obiajulu)
- Photos are pulled from the `avatars` bucket; fallback to initials on dark circle
- The same prompt template is used every run to ensure visual consistency — only data fields change
- All generated images are 1080x1920 portrait format

