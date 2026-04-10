

# APEX Targeted Fixes — Implementation Plan

This covers all 11 fixes from the uploaded prompt. Each fix is a discrete unit of work.

---

## Fix 1: Logo Fitting in Sidebar

**File:** `src/components/layout/GlobalSidebar.tsx`

- Change logo font-size from `22px` to `18px`
- Add `overflow-hidden`, `whitespace-nowrap` to the logo container
- Ensure padding is `0 16px` on the header
- Keep layout: "APEX" white + green dot + "Financial" in `#22d3a5`

---

## Fix 2: Video Skip Prevention (Critical)

**File:** `src/components/course/CourseVideoPlayer.tsx`

**NativeVideoPlayer changes:**
- Add `maxWatchedRef` to track furthest watched position
- Add `seeking` listener that snaps back if user seeks beyond `maxWatchedRef + 1`
- Update `maxWatchedRef` on `timeupdate`
- Hide native seek bar via CSS: `video::-webkit-media-controls-timeline { display: none !important }`
- Show read-only progress bar: "Watched X% — need 80% to unlock quiz"
- Add speed controls (0.5x/1x/1.5x/2x)
- Save `maxWatchedTime` to DB every 15 seconds via the existing progress callback
- Change threshold from 90% to 80% for quiz unlock

**YouTubePlayer:** Already has polling + speed controls. Will add note that YouTube's built-in controls can't be fully blocked, but progress tracking remains enforced server-side.

**CSS:** Add global style in `index.css` to hide native timeline.

---

## Fix 3: Team Directory Full Profile Editing

**File:** `src/pages/TeamDirectory.tsx`

- Add `[Edit Profile]` button on every person card
- Opens a Sheet/Dialog with fields: photo upload, name, email, phone, role (Agent/Leader/Manager/Admin), manager assignment dropdown, Instagram handle, license status, NIPR number, licensed states (multi-select), start date, notes
- `[Save Changes]` updates `profiles` + `applications` tables
- `[Deactivate Agent]` red button with confirmation dialog
- `[Reset Password]` calls `reset-agent-password` edge function
- Cards display: photo, name, role badge, weekly ALP, stage, manager name, last active

---

## Fix 4: Sidebar Restructure

**File:** `src/components/layout/GlobalSidebar.tsx`

The sidebar already has the dark gradient background and most sections. Adjustments:
- Confirm section labels: `10px Syne, uppercase, letter-spacing 3px, color #334155`
- Nav items: `DM Sans 14px, color #94a3b8, padding 10px 16px, border-radius 8px`
- Active state: `bg rgba(34,211,165,0.08)`, left border `2px solid #22d3a5`, text `#22d3a5`
- Hover: `bg rgba(255,255,255,0.04)`
- Bottom section: user avatar + name + email, theme toggle, fullscreen, sign out, "POWERED BY APEX FINANCIAL" footer text

Most of this is already in place — will fine-tune font-family, spacing, and letter-spacing to match spec exactly.

---

## Fix 5: Remove Venmo and CashApp

**Files:**
- `src/pages/PurchaseLeads.tsx` — Remove `VENMO_LINK`, `CASHAPP_LINK`, Venmo/CashApp buttons. Replace with single `[Purchase Now]` button that calls `create-checkout-session` edge function for Stripe hosted checkout
- `src/components/landing/ApexLeadsSection.tsx` — Remove Venmo/CashApp payment flow, replace with Stripe checkout button
- `supabase/functions/notify-lead-purchase/index.ts` — Remove `paymentMethod` venmo/cashapp references, update to reference Stripe payment

---

## Fix 6: Purchase Leads — Active Agents Only

**File:** `src/pages/PurchaseLeads.tsx`

- Default filter: `is_deactivated = false AND status = 'active'`
- Add "Show All" toggle for admin users
- Show per agent: payment status badge (Paid/Pending/No Leads), last payment date, package type
- Sort by most recent payment first

---

## Fix 7: Content Library — Fully Functional

**File:** `src/pages/ContentLibrary.tsx` (major rewrite)

- **Remove:** All `SAMPLE_CONTENT` hardcoded data, Caption Generator tab, Word template references
- **Upload:** Drag-and-drop accepting MP4/MOV/PNG/JPG/WEBP → Supabase Storage `content-library` bucket with progress indicator → post-upload form for title, tag, description
- **Grid:** Fetch from Supabase Storage + DB table, show thumbnail/title/tag/date per card, with Edit/Delete/Download actions
- **Video thumbnails:** Use `<video preload="metadata">` to capture first frame
- **Award Graphics tab:** Canvas-based generator with 5 templates (Deal Closed, Weekly Top Producer, Streak Achievement, Monthly Elite, First Deal). Agent dropdown loads from DB with photo from `avatars` bucket. Live canvas preview. Download as 1080x1080 PNG. Initials fallback for missing photos.

**Database:** Create `content_library` table (id, title, description, tags, storage_path, file_type, uploaded_by, created_at) via migration.

**Storage:** Create `content-library` bucket if not exists.

---

## Fix 8: Daily Check-In — Unlicensed Only + WhatsApp

**File:** `src/pages/DailyCheckin.tsx`

- After agent lookup, query `license_status` from `applications`
- If `licensed`: redirect to `/agent-dashboard` with toast "Licensed agents check in via your dashboard"
- If unlicensed/pending: show form as normal
- After submission success: show "Join our WhatsApp community" button
- Link sourced from `system_settings` table key `whatsapp_group_link`

**File:** `src/pages/Settings.tsx` — Add "WhatsApp Group Link" admin field that saves to `system_settings`

**File:** `supabase/functions/send-daily-checkin-prompt/index.ts` — Filter query to `license_status IN ('unlicensed','pending')` only

---

## Fix 9: Profile Pictures & Award Images

**All components showing agent photos:**
- Ensure `getAvatarUrl()` helper is applied consistently (already exists in `AgentAvatar.tsx`)
- Add `onError` fallback showing initials circle on every `<img>`
- Verify `avatars` bucket is public

**Award images:**
- Remove any OpenAI/DALL-E calls from `generate-award-graphics` edge function
- Frontend `AwardGraphics.tsx` uses canvas generator from Fix 7
- Each `plaque_awards` row gets `[Download Graphic]` button pre-filled with agent data

---

## Fix 10: Email Subject Lines

**Edge functions to update:**
- `submit-application` — Licensed vs unlicensed subject lines
- `send-agent-portal-login` — "Your APEX Agent Dashboard is Live, [FirstName]"
- Other notification functions — warm tone, "Hey [FirstName]," opening, "— Sam" closing, PS lines

Already partially done in previous work — will verify and complete remaining functions.

---

## Fix 11: Pipeline & Lead Center Cleanup

**Files:** `src/pages/AgentPipeline.tsx`, `src/pages/LeadCenter.tsx`

- Default: hide `is_deactivated = true` agents and `terminated_at IS NOT NULL` leads
- Add "Show Inactive" toggle
- Lead Center sort options: Newest / Highest potential / Stage / Last contacted
- Lead cards: name, phone, email, stage, days since applied, AI score badge
- Quick actions: Call, Email, Move Stage, Assign
- Bulk assign: multi-select + agent dropdown + assign all

---

## Removals Checklist

- Caption generator (from ContentLibrary)
- Word templates (from ContentLibrary)
- Venmo payment button (PurchaseLeads + ApexLeadsSection)
- CashApp payment button (PurchaseLeads + ApexLeadsSection)
- Placeholder/demo content in content library
- Deactivated agents from payment tracker default view

---

## Technical Notes

- **New DB migration:** `content_library` table + `content-library` storage bucket
- **Edge function updates:** `generate-award-graphics`, `send-daily-checkin-prompt`, `notify-lead-purchase`, email notification functions
- **~15 files** will be modified across frontend and backend
- Implementation will proceed fix-by-fix in order of priority (Fix 2 video blocking first as marked critical)

