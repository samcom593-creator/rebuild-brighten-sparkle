
# APEX Elite Upgrade — Phase 1

Given the 20-section scope, we'll tackle this in focused batches. Phase 1 covers **Visual Redesign (#1)** and **New Features (#2-6)** as prioritized.

---

## Batch 1A: Visual Redesign (Section 1)

### Typography
- Import **Syne** (400,600,700,800) for headings, nav, buttons, badges
- Import **DM Sans** (300,400,500) for body text, inputs
- Add Google Fonts link to `index.html`
- Update CSS with font-family rules

### Color System
- Add APEX color tokens to `index.css`: `--apex-black`, `--apex-navy`, `--apex-surface`, `--apex-border`, `--apex-green`, `--apex-gold`, `--apex-text`, `--apex-muted`
- Map to Tailwind config

### Landing Page Redesign
- Hero: dark bg, Syne 800 headline with green accent, animated counter, 3 stat pills
- Floating geometric shapes (CSS only)
- DealsTicker: sleek horizontal scroll bar
- Benefits: dark cards with green left border
- CTA: full-width dark, two buttons (Apply = green, Schedule Call = outline)
- All buttons: Syne 700, letter-spacing

### Dashboard Visual Upgrade
- Darker sidebar gradient
- Premium stat cards with animated counters + trend indicators
- Glass cards upgrade (gradient bg, border transitions, blur)
- Page transition animations (framer-motion fade+slide)

---

## Batch 1B: New Features (Sections 2-6)

### Section 2: Face-Lock Profile Pictures
- Add `face-api.js` dependency
- Upgrade AvatarUpload to detect faces, auto-crop, reject no-face photos
- Save face-cropped 400×400 version

### Section 3: Field Agent Mobile Check-In
- New page `/field-checkin` with GPS, client form, outcome selector, voice notes
- Offline support with localStorage queue
- New `field_checkins` table (migration)
- Add to sidebar navigation

### Section 4: AI Applicant Scoring
- New edge function `score-applicant` (rule-based 0-100 scoring)
- Add `ai_score` + `ai_score_tier` columns to applications table
- Show score badges in CRM/Applicants views
- "Hot Leads Only" filter toggle

### Section 5: Churn Detection
- New edge function `check-churn-risk` (daily risk scoring)
- New `churn_risk_alerts` table (migration)
- Dashboard banner with risk badges + recovery actions

### Section 6: Commission Calculator
- New component with ALP slider, tier selector, live calculations
- Add to Agent Portal and Numbers page

---

## Implementation Order
1. Fix build error ✅ (done)
2. Typography + Color System
3. Landing Page visual overhaul
4. Dashboard + Glass Card upgrades
5. Commission Calculator (smallest new feature)
6. AI Applicant Scoring (edge function + UI)
7. Field Check-In (new page + table)
8. Face-Lock Profiles
9. Churn Detection

Each batch will be confirmed before moving to the next.
