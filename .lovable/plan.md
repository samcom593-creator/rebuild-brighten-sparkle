
# Plan: Enhanced Post-Call Follow-Up Email with Licensing Resources

## Summary

Enhance the post-call follow-up email to include:
1. **Calendar link** for rebooking (already exists)
2. **Licensing steps** for unlicensed leads
3. **YouTube video** explaining the licensing process
4. **Licensing document** with detailed guide

The email will be customized based on license status:
- **Licensed leads**: Simple "great talking to you" + calendar link
- **Unlicensed leads**: Full licensing resources package (video, document, course link, steps)

---

## What Will Change

### Updated Email Content for Unlicensed Leads

The email will now include:

```text
Hey [First Name]! 📞

Great talking with you! Here's everything you need to get started on your licensing journey:

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📺 STEP 1: WATCH THE OVERVIEW VIDEO
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Learn about the licensing process and what to expect.
[Watch Video Button → YouTube Link]

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 STEP 2: REVIEW THE LICENSING GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Our comprehensive guide walks you through every step.
[View Document Button → Google Doc]

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎓 STEP 3: START YOUR PRE-LICENSING COURSE
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Complete your state-required education. We cover the cost!
[Start Course Button → Course Link]

━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ We Cover Licensing Costs – No upfront costs
✅ Takes About 7 Days – Complete in one week
✅ Full Training Provided – Learn everything you need

━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 Need help? Book a follow-up call:
[Schedule Follow-Up Call Button]

– The APEX Team
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/send-post-call-followup/index.ts` | Add licensing resources section for unlicensed leads |

---

## Technical Details

### Resource URLs (from GetLicensed.tsx)
- **YouTube Video**: `https://www.youtube.com/embed/i1e5p-GEfAU` (will convert to watch link)
- **Licensing Document**: `https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit?usp=sharing`
- **Pre-Licensing Course**: `https://partners.xcelsolutions.com/afe`
- **Calendly URL**: `https://calendly.com/sam-com593/licensed-prospect-call-clone`

### Email Logic
```typescript
const isLicensed = licenseStatus === "licensed";

if (isLicensed) {
  // Simple follow-up + calendar link
} else {
  // Full licensing resources package:
  // - Step 1: YouTube video
  // - Step 2: Google Doc guide
  // - Step 3: Pre-licensing course link
  // - Quick benefits list
  // - Calendar link for questions
}
```

### Enhanced Email Design

For unlicensed leads, the email will have:
- **Three clear steps** with icons and buttons
- **Embedded video thumbnail** linking to YouTube
- **Visual step indicators** (Step 1 → Step 2 → Step 3)
- **Benefits checklist** (costs covered, 7 days, full training)
- **Calendar booking button** at the bottom

---

## Expected Outcomes

After implementation:
- Every post-call email for **unlicensed leads** includes:
  - YouTube video link with thumbnail
  - Licensing document link
  - Pre-licensing course link
  - Clear 3-step process
  - Calendar booking option
- **Licensed leads** continue to receive the simple follow-up email
- Email design matches APEX branding (dark theme, teal accents, gradient buttons)
