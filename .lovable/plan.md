

# Fix Open Graph Link Preview for Application Sharing

## Problem

When you share the APEX Financial website link (e.g., `apex-financial.org` or `apex-financial.org/apply`) through Instagram DMs, iMessage, Facebook, etc., it displays:

**Current Preview:**
- Title: "Apex Daily Numbers - Log Your Production"
- Description: "Track your daily production, see your ranking, and compete on the leaderboard"
- Image: Daily numbers themed image

This is confusing for applicants who expect to see recruitment-focused messaging.

---

## Root Cause

The Open Graph meta tags in `index.html` (lines 35-49) are configured for the agent portal "Daily Numbers" feature:

```html
<meta property="og:title" content="Apex Daily Numbers - Log Your Production" />
<meta property="og:description" content="Track your daily production..." />
<meta property="og:image" content="...apex-daily-numbers-og.png" />
```

Since React is a single-page application (SPA), all routes share the same `index.html` file. Social media crawlers read this file directly and don't execute JavaScript, so they always see these "Daily Numbers" tags.

---

## Solution

Update the OG meta tags to be **recruitment-focused** since:
1. Most shared links are for recruiting new applicants
2. Agents accessing the portal are already logged in (they don't share portal links publicly)
3. The title and description should reflect what applicants will see

---

## Changes to `index.html`

**Lines 35-49** - Update Open Graph and Twitter Card meta tags:

| Tag | Current | New |
|-----|---------|-----|
| `og:title` | "Apex Daily Numbers - Log Your Production" | "APEX Financial - Start Your Career in Insurance Sales" |
| `og:description` | "Track your daily production, see your ranking..." | "Join APEX Financial. Earn uncapped commissions, get free training, and access warm leads. Apply now and build your financial future." |
| `og:image` | `apex-daily-numbers-og.png` | New recruitment-focused image (or existing one updated) |
| `twitter:title` | Same as og | Same as og |
| `twitter:description` | Same as og | Same as og |

**Also update line 31** - PWA title:
| Current | New |
|---------|-----|
| "APEX Numbers" | "APEX Financial" |

---

## New OG Image Recommendation

For best results, create a new Open Graph image that features:
- APEX Financial branding
- Headline like "Build Your Career in Insurance Sales"
- Key benefits: "Uncapped Commissions | Free Training | Warm Leads"
- Dimensions: 1200x630 pixels (optimal for social sharing)

For now, we can keep the existing image but update the title/description text.

---

## File Changes

| File | Change |
|------|--------|
| `index.html` | Update OG title, description, and Twitter card meta tags |

---

## Expected Result

After this change, when you share `apex-financial.org` or `apex-financial.org/apply` in DMs, the preview will show:

**New Preview:**
- **Title**: "APEX Financial - Start Your Career in Insurance Sales"
- **Description**: "Join APEX Financial. Earn uncapped commissions, get free training, and access warm leads. Apply now and build your financial future."
- **Image**: (Current or updated branding image)

---

## Important Note

Social media platforms cache link previews. After deployment, you may need to:
1. Wait 24-48 hours for cache to expire naturally
2. Or use platform debugging tools to force refresh:
   - Facebook: https://developers.facebook.com/tools/debug/
   - Twitter: https://cards-dev.twitter.com/validator
   - LinkedIn: https://www.linkedin.com/post-inspector/

