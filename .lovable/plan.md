

# Fix: Remove Duplicate Motivation Question

## Problem
The motivation question appears **twice** in the application flow:
1. **Step 4** (line 927-942): A required textarea field "What motivates you to join APEX?" with 25-char minimum validation
2. **Step 5 post-submit** (lines 1090-1130): A separate "Almost There!" motivation screen shown only to unlicensed applicants after form submission

Applicants are being asked the same thing twice.

## Plan
**Keep the Step 4 motivation field** (it's already validated and submitted with the form) and **remove the post-submit motivation step entirely**:

1. **Remove the `showMotivationStep` state and `handleMotivationSubmit` function** — no longer needed
2. **Remove the Step 5 motivation UI block** (lines 1090-1130)
3. **Update the submit handler**: After successful submission, unlicensed applicants go directly to `/apply/success/unlicensed` instead of showing the motivation step
4. **Remove the motivation-related state variables** (`motivationText`, `motivationError`, `showMotivationStep`)

### Files Changed
- `src/pages/Apply.tsx` — Remove duplicate motivation step, simplify post-submit flow

