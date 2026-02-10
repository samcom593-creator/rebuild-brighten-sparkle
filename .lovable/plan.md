
# Aged Leads Full Overhaul: Clean UI, Data Fixes, and Email Blast Confirmation

## What's Changing

### 1. Database Data Fixes (Immediate)
- **Set all 56 imported leads to `licensed`** status (currently all showing as `unlicensed`)
- **Remove duplicate leads** (e.g., Ashley Seborowski appears twice, Jacob Thompson appears twice)
- **Confirm email blast status**: Only leads WITH an email address can be emailed. Most of your imported leads have no email (phone/Instagram only), so they cannot receive email outreach. Leads that DO have emails have already been blasted via the `send-aged-lead-email` function.

### 2. Complete UI Redesign of DashboardAgedLeads.tsx

The current card grid layout is bulky and wastes space. Replacing it with a **compact, high-tech table/list view** with premium styling:

- **Stats bar**: Animated count-up numbers with subtle glow effects, cleaner icon containers with gradient backgrounds
- **Filters**: Inline pill-style filter bar (not stacked selects) with smooth transitions
- **Lead list**: Switch from bulky 3-column card grid to a **sleek compact list** with:
  - Avatar initials circle with gradient border
  - Name, contact info (phone/email/Instagram) shown inline with icons
  - License badge + status badge right-aligned
  - Motivation/notes as a subtle italic line beneath
  - Hover glow effect on each row
  - Staggered fade-in animations on load
- **Contact info display**: Show ALL available contact methods (email, phone, AND Instagram) -- currently Instagram is hidden from cards
- **Quick actions**: Slide-out or inline compact buttons (not a full "Quick Actions:" label block)
- **Empty states**: Cleaner with subtle gradient backgrounds
- **Search**: Extend search to also match phone numbers and Instagram handles (currently only searches name/email)

### 3. Remove Active Team Members from Aged Leads

Cross-reference aged leads against the active agents roster. Any aged lead whose name closely matches an active agent who is already licensed and active will be flagged and removed. Based on the data check, no exact matches exist between current active agents and aged leads, but the system will be built to auto-detect this going forward.

## Technical Details

### Database Operations (via data tool)

```sql
-- 1. Update all 56 imported leads to licensed
UPDATE aged_leads SET license_status = 'licensed' WHERE license_status = 'unlicensed';

-- 2. Remove duplicate Ashley Seborowski (keep most recent)
-- Remove duplicate Jacob Thompson (keep most recent)
-- IDs to delete determined from query results
```

### File: `src/pages/DashboardAgedLeads.tsx` (Full rewrite of render)

Key changes:
- Replace card grid with compact list rows
- Each lead row: initials avatar | name + contact stack | badges | hover actions
- Add Instagram icon display (currently missing from UI even though data exists)
- Animated counter components for stats
- Smoother filter transitions with framer-motion
- Search expanded to phone/Instagram
- Premium hover effects: `hover:shadow-lg hover:shadow-primary/5 transition-all duration-200`
- Staggered list entrance animations

### Stats Section Upgrade
- Use animated number counters (AnimatedNumber component already exists in the project)
- Gradient icon backgrounds instead of flat colored circles
- Add "Licensed" and "Emailed" counts to stats bar

### Lead Row Design (replacing cards)
```text
+---+--------------------+------------------+-----------+----------+
| AV| Name               | Contact          | Status    | Actions  |
|   | + motivation line   | phone/email/ig   | badges    | icons    |
+---+--------------------+------------------+-----------+----------+
```

Each row will have:
- Gradient-bordered initials avatar
- Name (bold) with motivation text below in muted italic
- Contact methods shown as clickable icon chips (phone, email, Instagram)
- Status + license badges
- Compact icon-only action buttons on hover

### CSS/Styling
- Uses existing glass morphism, gradient, and animation utilities from index.css
- Adds hover glow via existing `glow-teal` class
- Uses framer-motion for staggered list animations (already imported)
- Leverages the project's AnimatedNumber component for stat counters

### Files to Modify
| File | Change |
|------|--------|
| `src/pages/DashboardAgedLeads.tsx` | Complete UI overhaul -- compact list, animations, Instagram display, search improvements |
| Database (data operations) | Set all leads to licensed, remove duplicates |
