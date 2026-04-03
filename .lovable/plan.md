

# Upgrade Award Profiles Panel: Show Only Producing Agents + Visual Overhaul

## Summary
Filter the Agent Award Profiles panel to only show agents who have actual production (deals_closed > 0), and redesign the panel with a premium, elite visual style including better avatars, status indicators, and smoother edit UX.

## Changes to `src/components/awards/AwardProfilesPanel.tsx`

### 1. Filter to only agents with deals
- After fetching agents, also query `daily_production` grouped by `agent_id` to get agents with `SUM(deals_closed) > 0`
- Cross-reference to only show agents who appear in that set
- Sort by total ALP descending so top producers appear first

### 2. Visual overhaul — make it elite
- Larger avatar (h-16 w-16) with a gold ring/border for agents who have an award photo set
- Show total ALP and deal count as small stats under each name
- Green dot indicator when award photo is uploaded, amber when missing
- Gradient card backgrounds with subtle hover glow effects
- Use `backdrop-blur` glass-card styling
- Instagram handle shown as a colored pill badge
- Edit mode: slide-in animation instead of abrupt swap, cleaner input layout
- Photo upload: show a camera overlay on the avatar itself (tap avatar to upload)
- "Profile complete" vs "Needs photo" status badges
- Search/filter input at the top to quickly find agents by name

### 3. Additional polish
- Add agent count badge in the header ("12 producers")
- Collapsible panel with smooth animation (default expanded)
- Success animations on save (brief green flash)
- Show "last updated" timestamp on each profile card

## Files Modified
- **`src/components/awards/AwardProfilesPanel.tsx`** — Complete rewrite with production filter, elite styling, better UX

