

# Add Prominent "Check Your Spam" Notice to All Application Success Pages

## Problem
Applicants may miss important emails because they land in spam/junk folders. There's no visible warning on any of the three success pages.

## Changes

### 1. `src/pages/ApplySuccess.tsx`
Add a bold, eye-catching spam warning banner below the main description text — amber/yellow styled alert box with a mail icon saying: **"Important: Check your spam/junk folder!"** with supporting text explaining that emails from APEX may land there and to mark as "Not Spam."

### 2. `src/pages/ApplySuccessLicensed.tsx`
Same prominent spam warning banner added below the header description, before the video section.

### 3. `src/pages/ApplySuccessUnlicensed.tsx`
Same prominent spam warning banner added below the header description, before the video section.

### Design
- Amber/yellow background with border (`bg-amber-500/10 border-amber-500/30`)
- Mail warning icon + bold text: **"Check your email spam/junk folder!"**
- Subtext: "Emails from APEX Financial may land in your spam folder. Be sure to check there and mark us as 'Not Spam' so you don't miss anything."
- Animated entrance to draw attention

