

# Add Check-In Link Button to Recruiter HQ + Revamp Daily Check-In Page

## Overview
Add a prominent "Check-In Link" copy button at the top of Recruiter HQ, and update the `/daily-checkin` page to identify applicants by first name, last name, and phone number instead of email. Also add an optional "manager code" field.

## Changes

### 1. Recruiter HQ Header — Add Check-In Link button
**File:** `src/pages/RecruiterDashboard.tsx` (~line 1148)

Add a new button in the quick-links row that copies the `/daily-checkin` URL to clipboard with a toast confirmation. Styled prominently (e.g., amber/gold border) so it stands out as the first button in the row.

### 2. Revamp Daily Check-In Lookup (`src/pages/DailyCheckin.tsx`)
Replace the email-based lookup with a 3-field form:
- **First Name** (required)
- **Last Name** (required)  
- **Phone Number** (required, last 10 digits matching)

Matching logic: query `applications` table matching `first_name` (case-insensitive), `last_name` (case-insensitive), and phone (last-10-digit normalization). This auto-links the check-in to the correct applicant profile.

Add an optional **"Manager Code"** text field — if filled, include it in the check-in record's notes or blocker field so the manager is notified. This is a free-text box where they can type a message to their manager.

### 3. No database changes needed
- `applicant_checkins` table already stores all needed fields
- `applications` table already has `first_name`, `last_name`, `phone`
- Phone normalization uses existing last-10-digit pattern

### Technical Details
- Phone matching: `right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)` comparison on both stored and input values
- The check-in link URL: `https://rebuild-brighten-sparkle.lovable.app/daily-checkin`
- Copy button uses `navigator.clipboard.writeText()` with toast feedback

