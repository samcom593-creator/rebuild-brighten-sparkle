
# Call Center Enhancements: No Pickup, Already Contracted, Lead Filtering, and More Info

## Issues Identified

1. **No "No Pickup" button** -- The Call Center actions only have Hired, Contracted, and Not a Fit. There's no way to mark that someone didn't answer the phone.

2. **Contract button error** -- When clicking Contract for someone who already exists in the system (e.g., already licensed/contracted), the `add-agent` edge function returns a 409 error because a profile already exists. Need an "Already Contracted" option that skips agent creation and just enrolls them in coursework.

3. **Seeing leads that shouldn't appear** -- Licensed and already-contracted people are still showing up in the queue. The query doesn't filter out leads whose status is already `contracted`, `hired`, or who are already `licensed`.

4. **Missing applicant details** -- The lead card doesn't show previous agency (`previous_company`), NIPR number (`nipr_number`), licensed states (`licensed_states`), or other application-specific fields that exist in the database.

---

## Changes

### 1. Add "No Pickup" Action Button (`src/components/callcenter/CallCenterActions.tsx`)

- Add `"no_pickup"` to the `ActionId` type: `"hired" | "contracted" | "bad_applicant" | "no_pickup"`
- Add a 4th action button (amber/orange, PhoneOff icon) with keyboard shortcut `[4]`
- Layout: keep Hired and Contracted in 2-column row, then "No Pickup" and "Not a Fit" as a second 2-column row below

### 2. Handle "No Pickup" in CallCenter.tsx (`src/pages/CallCenter.tsx`)

- In `executeAction`, handle `"no_pickup"` the same as other statuses -- update the lead's status to `"no_pickup"` and move to the next lead
- Add keyboard shortcut `4` for no_pickup
- The lead stays in the system but with status "no_pickup" so it can be revisited later

### 3. Add "Already Contracted" Option to Contract Modal (`src/components/dashboard/ContractedModal.tsx`)

- Add a toggle/checkbox at the top: "Already contracted (skip agent creation)"
- When toggled ON, the modal skips the `add-agent` edge function call entirely
- Instead, it just marks the lead as contracted in the database and sends the course enrollment email directly
- For course enrollment without an agent record, it sends the `send-course-enrollment-email` by looking up the agent by email, or sends `send-licensing-instructions` as a fallback

### 4. Filter Out Already-Processed Leads (`src/pages/CallCenter.tsx`)

**Aged leads query (line 101-110):** Add filter to exclude leads with status `contracted` or `hired`:
- For `statusFilter === "new"`, the current filter `.in("status", ["new"])` already works
- But the `"contacted"` and default filters might show contracted leads
- Add a global exclusion: `.not("status", "in", '("contracted","hired")')` unless explicitly filtered

**Applications query (line 146-168):** Add exclusions:
- Filter out applications where `contracted_at` is not null (already contracted)
- Filter out applications where `license_status = 'licensed'` AND `closed_at` is not null (already closed/licensed)

### 5. Show Additional Applicant Info on Lead Card (`src/components/callcenter/CallCenterLeadCard.tsx`)

Add new fields to the `UnifiedLead` interface and display them:
- `previousCompany` -- shown as "Previous Agency" in the lead card
- `niprNumber` -- shown as "NIPR #"
- `licensedStates` -- shown as "Licensed States"
- `city` / `state` -- shown as location
- `availability` -- shown if present

**Update `src/pages/CallCenter.tsx`** to fetch these fields from the applications query (line 149):
- Add `previous_company, nipr_number, licensed_states, city, state, availability` to the select

**Update the lead card UI** to display these in an "Applicant Details" section below the contact info, only shown when data is available.

---

## Technical Details

### File: `src/components/callcenter/CallCenterActions.tsx`

- **Line 14:** Change type to `"hired" | "contracted" | "bad_applicant" | "no_pickup"`
- **Lines 27-57:** Add `no_pickup` action definition with `PhoneOff` icon, amber color, key "4"
- **Lines 110-160:** Restructure layout to show 4 buttons in two 2-column rows instead of 2+1

### File: `src/pages/CallCenter.tsx`

- **Lines 100-110 (aged leads query):** Add `.not("status", "in", '("contracted","hired")')` to exclude already-processed leads
- **Lines 146-168 (applications query):** Add `.is("contracted_at", null)` to exclude contracted applicants  
- **Line 149:** Add `previous_company, nipr_number, licensed_states, city, state, availability` to select
- **Lines 178-196:** Map the new fields into the UnifiedLead objects
- **Lines 513-532 (keyboard shortcuts):** Add case `"4"` for `handleAction("no_pickup")`
- **Lines 27-44 (UnifiedLead interface):** Add `previousCompany`, `niprNumber`, `licensedStates`, `city`, `state`, `availability` optional fields

### File: `src/components/callcenter/CallCenterLeadCard.tsx`

- **Lines 13-30 (UnifiedLead interface):** Add the new optional fields
- **Lines 325-339 (after Notes section):** Add "Applicant Details" section showing previous company, NIPR, licensed states, location, and availability when available

### File: `src/components/dashboard/ContractedModal.tsx`

- **Lines 42-46:** Add `alreadyContracted` state boolean
- **Lines 78-112 (handleSubmit):** When `alreadyContracted` is true, skip the `add-agent` call, just update the lead status to contracted and send course enrollment by looking up agent by email
- **Lines 227-297 (UI):** Add a switch/toggle at the top: "Already contracted -- skip creating a new agent account, just enroll in coursework"
